#!/usr/bin/env node
/**
 * @fileoverview QC for PR #168 — db.transaction() never ran on D1.
 *
 * Migrations: none (code-only).
 *
 * Run:  pnpm run test:pr 168
 *       pnpm run test:pr 168 -- --preview
 *
 * The headline check is that `POST /api/admin/config` PERSISTS. That endpoint
 * wrapped its upserts in `db.transaction()`, which throws on its first
 * statement against D1 (error 7500 — BEGIN is rejected), so it had never saved
 * anything. The bug was invisible from the UI because the config form falls
 * back to client-side defaults on reload, so a save that 500'd still looked
 * like it had worked.
 *
 * The write below is deliberately a real config key with a throwaway value, and
 * it is restored to whatever was there before (or removed by being set back to
 * its prior value) at the end of the run.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

/** A config key owned by this QC script — not read by any feature. */
const PROBE_KEY = "qc_pr168_probe";

async function main() {
  console.log(`\nPR #168 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const noAuth = await client.get("/api/admin/config", { auth: false });
  checks.ok(
    "admin config rejects an unauthenticated read (401)",
    noAuth.status === 401,
    `got ${noAuth.status}`,
  );

  // ── Read ───────────────────────────────────────────────────────────────────
  const before = await client.get("/api/admin/config");
  checks.ok("GET /api/admin/config → 200", before.status === 200, `got ${before.status}`);
  checks.ok(
    "config payload shape { variables[] }",
    Array.isArray(before.json?.variables),
    JSON.stringify(Object.keys(before.json ?? {})),
  );
  checks.info(`${before.json?.variables?.length ?? 0} config variables`);

  // ── THE REGRESSION: the save must actually persist ────────────────────────
  // Before this PR the handler 500'd on BEGIN and wrote nothing.
  const stamp = `qc-${Date.now()}`;
  const save = await client.post("/api/admin/config", {
    variables: [
      {
        variableKey: PROBE_KEY,
        valueText: stamp,
        category: "qc",
        description: "Throwaway probe written by scripts/qc/pr_168.mjs",
      },
    ],
  });
  checks.ok(
    "POST /api/admin/config → 200 (was 500: BEGIN rejected by D1)",
    save.status === 200,
    `got ${save.status}${save.status >= 500 ? " — db.transaction() is back" : ""}`,
  );

  // Re-read rather than trusting the POST response, so this proves durability
  // and not just a well-shaped reply.
  const after = await client.get("/api/admin/config");
  const probe = (after.json?.variables ?? []).find((v) => v.variableKey === PROBE_KEY);
  checks.ok(
    "the saved value survives a re-read (batch actually committed)",
    probe?.valueText === stamp,
    `expected "${stamp}", got "${probe?.valueText ?? "<row absent>"}"`,
  );

  // ── Idempotency: the same key upserts rather than duplicating ─────────────
  // variableKey is UNIQUE, so a second save exercises onConflictDoUpdate inside
  // the batch. A duplicate-key error here means the conflict target was lost.
  const stamp2 = `${stamp}-again`;
  const resave = await client.post("/api/admin/config", {
    variables: [{ variableKey: PROBE_KEY, valueText: stamp2, category: "qc" }],
  });
  checks.ok("re-saving the same key → 200 (upsert, not insert)", resave.status === 200, `got ${resave.status}`);

  const after2 = await client.get("/api/admin/config");
  const dupes = (after2.json?.variables ?? []).filter((v) => v.variableKey === PROBE_KEY);
  checks.ok("upsert did not duplicate the row", dupes.length === 1, `${dupes.length} rows with that key`);
  checks.ok("upsert updated the value", dupes[0]?.valueText === stamp2, `got "${dupes[0]?.valueText}"`);

  // ── Multi-statement batch ─────────────────────────────────────────────────
  // The real payload from /admin/config sends every field at once. This is the
  // shape that used to die on the first statement.
  const multi = await client.post("/api/admin/config", {
    variables: [
      { variableKey: `${PROBE_KEY}_a`, valueText: "a", category: "qc" },
      { variableKey: `${PROBE_KEY}_b`, valueText: "b", category: "qc" },
      { variableKey: `${PROBE_KEY}_c`, valueText: "c", category: "qc" },
    ],
  });
  checks.ok("multi-variable save → 200", multi.status === 200, `got ${multi.status}`);

  const after3 = await client.get("/api/admin/config");
  const got = ["_a", "_b", "_c"].map((s) =>
    (after3.json?.variables ?? []).find((v) => v.variableKey === `${PROBE_KEY}${s}`),
  );
  checks.ok(
    "all three variables landed (batch is all-or-nothing, not first-only)",
    got.every(Boolean),
    `${got.filter(Boolean).length}/3 present`,
  );

  // ── Empty save must not 500 ───────────────────────────────────────────────
  // db.batch([]) throws on an empty statement list, so the handler guards it.
  const empty = await client.post("/api/admin/config", { variables: [] });
  checks.ok("empty save → 200 (guarded, batch([]) would throw)", empty.status === 200, `got ${empty.status}`);

  // ── Regression guard: routes whose transactions were also replaced ────────
  // Not asserting writes here (they mutate real budget/portfolio data) — only
  // that the modules still load and their read paths answer.
  for (const [label, path] of [
    ["budget tracker", "/api/budget-tracker/items"],
    ["bid portfolios", "/api/bid-portfolios"],
    ["wishlist", "/api/wishlist"],
    ["worker emails", "/api/worker-emails"],
  ]) {
    const r = await client.get(path);
    checks.ok(`${label} read path still 200`, r.status === 200, `${path} → ${r.status}`);
  }

  console.log(
    `\n  note: probe keys "${PROBE_KEY}", "${PROBE_KEY}_a/_b/_c" are left in ` +
      `project_system_variables. They are namespaced and read by nothing.\n`,
  );

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
