#!/usr/bin/env node
/**
 * doBugCheck.mjs — pre-deploy gate for the Durable Object billing runaway.
 *
 * On 2026-07-19 the RemodelOrchestrator DO's `cf_agents_schedules` table grew
 * to ~1M rows because `this.schedule()` is append-only and was called from
 * onStart() (fires every wake) with no dedupe. Every alarm then full-scanned
 * it: ~3B DO row reads/hour, ~67B/day, a >$700 bill. This script makes that
 * class of mistake FAIL THE BUILD instead of the invoice.
 *
 * Two checks:
 *   1. STATIC — scan the source for Agent DOs that call `this.schedule()`
 *      without a `DELETE FROM cf_agents_schedules` dedupe/purge guard, and for
 *      scheduling inside onStart()/finally without one. Always runs.
 *   2. BILLING — if a Cloudflare API token + account id are in the environment,
 *      query the Analytics API for per-namespace DO rows-read over 24h and fail
 *      if any namespace is in runaway territory. Skipped (with a warning) when
 *      no token is present, so local/offline builds still get the static gate.
 *
 * Exit code 1 blocks deployment. Wired ahead of `wrangler deploy` in the
 * `deploy` npm script.
 *
 *   node scripts/doBugCheck.mjs            # both checks
 *   node scripts/doBugCheck.mjs --no-billing
 *   node scripts/doBugCheck.mjs --json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const ROWS_READ_24H_ALERT = 1_000_000_000; // 1B/day — ~1000x normal
const ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || "b3304b14848de15c72c24a14b0cd187d";

// ── static scan ────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Return the line number (1-based) of the first regex match, or 0. */
function lineOf(source, re) {
  const idx = source.search(re);
  if (idx < 0) return 0;
  return source.slice(0, idx).split("\n").length;
}

/**
 * A file is safe if it purges/dedupes the schedule table. We accept an
 * explicit `DELETE FROM cf_agents_schedules` (the guard RemodelOrchestrator
 * uses) as proof the author handled append-only growth.
 */
const GUARD_RE = /DELETE\s+FROM\s+cf_agents_schedules/i;
const SCHEDULE_RE = /this\.schedule\s*\(/;

function scanSource() {
  const findings = [];
  const files = walk(SRC);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!SCHEDULE_RE.test(source)) continue;
    const rel = file.slice(ROOT.length + 1);

    if (!GUARD_RE.test(source)) {
      findings.push({
        file: rel,
        line: lineOf(source, SCHEDULE_RE),
        rule: "schedule-without-purge-guard",
        detail:
          "this.schedule() is append-only and does not dedupe. This DO calls " +
          "it but never DELETEs cf_agents_schedules — the exact shape of the " +
          "$700 runaway. Add an ensureXSchedule() that clears prior rows " +
          "before scheduling (see RemodelOrchestrator.ensureAuditSchedule).",
      });
      continue; // one finding per file is enough to block
    }

    // Guarded file: still flag the two smells that make growth compound, so a
    // reviewer double-checks the guard actually runs on these paths.
    const onStartIdx = source.search(/async\s+onStart\s*\(/);
    if (onStartIdx >= 0) {
      const body = source.slice(onStartIdx, onStartIdx + 600);
      if (SCHEDULE_RE.test(body) && !GUARD_RE.test(body)) {
        findings.push({
          file: rel,
          line: source.slice(0, onStartIdx).split("\n").length,
          rule: "schedule-in-onstart",
          detail:
            "onStart() fires on EVERY DO wake, not once. It schedules without " +
            "a purge in the same method — confirm it routes through a guarded " +
            "ensureXSchedule().",
          warnOnly: true,
        });
      }
    }
  }
  return findings;
}

// ── billing scan (best-effort) ───────────────────────────────────────────────

function billingToken() {
  return (
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CLOUDFLARE_WRANGLER_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    null
  );
}

