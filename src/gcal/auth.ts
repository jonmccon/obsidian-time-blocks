/**
 * OAuth 2.0 authentication for the Google Calendar API.
 *
 * Uses the Authorization-Code flow with PKCE (Proof Key for Code Exchange)
 * so there is no client secret embedded in the plugin source.  The user
 * supplies their own Google Cloud Console client ID.
 *
 * Token storage is handled by the plugin's data.json via callbacks.
 */

import { requestUrl } from 'obsidian';
import type { OAuthTokens, TokenEndpointResponse } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * The OAuth redirect URI.
 *
 * For Obsidian plugins, we use the loopback address `http://127.0.0.1`.
 * Google treats loopback redirects specially — it allows any port and ignores
 * the path component, so the actual redirect may go to e.g.
 * `http://127.0.0.1:PORT/callback`.  The value registered in Google Cloud
 * Console must match this base URI.
 *
 * @see https://developers.google.com/identity/protocols/oauth2/native-app#redirect-uri_loopback
 */
export const REDIRECT_URI = 'http://127.0.0.1';

/** Scopes required for read + write calendar access. */
export const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar';

/** Read-only scope (for users who only want to pull events). */
export const CALENDAR_SCOPES_READONLY =
	'https://www.googleapis.com/auth/calendar.readonly';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

/** Generates a cryptographically random code verifier (43-128 chars, RFC 7636). */
export function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

/** Derives the S256 code challenge from the code verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

/** Base64-URL encodes a byte array (no padding). */
function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Auth flow ────────────────────────────────────────────────────────────────

/** Parameters needed to build the authorization URL. */
export interface AuthUrlParams {
	clientId: string;
	codeChallenge: string;
	scopes: string;
	redirectUri?: string;
}

/**
 * Builds the Google OAuth 2.0 authorization URL that the user opens in their
 * browser to grant permission.
 */
export function buildAuthUrl(params: AuthUrlParams): string {
	const redirectUri = params.redirectUri ?? REDIRECT_URI;
	const query = new URLSearchParams({
		client_id: params.clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: params.scopes,
		code_challenge: params.codeChallenge,
		code_challenge_method: 'S256',
		access_type: 'offline',
		prompt: 'consent',
	});
	return `${AUTH_ENDPOINT}?${query.toString()}`;
}

/** Parameters needed to exchange an authorization code for tokens. */
export interface TokenExchangeParams {
	clientId: string;
	code: string;
	codeVerifier: string;
	redirectUri?: string;
}

/**
 * Exchanges the authorization code for access + refresh tokens.
 *
 * Uses Obsidian's `requestUrl` so it works on both desktop and mobile.
 */
export async function exchangeCodeForTokens(
	params: TokenExchangeParams
): Promise<OAuthTokens> {
	const redirectUri = params.redirectUri ?? REDIRECT_URI;
	const body = new URLSearchParams({
		client_id: params.clientId,
		code: params.code,
		code_verifier: params.codeVerifier,
		grant_type: 'authorization_code',
		redirect_uri: redirectUri,
	});

	const resp = await requestUrl({
		url: TOKEN_ENDPOINT,
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});

	const data = resp.json as TokenEndpointResponse;
	return tokenResponseToOAuthTokens(data);
}

/**
 * Refreshes an expired access token using the stored refresh token.
 *
 * Returns updated tokens.  If the server rotates refresh tokens the new one
 * is included; otherwise the original refresh_token is preserved.
 */
export async function refreshAccessToken(
	clientId: string,
	refreshToken: string
): Promise<OAuthTokens> {
	const body = new URLSearchParams({
		client_id: clientId,
		refresh_token: refreshToken,
		grant_type: 'refresh_token',
	});

	const resp = await requestUrl({
		url: TOKEN_ENDPOINT,
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});

	const data = resp.json as TokenEndpointResponse;
	const tokens = tokenResponseToOAuthTokens(data);
	// Preserve the existing refresh token if the server didn't issue a new one.
	if (!tokens.refresh_token) {
		tokens.refresh_token = refreshToken;
	}
	return tokens;
}

/** Returns true when the stored access token has expired (or will within 60 s). */
export function isTokenExpired(tokens: OAuthTokens): boolean {
	return Date.now() >= tokens.expires_at - 60_000;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function tokenResponseToOAuthTokens(resp: TokenEndpointResponse): OAuthTokens {
	return {
		access_token: resp.access_token,
		refresh_token: resp.refresh_token,
		expires_at: Date.now() + resp.expires_in * 1000,
		token_type: resp.token_type,
		scope: resp.scope,
	};
}
