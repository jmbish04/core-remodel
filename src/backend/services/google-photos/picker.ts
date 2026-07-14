/**
 * @fileoverview Thin client over the Google Photos Picker API.
 *
 * Every call authenticates with a short-lived access token minted by `oauth.ts`.
 * The picker flow: createSession → (user picks in Google Photos) → poll
 * getSession → listMediaItems → downloadItemBytes.
 */

import { getAccessToken } from "./oauth";
import {
  GOOGLE_API_TIMEOUT_MS,
  GOOGLE_DOWNLOAD_TIMEOUT_MS,
  PICKER_BASE,
  SESSION_ITEMS_PREFIX,
  SESSION_ITEMS_TTL_SECONDS,
  type DownloadedBytes,
  type PickedItem,
  type PickerSession,
} from "./types";

/**
 * Parse a Google protobuf duration string (e.g. "5s", "1.500s") to milliseconds.
 * Falls back to the provided default when absent or unparseable.
 */
function durationToMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const seconds = Number.parseFloat(value.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallbackMs;
}

interface RawSession {
  id: string;
  pickerUri: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

/** Normalize a raw Picker session payload into our frontend-facing shape. */
function normalizeSession(raw: RawSession): PickerSession {
  return {
    sessionId: raw.id,
    pickerUri: raw.pickerUri,
    mediaItemsSet: raw.mediaItemsSet ?? false,
    pollIntervalMs: durationToMs(raw.pollingConfig?.pollInterval, 3000),
    timeoutMs: durationToMs(raw.pollingConfig?.timeoutIn, 300000),
  };
}

/** Create a new picking session. */
export async function createSession(env: Env): Promise<PickerSession> {
  const accessToken = await getAccessToken(env);
  const res = await fetch(`${PICKER_BASE}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to create picker session (${res.status}): ${detail.slice(0, 300)}`);
  }
  return normalizeSession((await res.json()) as RawSession);
}

/** Poll a session's state (chiefly whether the user has finished picking). */
export async function getSession(env: Env, sessionId: string): Promise<PickerSession> {
  const accessToken = await getAccessToken(env);
  const res = await fetch(`${PICKER_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to read picker session (${res.status}): ${detail.slice(0, 300)}`);
  }
  return normalizeSession((await res.json()) as RawSession);
}

interface RawMediaItem {
  id: string;
  type?: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
}

/**
 * List all media items the user picked in a session (paginated).
 *
 * The picked set is immutable once `mediaItemsSet` is true, and the download
 * route re-resolves items per file, so the list is cached in CACHE KV per
 * session. This eliminates a Google `mediaItems.list` round-trip on every
 * single byte download (avoiding rate limits and latency).
 */
export async function listMediaItems(env: Env, sessionId: string): Promise<PickedItem[]> {
  const cacheKey = `${SESSION_ITEMS_PREFIX}${sessionId}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as PickedItem[];
    } catch {
      // Corrupted cache — fall through and re-fetch.
    }
  }

  const accessToken = await getAccessToken(env);
  const items: PickedItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${PICKER_BASE}/mediaItems?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Failed to list picked media (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      mediaItems?: RawMediaItem[];
      nextPageToken?: string;
    };
    for (const raw of data.mediaItems ?? []) {
      if (!raw.mediaFile?.baseUrl) continue;
      // Skip videos (mp4 etc.) — we only import still photos into CF Images.
      // Filtering here keeps the list + per-index bytes route consistent.
      if (raw.type === "VIDEO" || raw.mediaFile.mimeType?.startsWith("video/")) continue;
      items.push({
        id: raw.id,
        type: raw.type ?? "TYPE_UNSPECIFIED",
        baseUrl: raw.mediaFile.baseUrl,
        mimeType: raw.mediaFile.mimeType ?? "application/octet-stream",
        filename: raw.mediaFile.filename ?? `google-photo-${raw.id}.jpg`,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  await env.CACHE.put(cacheKey, JSON.stringify(items), {
    expirationTtl: SESSION_ITEMS_TTL_SECONDS,
  });

  return items;
}

/**
 * Download the full-resolution bytes for a picked item. Appends "=d" to the
 * base URL per the Picker API contract and attaches the bearer token. Returns
 * the streamable body + content headers so the caller can relay it to the
 * browser without buffering the whole image in memory.
 */
export async function downloadItemBytes(env: Env, baseUrl: string): Promise<DownloadedBytes> {
  const accessToken = await getAccessToken(env);
  const res = await fetch(`${baseUrl}=d`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to download media bytes (${res.status}): ${detail.slice(0, 200)}`);
  }
  return {
    body: res.body,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    contentLength: res.headers.get("content-length"),
  };
}
