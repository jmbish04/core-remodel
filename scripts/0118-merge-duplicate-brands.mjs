#!/usr/bin/env node
/**
 * @fileoverview Merge duplicate brand rows into one, without deleting anything.
 *
 * A duplicate pair ("Dornbracht" #18 / "DORN BRACHT" #315) splits its data: each
 * side holds some of the showroom mappings, so the directory shows one brand
 * twice with half its showrooms each.
 *
 * SOFT DELETE, NEVER DELETE. Every FK into `brands` is ON DELETE CASCADE across
 * 7 tables, so `DELETE FROM brands WHERE id = 315` would silently take that
 * brand's showroom mappings, type mappings, product links and intel with it.
 * The loser is flagged `is_active = 0` after its rows have been repointed.
 *
 * ONLY NAME MATCHES AUTO-MERGE. Normalised name equality (case / punctuation /
 * suffix-insensitive) means the two rows are the same string written
 * differently — "NEWPORTBRASS" and "Newport Brass" cannot be different
 * companies.
 *
 * A SHARED DOMAIN IS NOT A DUPLICATE, and this is the trap worth stating
 * plainly: one company publishes many distinct brands on one site. Auto-merging
 * on domain would have collapsed Silestone into Dekton (both cosentino.com),
 * Magnifica Porcelain Slabs into Bedrosians, and Claybrook into Armac Martin —
 * all genuinely separate brands. Domain matches are therefore REPORTED as
 * candidates for review and merged only when named explicitly with --pair.
 *
 * THE UNIQUE-INDEX TRAP: brand_type_mappings has UNIQUE(brand_id, type_id) and
 * showroom_brand_mappings has UNIQUE(showroom_id, brand_id). When both sides
 * share a type or a showroom, repointing the loser's row collides and the
 * statement fails — measured on 4 of the 9 live pairs. Colliding rows are
 * deleted FIRST (the survivor already carries that mapping, so nothing is
 * lost), then the remainder is repointed.
 *
 * Usage:
 *   node scripts/0118-merge-duplicate-brands.mjs --remote --plan
 *   node scripts/0118-merge-duplicate-brands.mjs --remote --dry-run
 *   node scripts/0118-merge-duplicate-brands.mjs --remote --apply
 *   node scripts/0118-merge-duplicate-brands.mjs --remote --apply --pair 18:315
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";
const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

/** Tables holding a brand_id that must follow the merge. */
const FK_TABLES = [
  "showroom_store_products",
  "brand_categories",
  "brand_images",
  "brand_intel",
  "brand_product_lines",
  "brand_type_mappings",
  "showroom_brand_mappings",
];

/** (table, column) pairs whose UNIQUE index can collide when repointing. */
const COLLIDABLE = [
  ["brand_type_mappings", "type_id"],
  ["showroom_brand_mappings", "showroom_id"],
];

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, mode, "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*\{[\s\S]*\}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const nameKey = (n) =>
  String(n ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(inc|llc|ltd|corp|company|usa|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

const domainOf = (u) => {
  if (!u) return null;
  const host = String(u)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase()
    .replace(/\/$/, "");
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host || null;
};

/**
 * Pair up duplicates. Survivor is the LOWER id — the older row, most likely to
 * be the one other data already references.
 */
function findPairs(rows) {
  const byKey = new Map();
  const byDomain = new Map();
  for (const r of rows) {
    const k = nameKey(r.name);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), r]);
    const d = domainOf(r.website_url);
    if (d) byDomain.set(d, [...(byDomain.get(d) ?? []), r]);
  }

  const pairs = new Map();
  const addGroup = (group, reason) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    const keep = sorted[0];
    for (const drop of sorted.slice(1)) {
      if (!pairs.has(drop.id)) pairs.set(drop.id, { keep, drop, reason });
    }
  };

  for (const g of byKey.values()) addGroup(g, "name");
  const autoMerge = [...pairs.values()];

  // Domain candidates are collected SEPARATELY and never merged automatically —
  // see the header. A same-domain pair is a question for a human, not a fact.
  const review = [];
  for (const g of byDomain.values()) {
    if (g.length !== 2) continue; // 3+ on a domain is a portfolio, not a dupe
    const sorted = [...g].sort((a, b) => a.id - b.id);
    if (pairs.has(sorted[1].id)) continue; // already merging on name
    if (nameKey(sorted[0].name) === nameKey(sorted[1].name)) continue;
    review.push({ keep: sorted[0], drop: sorted[1], reason: "domain" });
  }

  return { autoMerge, review };
}

