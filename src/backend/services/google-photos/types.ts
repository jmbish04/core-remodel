/**
 * @fileoverview Shared constants and types for the Google Photos Picker
 * integration.
 *
 * Flow overview (3-legged OAuth + Picker API):
 *   1. User consents once → we store a refresh token in D1.
 *   2. We mint short-lived access tokens from that refresh token (cached in KV).
 *   3. We create a Picker "session", the user selects photos in Google Photos,
 *      we poll until the selection is set, list the picked items, and stream the
 *      bytes back to the browser as real files.
 *
 * Docs: https://developers.google.com/photos/picker/guides/get-started-picker
 */

/** Google OAuth 2.0 authorization (consent) endpoint. */
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Google OAuth 2.0 token endpoint (code exchange + refresh). */
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Google Photos Picker API base URL. */
export const PICKER_BASE = "https://photospicker.googleapis.com/v1";

/** The single scope needed to create picker sessions and read picked bytes. */
export const PHOTOS_PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

/** Path (relative to the request origin) that Google redirects back to. */
export const CALLBACK_PATH = "/api/google-photos/auth/callback";

/** D1 provider key for the stored refresh token (single-user app → one row). */
export const PROVIDER_KEY = "photos";

/** CACHE KV key holding the current short-lived access token. */
export const ACCESS_TOKEN_CACHE_KEY = "google-photos:access-token";

/** CACHE KV key prefix for one-time CSRF state nonces. */
export const OAUTH_STATE_PREFIX = "google-photos:oauth-state:";

/** Seconds a CSRF state nonce stays valid. */
export const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * A picker session as consumed by the frontend. Durations from Google's
 * `pollingConfig` (strings like "5s") are normalized to milliseconds here.
 */
export interface PickerSession {
  sessionId: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  /** Recommended poll interval, ms. */
  pollIntervalMs: number;
  /** Recommended total polling budget, ms. */
  timeoutMs: number;
}

/** A single picked media item, flattened for the frontend + downloader. */
export interface PickedItem {
  id: string;
  filename: string;
  mimeType: string;
  /** Google base URL; append "=d" + bearer auth to fetch the bytes. */
  baseUrl: string;
  type: string;
}

/** Bytes streamed back from a Google download, ready to relay to the browser. */
export interface DownloadedBytes {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  contentLength: string | null;
}
