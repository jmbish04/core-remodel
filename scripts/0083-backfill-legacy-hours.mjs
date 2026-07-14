#!/usr/bin/env node
/**
 * @fileoverview One-off backfill: legacy `weekday_hours` free-text → structured
 * `hours_json` + normalized `showroom_store_hours` rows + `is_open_weekends`.
 *
 * RUN ORDER (see docs / showroom-stores-cleanup):
 *   1. apply migration 0082 (renames showroom_hours → showroom_store_hours)
 *   2. THIS script  (reads weekday_hours, still present)
 *   3. apply migration 0083 (drops weekday_hours / weekend_hours)
 *
 * The parser below MIRRORS `parseLegacyHoursText` in
 * `src/backend/utils/showroom-hours.ts` — kept inline so this throwaway script
 * has no build step. `node scripts/0083-backfill-legacy-hours.mjs --selftest`
 * asserts it against real sampled rows.
 *
 * Usage:
 *   node scripts/0083-backfill-legacy-hours.mjs --selftest
 *   node scripts/0083-backfill-legacy-hours.mjs --remote --dry-run
 *   node scripts/0083-backfill-legacy-hours.mjs --remote
 *   node scripts/0083-backfill-legacy-hours.mjs --local
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";

const DB = "core-remodel";
const DAY_NAME_TO_KEY = {
  monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu",
  friday: "fri", saturday: "sat", sunday: "sun",
};
const KEY_TO_ENUM = {
  mon: "MONDAY", tue: "TUESDAY", wed: "WEDNESDAY", thu: "THURSDAY",
  fri: "FRIDAY", sat: "SATURDAY", sun: "SUNDAY",
};

/** "8:00 AM" / "8 AM" / "12:30 PM" → 24h "HH:MM", or null. */
function parse12hToHhmm(token) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/.exec(token.trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const isPm = m[3].toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (isPm) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Full-week free-text block → {mon..sun: {open,close}|null}, or null if nothing parsed. */
function parseLegacyHoursText(text) {
  if (!text) return null;
  const out = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  let parsedAny = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const dm = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(line);
    if (!dm) continue;
    const key = DAY_NAME_TO_KEY[dm[1].toLowerCase()];
    if (!key) continue;
    const value = dm[2].trim();
    if (/^closed$/i.test(value)) { out[key] = null; parsedAny = true; continue; }
    const parts = value.split(/\s*[–—-]\s*/);
    if (parts.length < 2) continue;
    const open = parse12hToHhmm(parts[0]);
    const close = parse12hToHhmm(parts[1]);
    if (!open || !close) continue;
    out[key] = { open, close };
    parsedAny = true;
  }
  return parsedAny ? out : null;
}

function isOpenWeekends(hj) {
  return Boolean(hj.sat || hj.sun);
}

// ─── self-test ────────────────────────────────────────────────────────────────
function selftest() {
  const s42 = "Monday: 8:00 AM – 4:30 PM\nTuesday: 8:00 AM – 4:30 PM\nWednesday: 8:00 AM – 4:30 PM\nThursday: 8:00 AM – 4:30 PM\nFriday: 8:00 AM – 4:30 PM\nSaturday: 8:30 AM – 3:30 PM\nSunday: Closed";
  const r = parseLegacyHoursText(s42);
  assert.deepStrictEqual(r.mon, { open: "08:00", close: "16:30" });
  assert.deepStrictEqual(r.sat, { open: "08:30", close: "15:30" });
  assert.strictEqual(r.sun, null);
  assert.strictEqual(isOpenWeekends(r), true);

  // both weekend days closed
  const s52 = "Monday: 7:30 AM – 4:00 PM\nSaturday: Closed\nSunday: Closed";
  const r2 = parseLegacyHoursText(s52);
  assert.deepStrictEqual(r2.mon, { open: "07:30", close: "16:00" });
  assert.strictEqual(isOpenWeekends(r2), false);

  // open 7 days incl Sunday afternoon
  const s50 = "Sunday: 10:00 AM – 4:00 PM";
  assert.deepStrictEqual(parseLegacyHoursText(s50).sun, { open: "10:00", close: "16:00" });

  // noon/midnight edge + hyphen variant
  assert.strictEqual(parse12hToHhmm("12:00 PM"), "12:00");
  assert.strictEqual(parse12hToHhmm("12:00 AM"), "00:00");
  assert.deepStrictEqual(parseLegacyHoursText("Monday: 9:00 AM - 5:00 PM").mon, { open: "09:00", close: "17:00" });

  // unparseable → null (nothing to migrate)
  assert.strictEqual(parseLegacyHoursText("By appointment only"), null);
  assert.strictEqual(parseLegacyHoursText(null), null);
  console.log("selftest OK");
}

// ─── remote/local backfill ──────────────────────────────────────────────────
function d1Query(mode, sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, mode, "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function run(mode, dryRun) {
  const rows = d1Query(
    mode,
    "SELECT id, weekday_hours FROM showroom_stores WHERE weekday_hours IS NOT NULL AND hours_json IS NULL",
  );
  console.log(`${rows.length} candidate stores (weekday_hours set, hours_json null)`);

  const stmts = [];
  const skipped = [];
  for (const row of rows) {
    const hj = parseLegacyHoursText(row.weekday_hours);
    if (!hj) { skipped.push(row.id); continue; }
    const jsonStr = JSON.stringify(hj);
    // Only fill when still blank (idempotent re-run safe).
    stmts.push(
      `UPDATE showroom_stores SET hours_json = ${sqlStr(jsonStr)}, is_open_weekends = ${isOpenWeekends(hj) ? 1 : 0}, updated_at = unixepoch() WHERE id = ${row.id} AND hours_json IS NULL;`,
    );
    for (const [key, enumDay] of Object.entries(KEY_TO_ENUM)) {
      const slot = hj[key];
      if (!slot) continue;
      const [oh, om] = slot.open.split(":").map((n) => parseInt(n, 10));
      const [ch, cm] = slot.close.split(":").map((n) => parseInt(n, 10));
      // INSERT OR IGNORE — unique(showroom_id, day) keeps re-runs safe.
      stmts.push(
        `INSERT OR IGNORE INTO showroom_store_hours (showroom_id, day, open_hour, open_minute, close_hour, close_minute) VALUES (${row.id}, ${sqlStr(enumDay)}, ${oh}, ${om}, ${ch}, ${cm});`,
      );
    }
  }

  console.log(`${stmts.length} SQL statements; ${skipped.length} unparseable skipped: [${skipped.join(", ")}]`);
  if (dryRun) {
    console.log("--- dry run; first 12 statements ---");
    console.log(stmts.slice(0, 12).join("\n"));
    return;
  }
  if (stmts.length === 0) return;

  const file = join(tmpdir(), `backfill-legacy-hours-${process.pid}.sql`);
  writeFileSync(file, stmts.join("\n") + "\n");
  console.log(`applying ${stmts.length} statements from ${file} ...`);
  execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log("done");
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  selftest();
} else {
  const mode = args.includes("--remote") ? "--remote" : "--local";
  run(mode, args.includes("--dry-run"));
}
