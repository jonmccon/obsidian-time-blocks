import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isRetryableStatus,
	computeBackoff,
	withRetry,
} from '../../src/gcal/rateLimiter';

describe('isRetryableStatus', () => {
	it('returns true for 429 (Too Many Requests)', () => {
		expect(isRetryableStatus(429)).toBe(true);
	});

	it('returns true for 500 (Internal Server Error)', () => {
		expect(isRetryableStatus(500)).toBe(true);
	});

	it('returns true for 502 (Bad Gateway)', () => {
		expect(isRetryableStatus(502)).toBe(true);
	});

	it('returns true for 503 (Service Unavailable)', () => {
		expect(isRetryableStatus(503)).toBe(true);
	});

	it('returns true for 504 (Gateway Timeout)', () => {
		expect(isRetryableStatus(504)).toBe(true);
	});

	it('returns false for 200 (OK)', () => {
		expect(isRetryableStatus(200)).toBe(false);
	});

	it('returns false for 400 (Bad Request)', () => {
		expect(isRetryableStatus(400)).toBe(false);
	});

	it('returns false for 401 (Unauthorized)', () => {
		expect(isRetryableStatus(401)).toBe(false);
	});

	it('returns false for 403 (Forbidden)', () => {
		expect(isRetryableStatus(403)).toBe(false);
	});

	it('returns false for 404 (Not Found)', () => {
		expect(isRetryableStatus(404)).toBe(false);
	});
});

describe('computeBackoff', () => {
	it('returns a value between 0 and base for attempt 0', () => {
		const base = 1000;
		const cap = 30000;
		for (let i = 0; i < 20; i++) {
			const delay = computeBackoff(0, base, cap);
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThanOrEqual(base);
		}
	});

	it('respects the cap for high attempt numbers', () => {
		const base = 1000;
		const cap = 5000;
		for (let i = 0; i < 20; i++) {
			const delay = computeBackoff(10, base, cap);
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThanOrEqual(cap);
		}
	});

	it('increases potential range with higher attempts', () => {
		const base = 1000;
		const cap = 100000;
		// Attempt 0 cap: min(100000, 1000) = 1000
		// Attempt 3 cap: min(100000, 8000) = 8000
		// Statistically, higher attempt = higher average delay
		let sumLow = 0;
		let sumHigh = 0;
		const runs = 100;
		for (let i = 0; i < runs; i++) {
			sumLow += computeBackoff(0, base, cap);
			sumHigh += computeBackoff(3, base, cap);
		}
		// On average, attempt 3 should produce higher delays
		expect(sumHigh / runs).toBeGreaterThan(sumLow / runs);
	});
});

describe('withRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns immediately on success', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on retryable errors and eventually succeeds', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce({ status: 429, message: 'rate limited' })
			.mockResolvedValue('ok');

		const result = await withRetry(fn, {
			maxAttempts: 3,
			baseDelayMs: 1,
			maxDelayMs: 1,
		});

		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('does not retry on non-retryable errors', async () => {
		const fn = vi.fn().mockRejectedValue({ status: 400, message: 'bad request' });

		await expect(
			withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
		).rejects.toEqual({ status: 400, message: 'bad request' });

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('throws after exhausting all attempts', async () => {
		const error = { status: 500, message: 'server error' };
		const fn = vi.fn().mockRejectedValue(error);

		await expect(
			withRetry(fn, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 })
		).rejects.toEqual(error);

		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('retries errors without a status code (network errors)', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValue('ok');

		const result = await withRetry(fn, {
			maxAttempts: 3,
			baseDelayMs: 1,
			maxDelayMs: 1,
		});

		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
