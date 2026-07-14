#!/usr/bin/env node
/**
 * @fileoverview One-off backfill: the legacy `showroom_stores.hours_json` blob →
 * normalized `showroom_store_hours` rows, for any store that has a blob but no
 * rows yet. Run AFTER the contacts migrations, BEFORE migration 0089 (which
 * drops the hours_json column). Idempotent — INSERT OR IGNORE on (showroom_id, day).
 *
 * Usage:
 *   node scripts/0089-backfill-hoursjson-to-rows.mjs --remote --dry-run
 *   node scripts/0089-backfill-hoursjson-to-rows.mjs --remote
 *   node scripts/0089-backfill-hoursjson-to-rows.mjs --local
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";
const KEY_TO_ENUM = {
  mon: "MONDAY", tue: "TUESDAY", wed: "WEDNESDAY", thu: "THURSDAY",
  fri: "FRIDAY", sat: "SATURDAY", sun: "SUNDAY",
};

function d1Query(mode, sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, mode, "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

// Stores with a hours_json blob but NO normalized rows yet.
const rows = d1Query(
  mode,
  `SELECT s.id, s.hours_json FROM showroom_stores s
   WHERE s.hours_json IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM showroom_store_hours h WHERE h.showroom_id = s.id)`,
);
console.log(`${rows.length} stores with a hours_json blob and no rows`);

const stmts = [];
let skipped = 0;
for (const row of rows) {
  let hj;
  try {
    hj = typeof row.hours_json === "string" ? JSON.parse(row.hours_json) : row.hours_json;
  } catch {
    skipped++;
    continue;
  }
  if (!hj || typeof hj !== "object") { skipped++; continue; }
  for (const [key, enumDay] of Object.entries(KEY_TO_ENUM)) {
    const slot = hj[key];
    if (!slot || !slot.open || !slot.close) continue;
    const [oh, om] = String(slot.open).split(":").map((n) => parseInt(n, 10) || 0);
    const [ch, cm] = String(slot.close).split(":").map((n) => parseInt(n, 10) || 0);
    stmts.push(
      `INSERT OR IGNORE INTO showroom_store_hours (showroom_id, day, open_hour, open_minute, close_hour, close_minute) VALUES (${row.id}, '${enumDay}', ${oh}, ${om}, ${ch}, ${cm});`,
    );
  }
}

console.log(`${stmts.length} row inserts; ${skipped} unparseable stores skipped`);
if (args.includes("--dry-run")) {
  console.log(stmts.slice(0, 14).join("\n"));
} else if (stmts.length > 0) {
  const file = join(tmpdir(), `backfill-hoursjson-${process.pid}.sql`);
  writeFileSync(file, stmts.join("\n") + "\n");
  execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
    encoding: "utf8", stdio: "inherit", maxBuffer: 64 * 1024 * 1024,
  });
  console.log("done");
}
