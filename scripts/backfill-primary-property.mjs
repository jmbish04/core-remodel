#!/usr/bin/env node
/**
 * The backfill `getPrimaryProperty()` has been waiting for.
 *
 *   node scripts/backfill-primary-property.mjs           # dry run
 *   node scripts/backfill-primary-property.mjs --apply
 *
 * WHY THIS EXISTS: `services/property.ts` reads the `properties` table first and
 * falls back to the legacy permit-config KV, with the comment "so callers work
 * pre-backfill … the backfill parses it into real parts once it runs". The table
 * shipped, the service shipped with its fallback, and the backfill never ran —
 * so `properties` is empty and every caller silently takes the fallback path.
 *
 * The fallback returns `id: null`. That is the actual cost: anything that needs
 * to REFERENCE the property — `projects.propertyId` in 0041 — has nothing to
 * point at. Formatting an address works fine without a row; relating to one does
 * not.
 *
 * WHAT IT DOES: parses the KV's single free-text street line into number + name
 * and writes one `is_primary` row. Idempotent — refuses if a primary already
 * exists.
 *
 * WHAT IT DELIBERATELY LEAVES NULL:
 *   latitude / longitude — geocoded on write by the address-save flow, which has
 *     the API binding. A script cannot do it correctly from here, and a WRONG
 *     coordinate is far worse than a null one for every proximity consumer.
 *     Null is also exactly what the fallback path returns today, so this is not
 *     a regression — saving the address once through /admin/config/address fills
 *     them in.
 *   sfAssessorBlock / sfAssessorLot — the config page owns these and they are
 *     not in this KV. Transcribing them from a screenshot is not a source.
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const DB = "core-remodel";

const sql = (command) => {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", command],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
};

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

/** "126 Colby Street" -> { number: "126", name: "Colby Street" } */
function splitStreet(line) {
  const m = /^\s*(\d+[A-Za-z]?)\s+(.*\S)\s*$/.exec(line ?? "");
  return m ? { number: m[1], name: m[2] } : { number: null, name: (line ?? "").trim() || null };
}

const existing = sql("SELECT id, label FROM properties WHERE is_primary = 1;");
if (existing.length > 0) {
  console.log(`primary property already exists (id ${existing[0].id}) — nothing to do`);
  process.exit(0);
}

const kv = new Map(
  sql(
    "SELECT variable_key, value_text FROM project_system_variables WHERE variable_key IN ('permits_target_address','permits_target_city','permits_target_zip');",
  ).map((r) => [r.variable_key, r.value_text]),
);

const street = kv.get("permits_target_address");
if (!street) {
  console.error("no permits_target_address in the config KV — nothing to back-fill from");
  process.exit(1);
}

const { number, name } = splitStreet(street);
const city = kv.get("permits_target_city") ?? null;
const zip = kv.get("permits_target_zip") ?? null;
const label = [number, name].filter(Boolean).join(" ").replace(/\s+(Street|St|Avenue|Ave|Road|Rd)$/i, "");

const insert =
  `INSERT INTO properties (is_primary, label, street_number, street_name, city, state, zip_code) ` +
  `VALUES (1, ${q(label)}, ${q(number)}, ${q(name)}, ${q(city)}, 'CA', ${q(zip)});`;

console.log("parsed from the legacy KV:");
console.log(`  label         ${label}`);
console.log(`  street        ${number} / ${name}`);
console.log(`  city / zip    ${city} / ${zip}`);
console.log(`  lat / lng     null — filled by saving once via /admin/config/address`);
console.log(`  block / lot   null — owned by the config page`);

if (!APPLY) {
  console.log(`\n--- dry run; pass --apply ---\n${insert}`);
  process.exit(0);
}

sql(insert);
const [row] = sql("SELECT id, label, street_number, street_name, city, zip_code FROM properties WHERE is_primary = 1;");
console.log(`\ncreated properties id ${row.id}: ${row.street_number} ${row.street_name}, ${row.city} ${row.zip_code}`);
