import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	generateCodeVerifier,
	generateCodeChallenge,
	generateState,
	buildAuthUrl,
	isTokenExpired,
	REDIRECT_URI,
	CALENDAR_SCOPES,
	CALENDAR_SCOPES_READONLY,
} from '../../src/gcal/auth';
import type { OAuthTokens } from '../../src/gcal/types';

describe('PKCE helpers', () => {
	it('generateCodeVerifier produces a URL-safe string', () => {
		const verifier = generateCodeVerifier();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(verifier.length).toBeGreaterThanOrEqual(32);
	});

	it('generateCodeVerifier produces unique values', () => {
		const a = generateCodeVerifier();
		const b = generateCodeVerifier();
		expect(a).not.toBe(b);
	});

	it('generateCodeChallenge produces a URL-safe string', async () => {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(challenge.length).toBeGreaterThan(0);
	});

	it('same verifier produces the same challenge (deterministic)', async () => {
		const verifier = generateCodeVerifier();
		const a = await generateCodeChallenge(verifier);
		const b = await generateCodeChallenge(verifier);
		expect(a).toBe(b);
	});

	it('different verifiers produce different challenges', async () => {
		const a = await generateCodeChallenge(generateCodeVerifier());
		const b = await generateCodeChallenge(generateCodeVerifier());
		expect(a).not.toBe(b);
	});
});

describe('generateState', () => {
	it('produces a URL-safe string', () => {
		const state = generateState();
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(state.length).toBeGreaterThan(0);
	});

	it('produces unique values each call', () => {
		const a = generateState();
		const b = generateState();
		expect(a).not.toBe(b);
	});
});

describe('buildAuthUrl', () => {
	it('builds a valid Google OAuth authorization URL', async () => {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		const url = buildAuthUrl({
			clientId: 'test-client-id.apps.googleusercontent.com',
			codeChallenge: challenge,
			scopes: CALENDAR_SCOPES,
		});

		expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
		expect(url).toContain('client_id=test-client-id.apps.googleusercontent.com');
		expect(url).toContain('response_type=code');
		expect(url).toContain('code_challenge_method=S256');
		expect(url).toContain('access_type=offline');
		expect(url).toContain('prompt=consent');
		expect(url).toContain(encodeURIComponent(CALENDAR_SCOPES));
		expect(url).toContain(encodeURIComponent(REDIRECT_URI));
	});

	it('includes state parameter when provided', async () => {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);
		const state = generateState();

		const url = buildAuthUrl({
			clientId: 'test-client-id',
			codeChallenge: challenge,
			scopes: CALENDAR_SCOPES,
			state,
		});

		expect(url).toContain(`state=${encodeURIComponent(state)}`);
	});

	it('omits state parameter when not provided', async () => {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		const url = buildAuthUrl({
			clientId: 'test-client-id',
			codeChallenge: challenge,
			scopes: CALENDAR_SCOPES,
		});

		expect(url).not.toContain('state=');
	});

	it('supports custom redirect URI', async () => {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);
		const customRedirect = 'http://localhost:8080/callback';

		const url = buildAuthUrl({
			clientId: 'test-id',
			codeChallenge: challenge,
			scopes: CALENDAR_SCOPES_READONLY,
			redirectUri: customRedirect,
		});

		expect(url).toContain(encodeURIComponent(customRedirect));
		expect(url).not.toContain(encodeURIComponent(REDIRECT_URI));
	});
});

describe('isTokenExpired', () => {
	it('returns true when token has expired', () => {
		const tokens: OAuthTokens = {
			access_token: 'expired',
			expires_at: Date.now() - 10_000,
			token_type: 'Bearer',
			scope: CALENDAR_SCOPES,
		};
		expect(isTokenExpired(tokens)).toBe(true);
	});

	it('returns true when token expires within 60 seconds', () => {
		const tokens: OAuthTokens = {
			access_token: 'almost-expired',
			expires_at: Date.now() + 30_000, // 30s remaining < 60s buffer
			token_type: 'Bearer',
			scope: CALENDAR_SCOPES,
		};
		expect(isTokenExpired(tokens)).toBe(true);
	});

	it('returns false when token is still valid', () => {
		const tokens: OAuthTokens = {
			access_token: 'valid',
			expires_at: Date.now() + 3600_000, // 1 hour remaining
			token_type: 'Bearer',
			scope: CALENDAR_SCOPES,
		};
		expect(isTokenExpired(tokens)).toBe(false);
	});
});

