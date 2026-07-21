#!/usr/bin/env node
/**
 * @fileoverview One-off backfill: seed `brand_name_variations` from `brands.name`.
 *
 * Every existing brand gets exactly one variation row, marked `is_primary`, so
 * the variations table becomes the source of truth for display names without
 * anything changing visually. Additional spellings accumulate afterwards, as
 * scrapes and imports encounter them.
 *
 * Idempotent twice over:
 *   - `WHERE NOT EXISTS` on (brand_id, brand_name) means a re-run inserts nothing;
 *   - the partial unique index `brand_name_variations_one_primary` makes a second
 *     primary for the same brand impossible at the DB level, so a buggy re-run
 *     fails loudly rather than quietly creating two display names.
 *
 * RUN ORDER: after migration 0116 (creates the table). Safe to run repeatedly.
 *
 * Usage:
 *   node scripts/0116-backfill-brand-name-variations.mjs --remote --dry-run
 *   node scripts/0116-backfill-brand-name-variations.mjs --remote
 *   node scripts/0116-backfill-brand-name-variations.mjs --remote --report
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";

const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

/**
 * Seed one primary variation per brand.
 *
 * Written as INSERT…SELECT rather than a row-per-brand loop so it is one
 * statement regardless of table size — D1 caps a statement at 100 bound
 * parameters, and this binds none.
 *
 * `trim()` guards against a stored name with stray whitespace becoming a
 * variation that never matches the trimmed lookups.
 */
const SEED = `
INSERT INTO brand_name_variations (brand_id, brand_name, is_active, is_primary)
SELECT b.id, trim(b.name), 1, 1
  FROM brands b
 WHERE b.name IS NOT NULL
   AND trim(b.name) != ''
   AND NOT EXISTS (
     SELECT 1 FROM brand_name_variations v
      WHERE v.brand_id = b.id AND v.brand_name = trim(b.name)
   )
   -- Never create a second primary; the partial unique index would reject the
   -- whole statement and abort the backfill.
   AND NOT EXISTS (
     SELECT 1 FROM brand_name_variations v
      WHERE v.brand_id = b.id AND v.is_primary = 1
   );
`.trim();

const REPORT = `
SELECT (SELECT count(*) FROM brands) AS brands,
       (SELECT count(*) FROM brand_name_variations) AS variations,
       (SELECT count(*) FROM brand_name_variations WHERE is_primary = 1) AS primaries,
       (SELECT count(*) FROM brands b
          WHERE NOT EXISTS (SELECT 1 FROM brand_name_variations v
                             WHERE v.brand_id = b.id AND v.is_primary = 1)) AS brands_without_primary,
       (SELECT count(*) FROM (SELECT brand_id FROM brand_name_variations
                               WHERE is_primary = 1 GROUP BY brand_id
                              HAVING count(*) > 1)) AS brands_with_multiple_primaries;
`.trim();

function run(sql, label) {
  const file = join(tmpdir(), `${label}-${process.pid}.sql`);
  writeFileSync(file, sql + "\n");
  execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
}

if (args.includes("--dry-run")) {
  console.log(SEED);
  process.exit(0);
}

if (args.includes("--report")) {
  execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, `--command=${REPORT}`], {
    encoding: "utf8",
    stdio: "inherit",
  });
  process.exit(0);
}

console.log(`seeding one primary variation per brand (${mode})`);
run(SEED, "backfill-brand-name-variations");
console.log("done — re-run with --report to verify the invariant");
