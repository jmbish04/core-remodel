/**
 * @fileoverview Tesla/Tessie integration state — what is configured, whether
 * telemetry may be recorded, and whether the data we already collected is
 * actually usable.
 *
 * Backs `/admin/config/integrations/tesla` and the `tesla` MCP tools. Three
 * separate questions live here, and the page answers them in that order:
 *
 *   1. **Credentials** — are the secrets present? Values are NEVER returned;
 *      only a mask and a length, so the page can show a filled-looking field
 *      without the page (or a screenshot of it) leaking a token.
 *   2. **Consent** — telemetry is a ~500ms firehose into D1. It records only
 *      when the integration is configured AND the toggle here is on. Off means
 *      nothing is written, and the endpoint says so rather than pretending.
 *   3. **Health** — a check over the rows we already have: does a historical
 *      event still yield the fields the automation reads (coordinates, shift
 *      state, VIN)? A green "configured" badge over a table of unusable rows is
 *      the failure this screen exists to catch.
 *
 * Credentials remain read-only, sourced from the Secrets Store bindings. The
 * self-serve token entry the page hints at is deliberately not wired up: a
 * write path for secrets is a different security surface and needs its own
 * review.
 */
import { teslaTelemetryEvents, teslaWebhookEvents } from "@backend/db/schema/tesla";
import { getLocation, tessieConfigured } from "@backend/services/tesla";
import { setConfigValue } from "@backend/services/usage/metering";
import { projectSystemVariables } from "@backend/db";
import { getTessieToken, getTeslaVin, getWorkerApiKey } from "@backend/utils/secrets";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** project_system_variables key holding the telemetry-recording consent flag. */
export const TELEMETRY_ENABLED_KEY = "tesla_telemetry_recording_enabled";

/** One credential, as the config page is allowed to see it. */
export interface MaskedSecret {
  /** Stable id the UI uses as the field name, e.g. "TESSIE_API_TOKEN". */
  binding: string;
  label: string;
  /** What it's for, shown under the field. */
  description: string;
  configured: boolean;
  /** Dots only — never any part of the value. Empty when unconfigured. */
  masked: string;
  /** Character count, so a truncated/pasted-wrong secret is visible as such. */
  length: number;
}

export interface TeslaIntegrationStatus {
  /** True when BOTH the Tessie token and the VIN are present. */
  configured: boolean;
  /** Whether telemetry frames may be written to D1 (requires `configured`). */
  telemetryRecording: boolean;
  /** The stored consent flag on its own — false while unconfigured, too. */
  telemetryRecordingSetting: boolean;
  secrets: MaskedSecret[];
}

/** A run of dots as long as the secret, capped so a long token doesn't wrap. */
function mask(value: string): string {
  if (!value) return "";
  return "•".repeat(Math.min(value.length, 32));
}

/** Read the telemetry consent flag. Defaults to ON for existing installs. */
export async function telemetryRecordingSetting(env: Env): Promise<boolean> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ value: projectSystemVariables.valueText })
    .from(projectSystemVariables)
    .where(eq(projectSystemVariables.variableKey, TELEMETRY_ENABLED_KEY))
    .limit(1);
  return row?.value == null ? true : row.value === "true";
}

/** Persist the telemetry consent flag. */
export async function setTelemetryRecording(env: Env, enabled: boolean): Promise<void> {
  await setConfigValue(env, TELEMETRY_ENABLED_KEY, enabled ? "true" : "false");
}

/**
 * May a telemetry frame be written right now? Both gates must pass — an
 * unconfigured integration cannot log anything even with the toggle on, since
 * there is no vehicle to attribute the frames to.
 */
export async function telemetryRecordingAllowed(env: Env): Promise<boolean> {
  const [configured, setting] = await Promise.all([
    tessieConfigured(env),
    telemetryRecordingSetting(env),
  ]);
  return configured && setting;
}

/** Credentials + consent, with every secret value masked. */
export async function getTeslaIntegrationStatus(env: Env): Promise<TeslaIntegrationStatus> {
  const [token, vin, workerKey, setting] = await Promise.all([
    getTessieToken(env),
    getTeslaVin(env),
    getWorkerApiKey(env),
    telemetryRecordingSetting(env),
  ]);
  const configured = Boolean(token && vin);

  return {
    configured,
    telemetryRecording: configured && setting,
    telemetryRecordingSetting: setting,
    secrets: [
      {
        binding: "TESSIE_API_TOKEN",
        label: "Tessie API token",
        description: "Bearer token for api.tessie.com — reads location, sends navigation.",
        configured: Boolean(token),
        masked: mask(token),
        length: token.length,
      },
      {
        binding: "TESLA_BETSY_VIN",
        label: "Vehicle VIN",
        description: "Which car the drive automation follows.",
        configured: Boolean(vin),
        masked: mask(vin),
        length: vin.length,
      },
      {
        binding: "WORKER_API_KEY",
        label: "Webhook secret",
        description:
          "Shared key Tessie signs the webhook + telemetry POSTs with (X-Webhook-Secret).",
        configured: Boolean(workerKey),
        masked: mask(workerKey),
        length: workerKey.length,
      },
    ],
  };
}

