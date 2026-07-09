/**
 * @fileoverview 3-legged OAuth for the Google Photos Picker integration.
 *
 * Responsibilities:
 *   - Build the consent URL (with a one-time CSRF state nonce).
 *   - Exchange the returned auth code for tokens.
 *   - Persist the long-lived refresh token in D1 (single row, provider="photos").
 *   - Mint / cache short-lived access tokens from the refresh token.
 *
 * The redirect URI is derived from the live request origin so localhost and
 * production both work without any extra config — the origin's
 * `/api/google-photos/auth/callback` must be registered on the OAuth client.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { googleOauthTokens } from "@backend/db/schema/integrations/google_oauth_tokens";
import { getGooglePhotosOAuthClient } from "@backend/utils/secrets";

import {
  ACCESS_TOKEN_CACHE_KEY,
  AUTH_ENDPOINT,
  CALLBACK_PATH,
  OAUTH_STATE_PREFIX,
  OAUTH_STATE_TTL_SECONDS,
  PHOTOS_PICKER_SCOPE,
  PROVIDER_KEY,
  TOKEN_ENDPOINT,
} from "./types";

/** Compose the absolute redirect URI for a given request origin. */
export function redirectUriForOrigin(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

/**
 * Create a one-time CSRF state nonce, stashing it in CACHE KV with a short TTL.
 * Returned to the caller to embed in the consent URL; validated on callback.
 */
export async function createStateNonce(env: Env): Promise<string> {
  const state = crypto.randomUUID();
  await env.CACHE.put(`${OAUTH_STATE_PREFIX}${state}`, "1", {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  return state;
}

/** Validate + consume (delete) a CSRF state nonce. Returns true if it was valid. */
export async function consumeStateNonce(env: Env, state: string | undefined): Promise<boolean> {
  if (!state) return false;
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const hit = await env.CACHE.get(key);
  if (!hit) return false;
  await env.CACHE.delete(key);
  return true;
}

/** Build the Google consent URL for the given origin + state nonce. */
export async function buildConsentUrl(
  env: Env,
  origin: string,
  state: string,
): Promise<string> {
  const { clientId } = await getGooglePhotosOAuthClient(env);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriForOrigin(origin),
    response_type: "code",
    scope: PHOTOS_PICKER_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    // Force a refresh_token to be returned even on re-consent.
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

/**
 * Exchange an authorization code for tokens and persist the refresh token.
 * @throws if Google rejects the exchange or omits a refresh token.
 */
export async function exchangeCodeForTokens(
  env: Env,
  origin: string,
  code: string,
): Promise<void> {
  const { clientId, clientSecret } = await getGooglePhotosOAuthClient(env);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUriForOrigin(origin),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const token = (await res.json()) as GoogleTokenResponse;
  if (!token.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Ensure the consent used prompt=consent & access_type=offline.",
    );
  }

  await persistRefreshToken(env, token.refresh_token, token.scope ?? PHOTOS_PICKER_SCOPE);
  // Warm the access-token cache so the first picker call is instant.
  await cacheAccessToken(env, token.access_token, token.expires_in);
}

/** Upsert the refresh token row in D1 (one row per provider). */
export async function persistRefreshToken(
  env: Env,
  refreshToken: string,
  scope: string,
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  await db
    .insert(googleOauthTokens)
    .values({ provider: PROVIDER_KEY, refreshToken, scope, updatedAt: now })
    .onConflictDoUpdate({
      target: googleOauthTokens.provider,
      set: { refreshToken, scope, updatedAt: now },
    });
}

/** Read the stored refresh token, or null if the user has not connected. */
export async function getStoredRefreshToken(env: Env): Promise<string | null> {
  const db = drizzle(env.DB);
  const row = await db
    .select({ refreshToken: googleOauthTokens.refreshToken })
    .from(googleOauthTokens)
    .where(eq(googleOauthTokens.provider, PROVIDER_KEY))
    .get();
  return row?.refreshToken ?? null;
}

/** Whether the user has connected Google Photos (a refresh token exists). */
export async function isConnected(env: Env): Promise<boolean> {
  return (await getStoredRefreshToken(env)) !== null;
}

/** Cache a freshly minted access token, expiring slightly before Google does. */
async function cacheAccessToken(env: Env, accessToken: string, expiresIn: number): Promise<void> {
  const ttl = Math.max(60, expiresIn - 60);
  await env.CACHE.put(ACCESS_TOKEN_CACHE_KEY, accessToken, { expirationTtl: ttl });
}

/**
 * Return a valid access token — from cache when possible, otherwise minted from
 * the stored refresh token.
 * @throws if the user has not connected Google Photos.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.CACHE.get(ACCESS_TOKEN_CACHE_KEY);
  if (cached) return cached;

  const refreshToken = await getStoredRefreshToken(env);
  if (!refreshToken) {
    throw new Error("Google Photos is not connected. Complete the OAuth consent first.");
  }

  const { clientId, clientSecret } = await getGooglePhotosOAuthClient(env);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const token = (await res.json()) as GoogleTokenResponse;
  await cacheAccessToken(env, token.access_token, token.expires_in);
  return token.access_token;
}
