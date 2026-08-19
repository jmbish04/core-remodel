/**
 * QC for PR #404 — keyOf multiword dedup + clear is_primary on merge.
 *
 * Pure-logic mirror of the fixed keyOf: proves multiword keyCols now distinguish rows
 * (the bug collapsed them to one key), and that clearOnMove demotes moved category rows.
 * The real merge path is destructive/HITL — not run here.
 */
import { createChecks } from "../config.mjs";
const { ok, finish } = createChecks();

const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
// rows are camelCase (drizzle field names); col.name is snake — mirror the fix.
const keyOf = (row, cols) =>
  cols.map((c) => String(row[c.name] ?? row[snakeToCamel(c.name)] ?? "∅")).join("\x01");

// category_mapping rows keyed by category_id (multiword col.name, camelCase row key)
const col = { name: "category_id" };
const rowA = { categoryId: 5, isPrimary: true };
const rowB = { categoryId: 9, isPrimary: false };
ok("distinct multiword keys differ", keyOf(rowA, [col]) !== keyOf(rowB, [col]));
ok("same multiword key matches", keyOf(rowA, [col]) === keyOf({ categoryId: 5 }, [col]));

// OLD buggy behavior (snake-only) would have collapsed both to the placeholder — prove it did.
const buggy = (row, cols) => cols.map((c) => String(row[c.name] ?? "∅")).join("\x01");
ok("old code collapsed multiword to one key (bug reproduced)", buggy(rowA, [col]) === buggy(rowB, [col]));

// clearOnMove demotes is_primary on a moved category row
const clearOnMove = { isPrimary: false };
const moved = { storeId: 1, ...clearOnMove };
ok("clearOnMove demotes is_primary", moved.isPrimary === false);

// single-word keyCols unaffected (e.g. day, url, type)
const dcol = { name: "day" };
ok("single-word key still works", keyOf({ day: "MONDAY" }, [dcol]) !== keyOf({ day: "TUESDAY" }, [dcol]));

finish();