/** One health probe's verdict. */
export interface HealthCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface TeslaHealthReport {
  checks: HealthCheck[];
  /** Worst status across the checks — what the page badges. */
  overall: "ok" | "warn" | "fail";
  /** Counts behind the historical checks, so the page can show the raw numbers. */
  stats: {
    webhookEvents: number;
    webhookEventsWithCoords: number;
    lastWebhookAt: string | null;
    telemetryFrames: number;
    telemetryWithCoords: number;
    telemetryWithShiftState: number;
    lastTelemetryAt: string | null;
  };
}

/**
 * Screen the integration end to end: credentials, a live API call, and — the
 * part that actually matters — whether the events already in `TESLA_DB` still
 * carry the fields the automation reads out of them.
 *
 * `liveProbe: false` skips the Tessie round-trip (used by the MCP tool, which
 * should not burn a vehicle wake on a status question).
 */
export async function runTeslaHealthCheck(
  env: Env,
  opts: { liveProbe?: boolean } = {},
): Promise<TeslaHealthReport> {
  const checks: HealthCheck[] = [];
  const status = await getTeslaIntegrationStatus(env);

  const missing = status.secrets.filter((s) => !s.configured).map((s) => s.binding);
  checks.push({
    id: "credentials",
    label: "Credentials present in the Secrets Store",
    status: missing.length === 0 ? "ok" : status.configured ? "warn" : "fail",
    detail:
      missing.length === 0
        ? "TESSIE_API_TOKEN, TESLA_BETSY_VIN and WORKER_API_KEY are all set."
        : `Missing: ${missing.join(", ")}.`,
  });

  if (opts.liveProbe !== false) {
    if (status.configured) {
      const loc = await getLocation(env);
      checks.push({
        id: "live-location",
        label: "Live position read from Tessie",
        status: loc ? "ok" : "fail",
        detail: loc
          ? `Vehicle reported ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}.`
          : "GET /{vin}/location returned nothing — token, VIN, or the car is unreachable.",
      });
    } else {
      checks.push({
        id: "live-location",
        label: "Live position read from Tessie",
        status: "fail",
        detail: "Skipped — the integration is not configured.",
      });
    }
  }

  // ── Historical rows: can the automation still read what it needs? ─────────
  const teslaDb = drizzle(env.TESLA_DB);
  const [wh] = await teslaDb
    .select({
      total: sql<number>`count(*)`,
      withCoords: sql<number>`sum(case when ${teslaWebhookEvents.latitude} is not null and ${teslaWebhookEvents.longitude} is not null then 1 else 0 end)`,
      last: sql<number | null>`max(${teslaWebhookEvents.receivedAt})`,
    })
    .from(teslaWebhookEvents);
  const [tel] = await teslaDb
    .select({
      total: sql<number>`count(*)`,
      withCoords: sql<number>`sum(case when ${teslaTelemetryEvents.latitude} is not null and ${teslaTelemetryEvents.longitude} is not null then 1 else 0 end)`,
      withShift: sql<number>`sum(case when ${teslaTelemetryEvents.shiftState} is not null then 1 else 0 end)`,
      last: sql<number | null>`max(${teslaTelemetryEvents.receivedAt})`,
    })
    .from(teslaTelemetryEvents);

  const whTotal = Number(wh?.total ?? 0);
  const whCoords = Number(wh?.withCoords ?? 0);
  const telTotal = Number(tel?.total ?? 0);
  const telCoords = Number(tel?.withCoords ?? 0);
  const telShift = Number(tel?.withShift ?? 0);
  const iso = (v: number | null | undefined) =>
    v == null ? null : new Date(Number(v) * 1000).toISOString();

  checks.push({
    id: "webhook-history",
    label: "Historical webhooks carry coordinates",
    status: whTotal === 0 ? "warn" : whCoords > 0 ? "ok" : "fail",
    detail:
      whTotal === 0
        ? "No webhook events recorded yet — nothing to verify."
        : `${whCoords} of ${whTotal} events have a position. Coordinates are what the auto-visit and home-arrival rules read.`,
  });

  checks.push({
    id: "telemetry-history",
    label: "Historical telemetry carries position + shift state",
    status:
      telTotal === 0
        ? status.telemetryRecording
          ? "warn"
          : "ok"
        : telCoords > 0 && telShift > 0
          ? "ok"
          : "warn",
    detail:
      telTotal === 0
        ? status.telemetryRecording
          ? "Recording is on but no frames have arrived — check Tessie's Fleet Telemetry forwarding."
          : "Recording is off, so no frames are stored. This is the configured state, not a fault."
        : `${telCoords} of ${telTotal} frames have coordinates, ${telShift} have a shift state.`,
  });

  const lastWebhook = iso(wh?.last);
  const staleAfterDays = 30;
  const ageDays = lastWebhook
    ? (Date.now() - new Date(lastWebhook).getTime()) / 86_400_000
    : null;
  checks.push({
    id: "freshness",
    label: "Events are still arriving",
    status: ageDays == null ? "warn" : ageDays <= staleAfterDays ? "ok" : "warn",
    detail:
      ageDays == null
        ? "No webhook has ever been received."
        : `Last webhook ${Math.round(ageDays)} day(s) ago (${lastWebhook}).`,
  });

  const overall: "ok" | "warn" | "fail" = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  return {
    checks,
    overall,
    stats: {
      webhookEvents: whTotal,
      webhookEventsWithCoords: whCoords,
      lastWebhookAt: lastWebhook,
      telemetryFrames: telTotal,
      telemetryWithCoords: telCoords,
      telemetryWithShiftState: telShift,
      lastTelemetryAt: iso(tel?.last),
    },
  };
}
