/**
 * @fileoverview React hook driving the Google Photos Picker flow end-to-end and
 * handing the caller real `File` objects — so each upload surface can reuse its
 * existing upload path unchanged.
 *
 * Flow:
 *   1. GET /status — if not connected, open the OAuth consent popup and wait.
 *   2. POST /sessions — open the returned `pickerUri` in a popup.
 *   3. Poll GET /sessions/:id until `mediaItemsSet` (respecting pollInterval /
 *      timeout) or the user closes the popup.
 *   4. GET /sessions/:id/items — then fetch each item's bytes through our proxy
 *      and wrap them in `File` objects.
 *   5. Invoke `onFiles(files)`.
 *
 * All requests use `credentials: "include"` so the admin session cookie rides
 * along (the routes are behind requireAccessAuth).
 */

import { useCallback, useRef, useState } from "react";

const BASE = "/api/google-photos";

/** Coarse status for button labelling. */
export type PickerPhase =
  | "idle"
  | "connecting"
  | "opening"
  | "waiting"
  | "downloading";

interface SessionResponse {
  sessionId: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
}

interface ItemsResponse {
  items: Array<{ index: number; id: string; filename: string; mimeType: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Center a popup window on screen; returns null if the browser blocked it. */
function openPopup(url: string, name: string, w = 560, h = 680): Window | null {
  const dualLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualTop = window.screenTop ?? window.screenY ?? 0;
  const width = window.innerWidth || document.documentElement.clientWidth || screen.width;
  const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
  const left = dualLeft + Math.max(0, (width - w) / 2);
  const top = dualTop + Math.max(0, (height - h) / 2);
  return window.open(
    url,
    name,
    `scrollbars=yes,width=${w},height=${h},top=${top},left=${left}`,
  );
}

async function fetchConnected(): Promise<boolean> {
  const res = await fetch(`${BASE}/status`, { credentials: "include" });
  const data = await jsonOrThrow<{ connected: boolean }>(res);
  return data.connected;
}

/**
 * Open the OAuth consent popup and resolve once the account is connected.
 * Resolves early on the callback's postMessage; otherwise polls /status.
 * Rejects if the user closes the popup before connecting or on timeout (~3 min).
 */
async function ensureConnected(): Promise<void> {
  if (await fetchConnected()) return;

  const popup = openPopup(`${BASE}/auth/start`, "google-photos-oauth", 520, 640);
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for this site, then try again.");
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; status?: string } | undefined;
      if (data?.source !== "google-photos") return;
      if (data.status === "connected") finish(resolve);
      else finish(() => reject(new Error("Google Photos connection failed.")));
    };
    window.addEventListener("message", onMessage);

    const deadline = Date.now() + 3 * 60 * 1000;
    // Guard against overlapping polls when a request outlasts the interval.
    // NOTE: we don't test `popup.closed` here — after the popup navigates to
    // Google's cross-origin consent page (COOP), `closed` is unreliable and can
    // read `true` while the window is open. We rely on the callback's
    // postMessage plus polling /status, bounded by the deadline.
    let inFlight = false;
    const poll = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        if (await fetchConnected()) return finish(resolve);
      } catch {
        /* transient — keep polling */
      } finally {
        inFlight = false;
      }
      if (Date.now() > deadline) {
        finish(() => reject(new Error("Timed out connecting to Google Photos. Please try again.")));
      }
    }, 1500);
  });
}

/**
 * Poll a session until the user finishes picking. Resolves true when
 * `mediaItemsSet` flips, false on timeout.
 *
 * NOTE: we deliberately do NOT use `popup.closed` as a signal. Google's
 * `pickerUri` is cross-origin and sets Cross-Origin-Opener-Policy, which severs
 * the opener relationship — `popup.closed` then reads `true` even while the
 * window is open, causing a premature (and silent) bail. Polling our own
 * backend is unaffected by COOP, so we rely purely on the session state +
 * timeout. Transient poll errors are ignored so a blip doesn't abort the wait.
 */
async function waitForSelection(session: SessionResponse): Promise<boolean> {
  // Cap the wait so a cancelled pick doesn't hang forever (no reliable
  // cross-origin "closed" signal exists).
  const deadline = Date.now() + Math.min(session.timeoutMs || 300_000, 5 * 60 * 1000);
  const interval = Math.max(1500, session.pollIntervalMs || 3000);

  while (Date.now() < deadline) {
    await sleep(interval);
    try {
      const res = await fetch(`${BASE}/sessions/${encodeURIComponent(session.sessionId)}`, {
        credentials: "include",
      });
      const data = await jsonOrThrow<SessionResponse>(res);
      if (data.mediaItemsSet) return true;
    } catch {
      /* transient network/API blip — keep polling */
    }
  }
  return false;
}

/** Download one picked item through the proxy and wrap it in a File. */
async function downloadItem(
  sessionId: string,
  item: ItemsResponse["items"][number],
): Promise<File> {
  const res = await fetch(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/items/${item.index}/bytes`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to download ${item.filename} (${res.status})`);
  const blob = await res.blob();
  return new File([blob], item.filename, { type: blob.type || item.mimeType });
}

export interface UseGooglePhotosPicker {
  phase: PickerPhase;
  isBusy: boolean;
  /** Run the full connect → pick → download flow. */
  start: () => Promise<void>;
}

/**
 * @param onFiles  Called with the picked photos as `File[]`.
 * @param onError  Optional error sink (e.g. a toast). Defaults to console.error.
 * @param onNotice Optional neutral-message sink (e.g. an info toast) for
 *                 progress/empty states so the flow is never silent.
 */
export function useGooglePhotosPicker(
  onFiles: (files: File[]) => void | Promise<void>,
  onError?: (message: string) => void,
  onNotice?: (message: string) => void,
): UseGooglePhotosPicker {
  const [phase, setPhase] = useState<PickerPhase>("idle");
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      setPhase("connecting");
      await ensureConnected();

      setPhase("opening");
      const session = await jsonOrThrow<SessionResponse>(
        await fetch(`${BASE}/sessions`, { method: "POST", credentials: "include" }),
      );
      const picker = openPopup(session.pickerUri, "google-photos-picker");
      if (!picker) {
        throw new Error("Popup blocked. Allow popups for this site, then try again.");
      }

      setPhase("waiting");
      onNotice?.("Pick your photos in the Google Photos window — they'll import automatically.");
      const picked = await waitForSelection(session);
      try {
        picker.close();
      } catch {
        /* cross-origin close may throw — ignore */
      }
      if (!picked) {
        // Never silent: the user needs to know why nothing imported.
        onNotice?.("No photos imported — timed out waiting for a selection. Try again.");
        return;
      }

      setPhase("downloading");
      const { items } = await jsonOrThrow<ItemsResponse>(
        await fetch(`${BASE}/sessions/${encodeURIComponent(session.sessionId)}/items`, {
          credentials: "include",
        }),
      );
      if (items.length === 0) {
        onNotice?.("No photos were selected.");
        return;
      }

      const files = await Promise.all(items.map((it) => downloadItem(session.sessionId, it)));
      await onFiles(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (onError) onError(message);
      else console.error("[google-photos-picker]", message);
    } finally {
      running.current = false;
      setPhase("idle");
    }
  }, [onFiles, onError, onNotice]);

  return { phase, isBusy: phase !== "idle", start };
}
