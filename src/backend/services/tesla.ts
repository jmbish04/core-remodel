/**
 * @fileoverview Tessie / Tesla API wrapper for Showroom Drive Lists.
 *
 * Thin, defensively-coded client over the Tessie REST API
 * (https://api.tessie.com) — the practical way to reach a Tesla without
 * standing up the full Fleet-API OAuth + vehicle-command signing stack. Two
 * capabilities back the drive app:
 *
 *   1. `sendNavigation(env, dest)` — hand a destination (address or "lat,lng")
 *      to the car so it starts routing. Backs the per-stop "Send to Tesla"
 *      button and the auto-advance step of the park webhook.
 *   2. `getLocation(env)` — read the car's current coordinates. Used by the
 *      park webhook to figure out which showroom the car stopped at.
 *
 * Config comes from three secret bindings (all optional — when unset the drive
 * app simply hides the Tesla button and the webhook no-ops):
 *   - `TESSIE_TOKEN`         Tessie API bearer token
 *   - `TESSIE_VIN`           which vehicle to command
 *   - `TESLA_WEBHOOK_SECRET` shared secret the inbound webhook must present
 *
 * IMPORTANT LIMITATION (surfaced to the user, not a bug): neither the Tesla
 * Fleet API nor Tessie can force-open a web page in the car's browser. The
 * "open the drive list when the driver gets back in" idea is not achievable
 * through any vehicle API — see the PR description for the workaround.
 */

const TESSIE_BASE = "https://api.tessie.com";

/** Read a secret binding to a trimmed string, or "" when unset/errored. */
async function readSecret(secret: SecretsStoreSecret | undefined | null): Promise<string> {
  if (!secret) return "";
  try {
    return (await secret.get())?.trim() || "";
  } catch {
    return "";
  }
}

/** Env shape with the (optional) Tesla/Tessie secret bindings. */
type TeslaEnv = Env &
  Partial<{
    TESSIE_TOKEN: SecretsStoreSecret;
    TESSIE_VIN: SecretsStoreSecret;
    TESLA_WEBHOOK_SECRET: SecretsStoreSecret;
  }>;

export interface TessieConfig {
  token: string;
  vin: string;
}

/** Resolve `{token, vin}` if BOTH are configured, else `null`. */
export async function getTessieConfig(env: Env): Promise<TessieConfig | null> {
  const e = env as TeslaEnv;
  const [token, vin] = await Promise.all([readSecret(e.TESSIE_TOKEN), readSecret(e.TESSIE_VIN)]);
  return token && vin ? { token, vin } : null;
}

/** True when the Tessie integration is usable (token + vin present). */
export async function tessieConfigured(env: Env): Promise<boolean> {
  return (await getTessieConfig(env)) !== null;
}

/**
 * Verify an inbound webhook against `TESLA_WEBHOOK_SECRET`.
 *
 * The car/Tessie can't send our admin cookie, so the webhook is gated by a
 * shared secret instead — accepted from either the `X-Webhook-Secret` header or
 * a `?secret=` query param (Tessie's dashboard lets you set either). When no
 * secret is configured the webhook is disabled (returns false) so an
 * unconfigured deploy can't be poked.
 */
export async function verifyWebhookSecret(request: Request, env: Env): Promise<boolean> {
  const expected = await readSecret((env as TeslaEnv).TESLA_WEBHOOK_SECRET);
  if (!expected) return false;
  const url = new URL(request.url);
  const provided = request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
  // Constant-time-ish compare (lengths differ rarely; this is not a high-value
  // secret, but avoid the trivial early-exit anyway).
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** A resolved vehicle position. */
export interface TeslaLocation {
  latitude: number;
  longitude: number;
  address?: string | null;
}

/**
 * Read the vehicle's current coordinates via `GET /{vin}/location`.
 * Returns `null` when Tessie isn't configured or the call fails.
 */
export async function getLocation(env: Env): Promise<TeslaLocation | null> {
  const cfg = await getTessieConfig(env);
  if (!cfg) return null;
  try {
    const res = await fetch(`${TESSIE_BASE}/${encodeURIComponent(cfg.vin)}/location`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      latitude?: number;
      longitude?: number;
      address?: string;
    };
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    return { latitude: data.latitude, longitude: data.longitude, address: data.address ?? null };
  } catch {
    return null;
  }
}

/** Outcome of a navigation hand-off. */
export interface SendNavResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a destination to the car so it starts navigating, via Tessie's `share`
 * command (`GET /{vin}/command/share?value=…`) — the same path the Tesla app's
 * "share address" uses to push a destination into the car's nav.
 *
 * `dest` is a free-form address string or a `"lat,lng"` pair. When the car is
 * asleep Tessie wakes it first (`wait_for_completion=true`), so this can take a
 * few seconds.
 */
export async function sendNavigation(env: Env, dest: string): Promise<SendNavResult> {
  const cfg = await getTessieConfig(env);
  if (!cfg) return { ok: false, error: "Tessie is not configured (TESSIE_TOKEN / TESSIE_VIN)." };
  const value = dest.trim();
  if (!value) return { ok: false, error: "Empty destination." };
  try {
    const url =
      `${TESSIE_BASE}/${encodeURIComponent(cfg.vin)}/command/share` +
      `?value=${encodeURIComponent(value)}&locale=en-US&wait_for_completion=true`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      // Wake-and-share can be slow; cap it so a hung Tessie call can't stall the
      // request/webhook indefinitely.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Tessie ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { result?: boolean };
    // Tessie returns `{ result: true }` on success; treat a 2xx without an
    // explicit `result:false` as success (schema varies across firmware).
    return data.result === false ? { ok: false, error: "Tesla rejected the command." } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