/** SQL that merges one pair, in an order that cannot lose data. */
function mergeSql({ keep, drop }) {
  const out = [];
  out.push(`-- merge #${drop.id} "${drop.name}" -> #${keep.id} "${keep.name}"`);

  // 1. Drop the loser's rows that would violate a UNIQUE index on repoint. The
  //    survivor already holds an equivalent mapping, so this loses nothing.
  for (const [table, col] of COLLIDABLE) {
    out.push(
      `DELETE FROM ${table} WHERE brand_id = ${drop.id} AND ${col} IN (` +
        `SELECT ${col} FROM ${table} WHERE brand_id = ${keep.id});`,
    );
  }

  // 2. Repoint everything that remains.
  for (const table of FK_TABLES) {
    out.push(`UPDATE ${table} SET brand_id = ${keep.id} WHERE brand_id = ${drop.id};`);
  }

  // 3. Carry the loser's spellings across as ALIASES — demoted, because the
  //    partial unique index allows only one primary per brand, and deduped
  //    against names the survivor already has.
  out.push(
    `UPDATE brand_name_variations SET brand_id = ${keep.id}, is_primary = 0 ` +
      `WHERE brand_id = ${drop.id} AND brand_name NOT IN (` +
      `SELECT brand_name FROM brand_name_variations WHERE brand_id = ${keep.id});`,
  );
  out.push(`DELETE FROM brand_name_variations WHERE brand_id = ${drop.id};`);

  // 4. Fill any blank on the survivor from the loser before retiring it.
  for (const col of [
    "description",
    "website_url",
    "instagram_url",
    "icon_cf_images_url",
    "price_point",
    "facebook_url",
    "pinterest_url",
    "online_rating",
  ]) {
    out.push(
      `UPDATE brands SET ${col} = (SELECT ${col} FROM brands WHERE id = ${drop.id}) ` +
        `WHERE id = ${keep.id} AND ${col} IS NULL;`,
    );
  }

  // 5. Retire. NOT a DELETE — see the file header.
  out.push(`UPDATE brands SET is_active = 0 WHERE id = ${drop.id};`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------

const only = args.includes("--pair") ? args[args.indexOf("--pair") + 1] : null;
const rows = d1("SELECT id, name, website_url FROM brands WHERE is_active = 1;");
const { autoMerge, review } = findPairs(rows);
let pairs = autoMerge;
if (only) {
  pairs = [...autoMerge, ...review];
  const [k, d] = only.split(":").map(Number);
  pairs = pairs.filter((p) => p.keep.id === k && p.drop.id === d);
  if (!pairs.length) {
    console.error(`no duplicate pair ${only} found among active brands`);
    process.exit(1);
  }
}

if (args.includes("--plan") || (!args.includes("--apply") && !args.includes("--dry-run"))) {
  console.log(
    `${rows.length} active brands\n` +
      `  ${pairs.length} name-duplicate pair(s) — safe to auto-merge\n` +
      `  ${review.length} same-domain pair(s) — REVIEW ONLY, not merged\n`,
  );
  for (const p of pairs) {
    const counts = FK_TABLES.map((t) => {
      const [r] = d1(`SELECT count(*) c FROM ${t} WHERE brand_id = ${p.drop.id};`);
      return r?.c ? `${t.replace("showroom_", "")}=${r.c}` : null;
    }).filter(Boolean);
    console.log(
      `  keep #${p.keep.id} "${p.keep.name}"  <-  drop #${p.drop.id} "${p.drop.name}"  [${p.reason}]`,
    );
    console.log(`      moving: ${counts.join(" ") || "(no rows)"}`);
  }
  if (review.length) {
    console.log("\nSAME-DOMAIN CANDIDATES — a shared site is not proof of a shared brand.");
    console.log("Merge one only if you know it is the same brand: --apply --pair keep:drop");
    for (const p of review) {
      console.log(`  #${p.keep.id} "${p.keep.name}"  ?  #${p.drop.id} "${p.drop.name}"`);
    }
  }
  if (!args.includes("--plan")) console.log("\nre-run with --apply to execute");
  process.exit(0);
}

const sql = pairs.map(mergeSql).join("\n\n");
if (args.includes("--dry-run")) {
  console.log(sql);
  process.exit(0);
}

const file = join(tmpdir(), `merge-brands-${process.pid}.sql`);
writeFileSync(file, sql + "\n");
console.log(`merging ${pairs.length} pair(s) (${mode})\n  ${file}`);
execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
  encoding: "utf8",
  stdio: "inherit",
  maxBuffer: 64 * 1024 * 1024,
});
console.log("done — verify with the /api/brands/health endpoint");
