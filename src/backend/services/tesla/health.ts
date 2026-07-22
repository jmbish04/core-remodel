/**
 * @fileoverview Health probes for the Tesla/Tessie integration.
 *
 * The module is deliberately spread across files at `services/` root — this
 * `health.ts` is the probe home for all of them:
 *   - `tesla.ts`             Tessie REST client (location, vehicle state, send navigation)
 *   - `tesla-poller.ts`      the 2-minute pull that replaced the webhook that never fired
 *   - `tesla-integration.ts` credential/consent/health state behind /admin/config/integrations/tesla
 *   - `tesla-automations.ts` drive automations reacting to vehicle events
 *
 * Storage: the high-write telemetry tables live in the DEDICATED `TESLA_DB` D1
 * (`tesla_telemetry_events`, `tesla_webhook_events`), not the app `DB`. That
 * separation is why these probes bind a second database and why a missing table
 * here points at `pnpm run migrate:tesla:remote`, NOT the app migration.
 *
 * The single most important piece of history: Tessie has NO webhook product.
 * Its Fleet Telemetry is a WebSocket the client dials and its REST API is
 * pull-only, so the sinks sat at zero rows while the UI reported a healthy,
 * configured integration. These probes exist so that specific lie cannot recur.
 *
 * Cost discipline: no probe calls api.tessie.com. Credentials come from the
 * Secrets Store; everything else is an indexed count on TESLA_DB.
 */
import {
  defineProbe,
  degraded,
  failure,
  ok,
  readSecret,
  scalar,
  tableExists,
  type HealthProbe,
} from "@backend/services/health/types";

const FILE = "src/backend/services/tesla/health.ts";

