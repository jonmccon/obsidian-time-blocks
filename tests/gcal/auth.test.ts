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
