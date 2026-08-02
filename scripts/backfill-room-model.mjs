#!/usr/bin/env node
/**
 * Backfill the deprecated `rooms` columns into the 0043 tables (§1, §3, §4).
 *
 *   node scripts/backfill-room-model.mjs            # report what WOULD move
 *   node scripts/backfill-room-model.mjs --apply
 *
 * Two moves, both idempotent (guarded by NOT EXISTS, so re-running is a no-op):
 *
 *   1. rooms.{length,width}_{feet,inches}  ->  room_measurements
 *      Converted to CANONICAL INCHES (feet*12 + inches). confidence = 'assumed'
 *      — these are pre-existing estimates, not freshly verified measurements, and
 *      the threshold must not treat them as `known`. perimeter is left NULL: it
 *      is measured, never derived, and 2*(L+W) would be a guess wearing the
 *      costume of a measurement for any non-rectangular room.
 *
 *      area_sq_ft is DELIBERATELY NOT carried over. Every stored `rooms.area_sq_ft`
 *      value equalled length × width — it was a cached rectangle, not a measured
 *      irregular footprint. Area is computed on read by takeoff.floorAreaSqFt();
 *      storing it would re-introduce exactly the staleness this model avoids.
 *      area_sq_ft_override stays NULL until a human measures a genuinely
 *      non-rectangular room.
 *
 *   2. rooms.{plumbing,electrical,structural,hvac,general}_notes + problem_areas
 *      ->  room_notes, tagged with the matching room_note_type_def where one
 *      exists. Three formats: the source is plain text, so markdown = plaintext
 *      and html is a <p>-wrapped copy.
 *
 * Nothing is dropped from `rooms`. This copies OUT; the columns stay, deprecated.
 * Run AFTER the note-type definitions are seeded (seed-room-definitions.mjs).
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const DB = "core-remodel";

const sql = (command, json = true) => {
  const args = ["wrangler", "d1", "execute", DB, "--remote"];
  if (json) args.push("--json");
  args.push("--command", command);
  const out = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!json) return null;
  return JSON.parse(out.slice(out.indexOf("["))) [0]?.results ?? [];
};
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// ── 1. Measurements ─────────────────────────────────────────────────────────
// One EXISTING_FLOORPLAN row per active room that has any dimension and does not
// already have an existing-measurement row.
const measurementSql =
  `INSERT INTO room_measurements ` +
  `(room_id, kind, length_inches, width_inches, confidence, measured_by) ` +
  `SELECT r.id, 'EXISTING_FLOORPLAN', ` +
  `  CASE WHEN r.length_feet IS NOT NULL OR r.length_inches IS NOT NULL ` +
  `    THEN COALESCE(r.length_feet,0)*12 + COALESCE(r.length_inches,0) END, ` +
  `  CASE WHEN r.width_feet IS NOT NULL OR r.width_inches IS NOT NULL ` +
  `    THEN COALESCE(r.width_feet,0)*12 + COALESCE(r.width_inches,0) END, ` +
  `  'assumed', 'backfill' ` +
  `FROM rooms r ` +
  `WHERE r.is_active = 1 ` +
  `  AND (r.length_feet IS NOT NULL OR r.width_feet IS NOT NULL OR r.area_sq_ft IS NOT NULL) ` +
  `  AND NOT EXISTS (` +
  `    SELECT 1 FROM room_measurements m ` +
  `    WHERE m.room_id = r.id AND m.kind = 'EXISTING_FLOORPLAN');`;

// ── 2. Notes ────────────────────────────────────────────────────────────────
// One note per non-null source column, tagged with the matching type where the
// vocabulary has one (general_notes / problem_areas get no type tag).
const NOTE_SOURCES = [
  { col: "plumbing_notes", typeKey: "plumbing" },
  { col: "electrical_notes", typeKey: "electrical" },
  { col: "structural_notes", typeKey: "structural" },
  { col: "hvac_notes", typeKey: "hvac" },
  { col: "general_notes", typeKey: null },
  { col: "problem_areas", typeKey: null },
];

function noteInsertsFor(col) {
  // The note row, guarded so re-running does not duplicate. We key idempotency on
  // (room_id, author, and the plaintext), which is stable for a given source.
  return (
    `INSERT INTO room_notes (room_id, note_markdown, note_html, note_plaintext, author) ` +
    `SELECT r.id, r.${col}, '<p>' || replace(r.${col}, char(10), '</p><p>') || '</p>', r.${col}, 'backfill:${col}' ` +
    `FROM rooms r ` +
    `WHERE r.is_active = 1 AND r.${col} IS NOT NULL AND trim(r.${col}) <> '' ` +
    `  AND NOT EXISTS (` +
    `    SELECT 1 FROM room_notes n ` +
    `    WHERE n.room_id = r.id AND n.author = 'backfill:${col}');`
  );
}

// ── Run ─────────────────────────────────────────────────────────────────────

if (!APPLY) {
  const dims = sql(
    `SELECT COUNT(*) n FROM rooms r WHERE r.is_active=1 ` +
      `AND (r.length_feet IS NOT NULL OR r.width_feet IS NOT NULL OR r.area_sq_ft IS NOT NULL) ` +
      `AND NOT EXISTS (SELECT 1 FROM room_measurements m WHERE m.room_id=r.id AND m.kind='EXISTING_FLOORPLAN');`,
  )[0]?.n;
  console.log(`backfill (dry run):`);
  console.log(`  measurements to create: ${dims}`);
  for (const s of NOTE_SOURCES) {
    const n = sql(
      `SELECT COUNT(*) n FROM rooms r WHERE r.is_active=1 AND r.${s.col} IS NOT NULL AND trim(r.${s.col})<>'' ` +
        `AND NOT EXISTS (SELECT 1 FROM room_notes n WHERE n.room_id=r.id AND n.author='backfill:${s.col}');`,
    )[0]?.n;
    console.log(`  notes from ${s.col}: ${n}`);
  }
  console.log("\n--- dry run; pass --apply ---");
  process.exit(0);
}

console.log("backfill: measurements …");
sql(measurementSql, false);
for (const s of NOTE_SOURCES) {
  console.log(`backfill: notes from ${s.col} …`);
  sql(noteInsertsFor(s.col), false);
  // Tag the freshly-inserted note with its type, when the vocabulary has one.
  if (s.typeKey) {
    sql(
      `INSERT OR IGNORE INTO room_note_type_mapping (room_note_id, room_note_type_id) ` +
        `SELECT n.id, d.id FROM room_notes n ` +
        `JOIN room_note_type_def d ON d.key = ${q(s.typeKey)} ` +
        `WHERE n.author = 'backfill:${s.col}';`,
      false,
    );
  }
}
console.log("backfill: done");
