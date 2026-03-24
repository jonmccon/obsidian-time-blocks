import { describe, it, expect } from 'vitest';
import {
	generateCodeVerifier,
	generateCodeChallenge,
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
