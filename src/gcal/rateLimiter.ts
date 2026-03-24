/**
 * Rate-limiter with exponential back-off and retry logic for Google Calendar
 * API calls.  Designed to stay within the documented 500-requests-per-100-seconds
 * quota while gracefully recovering from transient failures.
 */

/** Options for a single retryable operation. */
export interface RetryOptions {
	/** Maximum number of attempts (including the first). Default: 3. */
	maxAttempts?: number;
	/** Base delay in milliseconds before the first retry. Default: 1 000. */
	baseDelayMs?: number;
	/** Maximum delay cap in milliseconds. Default: 30 000. */
	maxDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Returns true when the HTTP status code is a transient error that should be
 * retried (429 Too Many Requests, 500, 502, 503, 504).
 */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Computes the delay before the next retry using exponential back-off with
 * full jitter: `random(0, min(cap, base * 2^attempt))`.
 */
export function computeBackoff(
	attempt: number,
	baseMs: number,
	capMs: number
): number {
	const exponential = baseMs * Math.pow(2, attempt);
	const capped = Math.min(exponential, capMs);
	return Math.floor(Math.random() * capped);
}

/** Minimal interface expected from an HTTP error so the limiter can inspect status. */
export interface HttpError {
	status?: number;
	message?: string;
}

/**
 * Executes `fn` with automatic retries on transient errors.
 *
 * Throws the last error if all attempts are exhausted.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	opts?: RetryOptions
): Promise<T> {
	const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = opts?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

	let lastError: unknown;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err: unknown) {
			lastError = err;

			const status = (err as HttpError).status;
			if (status !== undefined && !isRetryableStatus(status)) {
				// Non-retryable error — fail immediately
				throw err;
			}

			if (attempt < maxAttempts - 1) {
				const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs);
				await sleep(delay);
			}
		}
	}

	throw lastError;
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