const HOUR = 3_600;
const DAY = 86_400;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "tesla_tessie_credentials_present",
    displayName: "Tesla · Tessie token + VIN present",
    description:
      "Reads TESSIE_API_TOKEN and TESLA_BETSY_VIN from the Secrets Store and sanity-checks the VIN is 17 characters. `tessieConfigured()` requires BOTH — a token with no VIN cannot address a vehicle, and the poller short-circuits with reason 'unconfigured' rather than erroring, which is why a half-configured integration looks quiet instead of broken. Presence only; no call to api.tessie.com.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both credentials are readable and the VIN is well-formed. `getVehicleState`, `getLocation`, and `sendNavigation` have what they need, and the poller will actually poll when a drive is active.",
    whatFailureMeans:
      "A missing token or VIN disables the whole integration silently: the drive poller returns reason 'unconfigured' and does nothing, stops are never checked off automatically, and home-arrival never ends a drive. The /admin/config/integrations/tesla page will show the corresponding field unconfigured. A wrong-length VIN reports DEGRADED — Tessie will 404 the vehicle path, which reads like an auth failure but is not.",
    troubleshootingSteps:
      "1. Check the masked view first — /admin/config/integrations/tesla shows `configured`, a dot mask, and the character LENGTH of each secret, which is enough to spot a truncated paste without exposing the value. 2. Regenerate the token in the Tessie dashboard if it is absent or was rotated, and set it in the Cloudflare dashboard under Secrets Store as TESSIE_API_TOKEN. 3. The VIN must be the 17-character vehicle VIN exactly as Tessie shows it — no spaces, no trailing newline. 4. Re-run this probe from /admin/system/health; Secrets Store values are read per request, so no redeploy is required.",
    devOpsPlaybook:
      "1. There is deliberately NO self-serve write path for these secrets — a secret-write endpoint is a separate security surface and was left unbuilt; update them in the Cloudflare dashboard. 2. Never log the token; `tesla-integration.ts` masks with dots and reports length only, and this probe follows the same rule. 3. Confirm end to end after a fix by starting a drive and watching `npx wrangler tail --format pretty | grep -i tesla`. 4. If the token is valid but every call 401s, it was rotated on the Tessie side — regenerate rather than debugging our code.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const [token, vin] = await Promise.all([
        readSecret(env.TESSIE_API_TOKEN),
        readSecret(env.TESLA_BETSY_VIN),
      ]);
      const missing: string[] = [];
      if (!token) missing.push("TESSIE_API_TOKEN");
      if (!vin) missing.push("TESLA_BETSY_VIN");
      if (missing.length > 0) {
        return failure(`Absent or empty Secrets Store value(s): ${missing.join(", ")} — the Tesla integration is unconfigured and the poller will no-op.`);
      }
      const cleanVin = vin!.trim();
      if (cleanVin.length !== 17) {
        return degraded(
          `Token present (${token!.length} chars) but TESLA_BETSY_VIN is ${cleanVin.length} characters, not 17 — Tessie will not resolve this vehicle.`,
        );
      }
      return ok(`Tessie token (${token!.length} chars) and a 17-character VIN are both readable.`);
    },
  }),

  defineProbe({
    name: "tesla_db_reachable",
    displayName: "Tesla · TESLA_DB reachable with its tables",
    description:
      "Confirms the dedicated `TESLA_DB` D1 binding exists, answers a query, and contains both `tesla_telemetry_events` and `tesla_webhook_events`. These tables come from a SEPARATE migration set (drizzle-tesla/, applied by `pnpm run migrate:tesla:remote`), which is exactly why they get missed — the app migration passing says nothing about them.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The second D1 is bound, responsive, and carries both event tables. Telemetry frames and poll events have somewhere to land, and the drive automations can read history.",
    whatFailureMeans:
      "A missing binding means the deployment lost the TESLA_DB entry from wrangler.jsonc — every telemetry POST and every poller write throws. A missing table means the Tesla migration set was never applied to remote: the app deployed fine, the app migration ran fine, and this database was simply forgotten. That is the single most likely cause of a Tesla endpoint returning 500 right after a deploy.",
    troubleshootingSteps:
      "1. Apply the Tesla migrations — they are a separate command from the app ones: `pnpm run migrate:tesla:remote`. 2. Verify on remote: `npx wrangler d1 execute <tesla-db-name> --remote --command \"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tesla_%'\"` (the database name is in wrangler.jsonc under d1_databases, binding TESLA_DB). 3. If the BINDING is missing rather than the tables: `grep -n 'TESLA_DB' wrangler.jsonc`, then `npx wrangler deployments list | tail -20` to confirm the running version predates the config. 4. Re-run this probe from /admin/system/health.",
    devOpsPlaybook:
      "1. `pnpm run deploy` runs build → migrate:remote → migrate:tesla:remote → wrangler deploy in that order for exactly this reason; running a bare `wrangler deploy` is how this breaks. 2. Never repair the schema with raw SQL — regenerate with the drizzle tesla config and apply via `pnpm run migrate:tesla:remote`. 3. Preview workers share the same D1 instances, so a Tesla migration must stay additive or every other branch's preview breaks with it. 4. Status page: /admin/config/integrations/tesla.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const db = (env as unknown as { TESLA_DB?: D1Database }).TESLA_DB;
      if (!db) return failure("env.TESLA_DB is undefined — the dedicated Tesla D1 binding is not attached to this deployment.");
      const missing: string[] = [];
      for (const t of ["tesla_telemetry_events", "tesla_webhook_events"]) {
        if (!(await tableExists(db, t))) missing.push(t);
      }
      if (missing.length > 0) {
        return failure(`TESLA_DB is bound but missing table(s): ${missing.join(", ")} — run \`pnpm run migrate:tesla:remote\`.`);
      }
      const telemetry = await scalar(db, "SELECT COUNT(*) FROM tesla_telemetry_events");
      const events = await scalar(db, "SELECT COUNT(*) FROM tesla_webhook_events");
      if (telemetry === 0 && events === 0) {
        return degraded(
          "TESLA_DB is bound and both tables exist, but BOTH are empty — this is the exact 'configured but collecting nothing' state the poller was built to fix.",
        );
      }
      return ok(`TESLA_DB reachable: tesla_telemetry_events=${telemetry}, tesla_webhook_events=${events}.`);
    },
  }),

  defineProbe({
    name: "tesla_telemetry_freshness",
    displayName: "Tesla · telemetry freshness",
    description:
      "Ages the newest `tesla_telemetry_events.received_at`. Telemetry is a hosted Fleet Telemetry stream forwarded to us at roughly half-second cadence WHILE the car is awake and reporting; it legitimately stops when the car sleeps. Thresholds are chosen against that: over 6 hours stale is DEGRADED (a normal overnight sleep fits inside a day but a workday of silence does not), and over 48 hours is FAILURE (the car cannot plausibly have been asleep that long, so the forwarder or the endpoint is broken). The probe reports only, and never wakes the vehicle.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "A telemetry frame landed within the last 6 hours: the stream is connected, the ingest endpoint is accepting POSTs, telemetry recording consent is on, and TESLA_DB writes are succeeding. This is the strongest single signal that the integration is genuinely live.",
    whatFailureMeans:
      "DEGRADED (>6h): usually a sleeping car, occasionally a dropped stream — read it together with the recording-consent state on /admin/config/integrations/tesla before acting. FAILURE (>48h): the stream is down. Either the telemetry recording toggle was turned off (in which case nothing is written BY DESIGN and this is a consent problem, not an outage), the Tessie-side telemetry configuration lapsed, or our ingest endpoint is erroring on every POST.",
    troubleshootingSteps:
      "1. Check consent FIRST at /admin/config/integrations/tesla — `telemetryRecording` false means frames are intentionally discarded and no amount of debugging the stream will help; the flag lives in project_system_variables under `tesla_telemetry_recording_enabled`. 2. Check the credentials probe on /admin/system/health — an unconfigured integration also blocks recording. 3. Look for ingest errors: `npx wrangler tail --format pretty | grep -i telemetry`. 4. Compare with poll events, which come from a different path: `npx wrangler d1 execute <tesla-db-name> --remote --command \"SELECT event_type, COUNT(*) c, MAX(received_at) newest FROM tesla_webhook_events GROUP BY event_type\"` — poll rows arriving while telemetry is silent isolates the fault to the stream. 5. Re-check the Tessie Fleet Telemetry configuration for the VIN in the Tessie dashboard.",
    devOpsPlaybook:
      "1. Telemetry is a high-write firehose into D1 — if it must be stopped for cost or noise reasons, turn the consent flag OFF rather than breaking the endpoint, and expect this probe to sit DEGRADED/FAILURE while it is off. 2. Do not add a 'wake the car to check' step; probes must never issue a vehicle command. 3. After any fix, `pnpm run deploy` from `main`, then confirm a new frame lands before declaring it resolved — a green deploy proves nothing here. 4. Retention: this table grows fast; any pruning job must preserve enough recent history for this probe's 48-hour window to remain meaningful.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const db = (env as unknown as { TESLA_DB?: D1Database }).TESLA_DB;
      if (!db) return failure("env.TESLA_DB is undefined — cannot read telemetry.");
      if (!(await tableExists(db, "tesla_telemetry_events"))) {
        return failure("Table `tesla_telemetry_events` does not exist — run `pnpm run migrate:tesla:remote`.");
      }
      const newest = await scalar(db, "SELECT COALESCE(MAX(received_at), 0) FROM tesla_telemetry_events");
      if (newest === 0) {
        return failure("tesla_telemetry_events is empty — no telemetry frame has EVER been recorded.");
      }
      const ageHours = (Math.floor(Date.now() / 1000) - newest) / HOUR;
      if (ageHours > 48) {
        return failure(`Newest telemetry frame is ${ageHours.toFixed(1)} hours old (>48h) — the stream is down or recording consent is off.`);
      }
      if (ageHours > 6) {
        return degraded(`Newest telemetry frame is ${ageHours.toFixed(1)} hours old (>6h) — likely a sleeping vehicle; confirm against /admin/config/integrations/tesla.`);
      }
      return ok(`Newest telemetry frame is ${ageHours.toFixed(1)} hours old.`);
    },
  }),

  defineProbe({
    name: "tesla_poller_evidence",
    displayName: "Tesla · poller producing events during active drives",
    description:
      "The poller only runs while a drive is active (`drive_lists.is_active` in the APP DB), throttled to one Tessie read every 120 seconds, and records each poll in TESLA_DB as a `tesla_webhook_events` row with `event_type = 'poll'`. This probe therefore reads both databases: if a drive is active right now, a poll row within the last 30 minutes is expected; if no drive is active, no polling is expected and the probe reports the last poll for context instead of judging it.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Either no drive is active (nothing should be polling, and the cheap early-exit is working as designed), or a drive is active and poll events are landing on cadence — meaning the per-minute cron, the KV throttle, the Tessie read, and the TESLA_DB write are all healthy end to end.",
    whatFailureMeans:
      "A drive is active but no poll row has appeared in 30 minutes, which is 15 missed poll windows. Candidates, in the order worth checking: the per-minute cron trigger is missing from the deployment (preview workers strip crons entirely, so this probe is meaningless on a preview); the credentials probe is red so the poller exits with reason 'unconfigured'; the KV throttle key is stuck; or the Tessie read is failing. Consequence: stops are not checked off, navigation is not sent, and home arrival never ends the drive.",
    troubleshootingSteps:
      "1. Confirm a drive really is active: `npx wrangler d1 execute core-remodel --remote --command \"SELECT slug, status, is_active FROM drive_lists WHERE is_active = 1\"`. 2. Check the credentials probe on /admin/system/health — unconfigured means a silent no-op, not an error. 3. Confirm the per-minute cron is on the running deployment: `grep -n 'crons' wrangler.jsonc` and `npx wrangler deployments list | tail -20`. 4. Watch a tick live: `npx wrangler tail --format pretty | grep -i poll`. 5. Inspect the throttle: `npx wrangler kv key get --binding CACHE --remote tesla-poll:last` — a far-future or corrupt value suppresses every poll.",
    devOpsPlaybook:
      "1. Never 'fix' a quiet poller by removing the throttle — it is what stops the per-minute tick becoming 1,440 Tessie calls a day. 2. Cached reads only: the poller uses `use_cache=true` so it cannot wake the car, and no fix should change that. 3. Preview workers have crons stripped by design — judge this probe on production only. 4. After a fix, end and restart a drive from /admin/shopping/drives to force a fresh poll window rather than waiting for the next natural one, then re-run this probe.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const teslaDb = (env as unknown as { TESLA_DB?: D1Database }).TESLA_DB;
      if (!teslaDb) return failure("env.TESLA_DB is undefined — cannot read poll events.");
      if (!(await tableExists(teslaDb, "tesla_webhook_events"))) {
        return failure("Table `tesla_webhook_events` does not exist — run `pnpm run migrate:tesla:remote`.");
      }
      const newestPoll = await scalar(
        teslaDb,
        "SELECT COALESCE(MAX(received_at), 0) FROM tesla_webhook_events WHERE event_type = 'poll'",
      );
      const activeDrives = (await tableExists(env.DB, "drive_lists"))
        ? await scalar(env.DB, "SELECT COUNT(*) FROM drive_lists WHERE is_active = 1")
        : 0;

      if (activeDrives === 0) {
        return newestPoll === 0
          ? ok("No active drive, and no poll events recorded yet — the poller only runs during an active drive.")
          : ok(
              `No active drive (nothing should be polling). Last poll event was ${((Math.floor(Date.now() / 1000) - newestPoll) / HOUR).toFixed(1)} hours ago.`,
            );
      }

      if (newestPoll === 0) {
        return failure("A drive is active but no poll event has EVER been recorded — the poller has never run successfully.");
      }
      const ageMin = (Math.floor(Date.now() / 1000) - newestPoll) / 60;
      if (ageMin > 30) {
        return failure(
          `A drive is active but the newest poll event is ${ageMin.toFixed(0)} minutes old (~${Math.floor(ageMin / 2)} missed 120s windows).`,
        );
      }
      if (ageMin > 10) {
        return degraded(`A drive is active and the newest poll event is ${ageMin.toFixed(0)} minutes old (expected within ~2 minutes).`);
      }
      return ok(`Drive active; newest poll event is ${ageMin.toFixed(1)} minutes old.`);
    },
  }),

  defineProbe({
    name: "tesla_event_volume_watch",
    displayName: "Tesla · event write volume",
    description:
      "Counts rows written to TESLA_DB in the last 24 hours across both event tables and compares them against the physical ceiling of each path. Telemetry at ~2 frames/second tops out near 172,800 rows a day; poll events are throttled to one per 120 seconds, so more than ~720 in a day means the throttle is not holding. D1 bills on rows written, so a runaway write loop here is a direct cost event — this is the Tesla equivalent of the Durable-Object billing runaway.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Both event streams are writing at or below their designed cadence. D1 row-write spend from the Tesla integration is bounded and predictable.",
    whatFailureMeans:
      "DEGRADED: poll rows exceed the throttle's ceiling, so the KV throttle is not being honoured — every extra row is also an extra billable Tessie read. FAILURE: telemetry rows in 24 hours exceed what a half-second stream can physically produce, which means duplicate ingestion (the same frames POSTed more than once, or a retry loop) and D1 write spend climbing for no added information.",
    troubleshootingSteps:
      "1. Break the volume down by hour to find when it started: `npx wrangler d1 execute <tesla-db-name> --remote --command \"SELECT event_type, COUNT(*) c FROM tesla_webhook_events WHERE received_at >= strftime('%s','now','-1 day') GROUP BY event_type ORDER BY c DESC\"`. 2. For telemetry, check for duplicate frames by `event_ts`: a high count with few distinct `event_ts` values is re-POSTing, not a faster stream. 3. Watch live: `npx wrangler tail --format pretty | grep -i telemetry`. 4. Inspect the poll throttle key: `npx wrangler kv key get --binding CACHE --remote tesla-poll:last`. 5. To stop the bleeding immediately, turn telemetry recording OFF at /admin/config/integrations/tesla — the ingest path then discards frames instead of writing them.",
    devOpsPlaybook:
      "1. Treat a FAILURE here as a live cost incident, not a data-quality note — D1 charges per row written and this table is the highest-write surface in the project. 2. Do not raise the thresholds in this file to silence it; they are derived from the physical cadence of each path, so exceeding them is always a real defect. 3. The consent flag is the kill switch and it requires no deploy: /admin/config/integrations/tesla. 4. Once volume is back to normal, re-enable recording and confirm the telemetry-freshness probe goes green again — a silenced stream that nobody re-enabled is the other failure mode.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = (env as unknown as { TESLA_DB?: D1Database }).TESLA_DB;
      if (!db) return failure("env.TESLA_DB is undefined — cannot measure write volume.");
      const since = Math.floor(Date.now() / 1000) - DAY;
      const telemetry = (await tableExists(db, "tesla_telemetry_events"))
        ? await scalar(db, "SELECT COUNT(*) FROM tesla_telemetry_events WHERE received_at >= ?", since)
        : 0;
      const polls = (await tableExists(db, "tesla_webhook_events"))
        ? await scalar(db, "SELECT COUNT(*) FROM tesla_webhook_events WHERE received_at >= ? AND event_type = 'poll'", since)
        : 0;

      // ~2 frames/sec is the documented telemetry cadence; anything past that in
      // 24h is duplicate ingestion rather than a livelier car.
      if (telemetry > 172_800) {
        return failure(`${telemetry} telemetry rows written in 24h — above the ~172,800 ceiling for a 500ms stream, so frames are being ingested more than once.`);
      }
      if (polls > 720) {
        return degraded(`${polls} poll rows written in 24h — the 120s throttle allows at most ~720, so the KV throttle is not holding.`);
      }
      return ok(`24h TESLA_DB writes: ${telemetry} telemetry frame(s), ${polls} poll event(s) — both within their designed cadence.`);
    },
  }),
];