describe('exchangeCodeForTokens / token endpoint error handling', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('includes client_secret when provided', async () => {
		const obsidianModule = await import('obsidian');
		const requestUrlSpy = vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: {
				access_token: 'tok-123',
				expires_in: 3600,
				token_type: 'Bearer',
				scope: CALENDAR_SCOPES,
			},
			status: 200,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { exchangeCodeForTokens } = await import('../../src/gcal/auth');
		await exchangeCodeForTokens({
			clientId: 'test-client-id',
			clientSecret: 'test-client-secret',
			code: 'code-123',
			codeVerifier: 'verifier-123',
		});

		const request = requestUrlSpy.mock.calls[0][0];
		expect(request.body).toContain('client_secret=test-client-secret');
	});

	it('throws when the token endpoint returns an error field', async () => {
		const obsidianModule = await import('obsidian');
		vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: {
				error: 'invalid_grant',
				error_description: 'Token has been expired or revoked.',
			},
			status: 400,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { exchangeCodeForTokens } = await import('../../src/gcal/auth');
		await expect(
			exchangeCodeForTokens({
				clientId: 'test-client-id',
				code: 'bad-code',
				codeVerifier: generateCodeVerifier(),
			})
		).rejects.toThrow('invalid_grant');
	});

	it('throws with error code alone when error_description is absent', async () => {
		const obsidianModule = await import('obsidian');
		vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: { error: 'invalid_client' },
			status: 401,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { exchangeCodeForTokens } = await import('../../src/gcal/auth');
		await expect(
			exchangeCodeForTokens({
				clientId: 'test-client-id',
				code: 'bad-code',
				codeVerifier: generateCodeVerifier(),
			})
		).rejects.toThrow('invalid_client');
	});
});

