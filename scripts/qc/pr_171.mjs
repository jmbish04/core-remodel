#!/usr/bin/env node
/**
 * @fileoverview QC for PR #171 — wire up the delivery sales-tax rate.
 *
 * Migrations: 0115_stiff_metal_master (creates sales_tax_rates)
 *
 * Run:  pnpm run test:pr 171
 *       pnpm run test:pr 171 -- --preview
 *
 * Context: the tax feature's files were swept into #168 by an indexing mistake
 * — the page and the config nav link shipped, but the router was never
 * registered and the table was never created. So `/admin/config/tax` was live
 * and broken in production. This PR registers the router and applies the
 * migration; the checks below are what "actually wired up" means.
 *
 * The rate is resolved from CDTFA's free address lookup using the property
 * address in `/admin/config/address`. That address must have street, city AND
 * zip — CDTFA rejects a partial one — so a missing `permits_target_city`
 * surfaces as a warning rather than an error.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

/** 126 Colby St sits in San Francisco: 8.625% == 86250 ppm. */
const EXPECTED_PPM = 86250;

async function main() {
  console.log(`\nPR #171 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const noAuth = await client.get("/api/config/tax", { auth: false });
  checks.ok("tax config rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── The router is actually mounted ────────────────────────────────────────
  // Before this PR an authed call here 404'd: the file existed but was never
  // wired into api/index.ts.
  const cfg = await client.get("/api/config/tax");
  checks.ok(
    "GET /api/config/tax → 200 (router registered)",
    cfg.status === 200,
    `got ${cfg.status}${cfg.status === 404 ? " — router not mounted in api/index.ts" : ""}` +
      `${cfg.status === 500 ? " — migration 0115 not applied to remote" : ""}`,
  );
  checks.ok(
    "payload shape { rate, address, history[], warning }",
    Boolean(cfg.json) && "rate" in cfg.json && Array.isArray(cfg.json.history),
    JSON.stringify(Object.keys(cfg.json ?? {})),
  );

  // ── The property address drives everything ────────────────────────────────
  const addr = cfg.json?.address;
  if (!addr) {
    checks.info(
      "no property address resolved — set street, city and ZIP in /admin/config/address " +
        "(CDTFA needs all three). Rate checks below will be skipped.",
    );
    checks.ok("a missing address warns rather than erroring", typeof cfg.json?.warning === "string", "warning absent");
  } else {
    checks.info(`address: ${addr.formatted}`);
    checks.ok("address carries city (CDTFA rejects a partial address)", Boolean(addr.city), "city empty");
  }

  // ── The resolved rate ─────────────────────────────────────────────────────
  const rate = cfg.json?.rate;
  if (rate) {
    checks.info(`rate: ${rate.ratePercent}% · ${rate.jurisdiction ?? "?"} · source=${rate.source}`);
    checks.ok(
      "rate is stored as integer ppm, not a float percent",
      Number.isInteger(rate.ratePpm),
      `ratePpm=${rate.ratePpm}`,
    );
    checks.ok(
      "ratePercent is derived from ratePpm and cannot disagree",
      Math.round(rate.ratePercent * 10_000) === rate.ratePpm,
      `${rate.ratePercent}% vs ${rate.ratePpm}ppm`,
    );
    checks.ok(
      `126 Colby resolves to 8.625% (${EXPECTED_PPM} ppm)`,
      rate.ratePpm === EXPECTED_PPM,
      `got ${rate.ratePpm} — matches the DJ Bath Plus and PGKB quotes' tax line`,
    );
    checks.ok("the current rate is open-ended (effectiveTo null)", rate.effectiveTo === null, `got ${rate.effectiveTo}`);
  } else {
    checks.info(`no rate resolved — warning: ${cfg.json?.warning ?? "(none)"}`);
    checks.ok(
      "a failed lookup explains itself rather than failing silently",
      typeof cfg.json?.warning === "string" && cfg.json.warning.length > 0,
      "no warning text",
    );
  }

  // ── Re-check is idempotent, not history-churning ──────────────────────────
  // Re-resolving the same rate must NOT append a row; only a CHANGED rate
  // supersedes. Otherwise every refresh would pollute the audit trail.
  const before = (cfg.json?.history ?? []).length;
  const refreshed = await client.post("/api/config/tax/refresh", {});
  checks.ok("POST /refresh → 200", refreshed.status === 200, `got ${refreshed.status}`);

  const after = (refreshed.json?.history ?? []).length;
  checks.ok(
    "re-checking an unchanged rate does not append a history row",
    after === before,
    `history ${before} → ${after}`,
  );

  // ── History is append-only ────────────────────────────────────────────────
  // Whatever rows exist, at most one may be current. Two open-ended rows would
  // make "the rate right now" ambiguous.
  const open = (refreshed.json?.history ?? []).filter((h) => h.effectiveTo === null);
  checks.ok("at most one open-ended rate row", open.length <= 1, `${open.length} rows with effectiveTo null`);

  // ── Regression guard: the config surface this shipped alongside ───────────
  const adminCfg = await client.get("/api/admin/config");
  checks.ok("admin config read path still 200", adminCfg.status === 200, `got ${adminCfg.status}`);

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
