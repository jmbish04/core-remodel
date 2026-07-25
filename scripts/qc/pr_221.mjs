#!/usr/bin/env node
/**
 * QC for PR #221 — showroom store seed is bootstrap-only.
 * Run: node scripts/qc/pr_221.mjs            (prod — the regression guard)
 *      node scripts/qc/pr_221.mjs --preview  (branch preview worker)
 *
 * The fix makes seedShowroomStores skip entirely when any store already exists,
 * so a repeated POST /api/showroom-stores/seed can no longer clone the whole
 * directory. This QC proves the idempotency contract WITHOUT mutating data: it
 * records the showroom_stores count, POSTs /seed, and asserts the count is
 * unchanged. Against a populated DB (prod) this is a pure regression guard —
 * the guard must make the re-seed a no-op.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC showroom-seed-bootstrap-only against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

try {
  const before = d1("SELECT COUNT(*) n FROM showroom_stores;")[0]?.n;
  check("can read showroom_stores count", Number.isFinite(before), `count=${before}`);
  info(`showroom_stores before seed: ${before}`);

  // Re-run the seed. With the guard this must be a no-op on a populated DB.
  const res = await c.post("/api/showroom-stores/seed", {});
  check("POST /seed returns 200", res.status === 200, `status=${res.status} ${res.text?.slice(0, 200)}`);

  const after = d1("SELECT COUNT(*) n FROM showroom_stores;")[0]?.n;
  info(`showroom_stores after seed: ${after}`);
  check(
    "re-seed did NOT add rows (bootstrap-only guard held)",
    Number.isFinite(after) && after === before,
    `before=${before} after=${after}`,
  );

  // A tighter guard: no exact-duplicate (name,location_address) pairs should be
  // CREATED by the re-seed. Pre-existing duplicates from the earlier double-run
  // are reported for the separate dedup step, not failed here.
  const dupes = d1(
    "SELECT name, COUNT(*) n FROM showroom_stores GROUP BY name, location_address HAVING n > 1 ORDER BY n DESC;",
  );
  info(`existing (name,address) duplicate groups: ${dupes.length}`);
  if (dupes.length > 0) {
    info(`  (pre-existing — cleanup is the sign-off-gated dedup step, not this PR)`);
    for (const d of dupes.slice(0, 10)) info(`  ${d.n}× ${d.name}`);
  }
} catch (err) {
  check("QC ran without throwing", false, String(err?.message ?? err));
}

process.exit(summary().failed === 0 ? 0 : 1);