describe('completeAuthorization', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('happy path: valid code+state exchanges successfully and calls onSuccess', async () => {
		const obsidianModule = await import('obsidian');
		vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: {
				access_token: 'tok-123',
				expires_in: 3600,
				refresh_token: 'refresh-123',
				scope: CALENDAR_SCOPES,
				token_type: 'Bearer',
			},
			status: 200,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const onSuccess = vi.fn();
		const resetPendingAuth = vi.fn();
		const notify = vi.fn();

		await completeAuthorization('the-code', 'matching-state', {
			clientId: 'test-client-id',
			pendingState: 'matching-state',
			pendingCodeVerifier: 'verifier-123',
			onSuccess,
			resetPendingAuth,
			notify,
		});

		expect(onSuccess).toHaveBeenCalledTimes(1);
		expect(onSuccess.mock.calls[0][0]).toMatchObject({
			access_token: 'tok-123',
			refresh_token: 'refresh-123',
		});
		expect(resetPendingAuth).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith('Time blocks: signed in to calendar.');
	});

	it('rejects on CSRF state mismatch without exchanging the code', async () => {
		const obsidianModule = await import('obsidian');
		const requestUrlSpy = vi.spyOn(obsidianModule, 'requestUrl');

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const onSuccess = vi.fn();
		const resetPendingAuth = vi.fn();
		const notify = vi.fn();

		await completeAuthorization('the-code', 'attacker-state', {
			clientId: 'test-client-id',
			pendingState: 'expected-state',
			pendingCodeVerifier: 'verifier-123',
			onSuccess,
			resetPendingAuth,
			notify,
		});

		expect(requestUrlSpy).not.toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();
		expect(resetPendingAuth).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('authorization state mismatch')
		);
	});

	it('rejects when pendingState is null but a state was received', async () => {
		const obsidianModule = await import('obsidian');
		const requestUrlSpy = vi.spyOn(obsidianModule, 'requestUrl');

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const notify = vi.fn();
		const resetPendingAuth = vi.fn();

		await completeAuthorization('the-code', 'some-state', {
			clientId: 'test-client-id',
			pendingState: null,
			pendingCodeVerifier: 'verifier-123',
			onSuccess: vi.fn(),
			resetPendingAuth,
			notify,
		});

		expect(requestUrlSpy).not.toHaveBeenCalled();
		expect(resetPendingAuth).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('authorization state mismatch')
		);
	});

	it('rejects a null received state when a flow with a state is in progress', async () => {
		// A flow always generates a state when it starts (generateState()),
		// so a completion callback that arrives with no state at all (e.g. a
		// caller that only captured the bare code) must NOT be treated as a
		// free pass — otherwise CSRF protection could always be bypassed by
		// simply not sending state. See PR #34 review discussion.
		const obsidianModule = await import('obsidian');
		const requestUrlSpy = vi.spyOn(obsidianModule, 'requestUrl');

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const onSuccess = vi.fn();
		const resetPendingAuth = vi.fn();
		const notify = vi.fn();

		await completeAuthorization('the-code', null, {
			clientId: 'test-client-id',
			pendingState: 'expected-state',
			pendingCodeVerifier: 'verifier-123',
			onSuccess,
			resetPendingAuth,
			notify,
		});

		expect(requestUrlSpy).not.toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();
		expect(resetPendingAuth).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('authorization state mismatch')
		);
	});

	it('accepts a null received state only when no state was ever pending', async () => {
		const obsidianModule = await import('obsidian');
		vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: {
				access_token: 'tok-456',
				expires_in: 3600,
				scope: CALENDAR_SCOPES,
				token_type: 'Bearer',
			},
			status: 200,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const onSuccess = vi.fn();

		await completeAuthorization('the-code', null, {
			clientId: 'test-client-id',
			pendingState: null,
			pendingCodeVerifier: 'verifier-123',
			onSuccess,
			resetPendingAuth: vi.fn(),
		});

		expect(onSuccess).toHaveBeenCalledTimes(1);
	});

	it('reports an error and does not reset pending auth when no flow is in progress', async () => {
		const { completeAuthorization } = await import('../../src/gcal/auth');
		const notify = vi.fn();
		const resetPendingAuth = vi.fn();
		const onSuccess = vi.fn();

		await completeAuthorization('the-code', null, {
			clientId: 'test-client-id',
			pendingState: null,
			pendingCodeVerifier: null,
			onSuccess,
			resetPendingAuth,
			notify,
		});

		expect(onSuccess).not.toHaveBeenCalled();
		expect(resetPendingAuth).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith('Time blocks: click authorize first.');
	});

	it('surfaces an exchange-failure error via notify without throwing', async () => {
		const obsidianModule = await import('obsidian');
		vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValueOnce({
			json: {
				error: 'invalid_grant',
				error_description: 'Token has been expired or revoked.',
			},
			status: 400,
			text: '',
			arrayBuffer: new ArrayBuffer(0),
			headers: {},
		});

		const { completeAuthorization } = await import('../../src/gcal/auth');
		const onSuccess = vi.fn();
		const resetPendingAuth = vi.fn();
		const notify = vi.fn();

		await expect(
			completeAuthorization('bad-code', 'matching-state', {
				clientId: 'test-client-id',
				pendingState: 'matching-state',
				pendingCodeVerifier: 'verifier-123',
				onSuccess,
				resetPendingAuth,
				notify,
			})
		).resolves.toBeUndefined();

		expect(onSuccess).not.toHaveBeenCalled();
		// On exchange failure the flow stays pending so the user can retry
		// without re-authorizing from scratch.
		expect(resetPendingAuth).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('authentication failed')
		);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('invalid_grant')
		);
	});

	it('defaults to a Notice when no notify callback is supplied', async () => {
		const obsidianModule = await import('obsidian');
		const noticeSpy = vi.spyOn(obsidianModule, 'Notice');

		const { completeAuthorization } = await import('../../src/gcal/auth');
		await completeAuthorization('the-code', null, {
			clientId: 'test-client-id',
			pendingState: null,
			pendingCodeVerifier: null,
			onSuccess: vi.fn(),
			resetPendingAuth: vi.fn(),
		});

		expect(noticeSpy).toHaveBeenCalledWith('Time blocks: click authorize first.');
	});
});
