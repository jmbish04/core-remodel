#!/usr/bin/env node
/**
 * @fileoverview One-off backfill: flat URL columns on `showroom_stores`
 * (website_url / instagram_url / facebook_url / pinterest_url) → rows in
 * `showroom_store_links`.
 *
 * RUN ORDER: after the create-table migration (0085), BEFORE the column-drop
 * migration (reads the columns). Pure SQL, no external calls. Idempotent — the
 * NOT EXISTS guard means re-runs insert nothing new.
 *
 * Usage:
 *   node scripts/0085-backfill-store-links.mjs --local
 *   node scripts/0085-backfill-store-links.mjs --remote --dry-run
 *   node scripts/0085-backfill-store-links.mjs --remote
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";
const MAP = [
  ["website_url", "WEBSITE"],
  ["instagram_url", "INSTAGRAM"],
  ["facebook_url", "FACEBOOK"],
  ["pinterest_url", "PINTEREST"],
];

const stmts = MAP.map(
  ([col, type]) => `INSERT INTO showroom_store_links (store_id, url, type)
SELECT s.id, trim(s.${col}), '${type}'
FROM showroom_stores s
WHERE s.${col} IS NOT NULL AND trim(s.${col}) != ''
  AND NOT EXISTS (
    SELECT 1 FROM showroom_store_links l
    WHERE l.store_id = s.id AND l.type = '${type}' AND l.url = trim(s.${col})
  );`,
);

const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

if (args.includes("--dry-run")) {
  console.log(stmts.join("\n\n"));
  process.exit(0);
}

const file = join(tmpdir(), `backfill-store-links-${process.pid}.sql`);
writeFileSync(file, stmts.join("\n") + "\n");
console.log(`applying ${stmts.length} INSERT…SELECT statements (${mode}) from ${file} ...`);
execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
  encoding: "utf8",
  stdio: "inherit",
  maxBuffer: 64 * 1024 * 1024,
});
console.log("done");