async function scanBilling() {
  const token = billingToken();
  if (!token) {
    return {
      skipped: true,
      reason:
        "no CLOUDFLARE_API_TOKEN in env — static gate still enforced; set a " +
        "token (Account Analytics:Read) to gate on live billing too",
      findings: [],
    };
  }

  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = `query($acct:String!,$start:Date!,$end:Date!){
    viewer{accounts(filter:{accountTag:$acct}){
      durableObjectsPeriodicGroups(limit:5000,filter:{date_geq:$start,date_leq:$end}){
        dimensions{namespaceId} sum{rowsRead}}}}}`;

  let data;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { acct: ACCOUNT_ID, start, end },
      }),
    });
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
    data = body.data;
  } catch (err) {
    return {
      skipped: true,
      reason: `billing query failed (${err.message}) — static gate still enforced`,
      findings: [],
    };
  }

  const groups = data?.viewer?.accounts?.[0]?.durableObjectsPeriodicGroups ?? [];
  const byNs = new Map();
  for (const g of groups) {
    const id = g.dimensions.namespaceId;
    byNs.set(id, (byNs.get(id) ?? 0) + g.sum.rowsRead);
  }
  const findings = [];
  for (const [namespaceId, rowsRead] of byNs) {
    if (rowsRead >= ROWS_READ_24H_ALERT) {
      findings.push({
        namespaceId,
        rowsRead,
        rule: "billing-runaway",
        detail: `namespace ${namespaceId} read ${(rowsRead / 1e9).toFixed(
          2,
        )}B rows in 24h (alert ≥ ${(ROWS_READ_24H_ALERT / 1e9).toFixed(2)}B)`,
      });
    }
  }
  return { skipped: false, findings };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const noBilling = args.includes("--no-billing");

  const staticFindings = scanSource();
  const billing = noBilling
    ? { skipped: true, reason: "--no-billing", findings: [] }
    : await scanBilling();

  const blocking = [
    ...staticFindings.filter((f) => !f.warnOnly),
    ...billing.findings,
  ];
  const warnings = staticFindings.filter((f) => f.warnOnly);

  if (asJson) {
    console.log(
      JSON.stringify({ staticFindings, billing, blocking: blocking.length }, null, 2),
    );
    process.exit(blocking.length ? 1 : 0);
  }

  console.log("doBugCheck — Durable Object billing-runaway gate\n");

  if (billing.skipped) console.log(`  billing check skipped: ${billing.reason}\n`);

  for (const w of warnings) {
    console.log(`  WARN  ${w.file}:${w.line}  [${w.rule}]\n        ${w.detail}\n`);
  }

  if (blocking.length === 0) {
    console.log("  PASS — no schedule-runaway pattern, no billing runaway.");
    process.exit(0);
  }

  console.log(`  BLOCK — ${blocking.length} issue(s) must be fixed before deploy:\n`);
  for (const f of blocking) {
    if (f.file) {
      console.log(`  ✗ ${f.file}:${f.line}  [${f.rule}]\n    ${f.detail}\n`);
    } else {
      console.log(`  ✗ [${f.rule}]  ${f.detail}\n`);
    }
  }
  console.log("Deployment blocked. See scripts/do_billing_watch.py to inspect live usage.");
  process.exit(1);
}

// Tiny self-check: the guarded orchestrator must pass, an unguarded stub must fail.
if (process.argv.includes("--selftest")) {
  const findings = scanSource();
  const orch = findings.find((f) =>
    f.file.includes("RemodelOrchestrator") && !f.warnOnly,
  );
  if (orch) {
    console.error("selftest FAIL: guarded RemodelOrchestrator was flagged as blocking");
    process.exit(1);
  }
  // Prove the rule fires on an unguarded snippet.
  const fake = "class X extends Agent { async onStart(){ await this.schedule(60,'x'); } }";
  if (GUARD_RE.test(fake) || !SCHEDULE_RE.test(fake)) {
    console.error("selftest FAIL: rule regexes wrong");
    process.exit(1);
  }
  console.log("selftest ok: guard recognized, unguarded pattern detectable");
  process.exit(0);
}

main();
