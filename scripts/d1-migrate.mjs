#!/usr/bin/env node
/**
 * @fileoverview Idempotent D1 migration applier.
 *
 * Drop-in replacement for `wrangler d1 migrations apply DB` that is SAFE TO RE-RUN
 * over a database whose journal has drifted from reality (the recurring "broken
 * journal" problem on this project). It applies each pending migration exactly as
 * drizzle-kit generated it — we never hand-edit migration files — but executes the
 * statements one at a time and TOLERATES idempotency errors:
 *
 *   - "table X already exists"      (re-running a CREATE TABLE)
 *   - "index X already exists"      (re-running a CREATE INDEX)
 *   - "duplicate column name: X"    (re-running an ALTER TABLE ADD COLUMN)
 *
 * That last one is why a plain `IF NOT EXISTS` rewrite isn't enough: SQLite/D1 has
 * no `ADD COLUMN IF NOT EXISTS`, so idempotency has to be handled at apply time.
 *
 * Any OTHER error (syntax, missing table on a real dependency, etc.) still fails the
 * run loudly — we only swallow the known "already done" class.
 *
 * Journal: uses the same `d1_migrations(name)` table and `<tag>.sql` naming as
 * `wrangler d1 migrations apply`, so the two interoperate — migrations recorded by
 * either are skipped by the other.
 *
 * Usage: node scripts/d1-migrate.mjs --local | --remote
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BINDING = "DB";
const MIGRATIONS_DIR = "drizzle";
const STATEMENT_BREAK = "--> statement-breakpoint";
const IDEMPOTENT_ERROR = /duplicate column name|already exists/i;

const mode = process.argv.includes("--remote")
  ? "--remote"
  : process.argv.includes("--local")
    ? "--local"
    : null;

if (!mode) {
  console.error("Usage: node scripts/d1-migrate.mjs --local | --remote");
  process.exit(1);
}

/** Run a single SQL statement against D1. Returns stdout; throws on failure. */
function execSql(sql, { json = false } = {}) {
  const args = ["wrangler", "d1", "execute", BINDING, mode];
  if (json) args.push("--json");
  // Bind the value with `=` so SQL beginning with a `--` line comment isn't parsed
  // as CLI flags by wrangler/yargs.
  args.push(`--command=${sql}`);
  return execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Combine a thrown exec error's streams into one searchable string. */
function errorText(err) {
  return [err?.stderr?.toString?.(), err?.stdout?.toString?.(), err?.message]
    .filter(Boolean)
    .join("\n");
}

console.log(`d1-migrate: applying migrations ${mode}`);

// 1. Ensure the journal table exists (matches wrangler's schema; no-op if present).
execSql(
  "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
);

// 2. Read which migrations are already recorded as applied.
const applied = new Set();
try {
  const out = execSql("SELECT name FROM d1_migrations", { json: true });
  const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
  const parsed = JSON.parse(json);
  for (const row of parsed?.[0]?.results ?? []) {
    if (row?.name) applied.add(row.name);
  }
} catch (err) {
  console.warn(`d1-migrate: could not read d1_migrations (treating as empty): ${errorText(err)}`);
}

// 3. Apply pending migration FILES in directory order — this mirrors how
//    `wrangler d1 migrations apply` discovers migrations (it reads the directory,
//    not drizzle's _journal.json, which can list squashed/removed tags whose .sql
//    files no longer exist). Filenames are zero-padded so lexical sort == apply order.
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let appliedCount = 0;
let toleratedCount = 0;

for (const name of files) {
  if (applied.has(name)) continue;

  const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
  const statements = sql
    .split(STATEMENT_BREAK)
    .map((s) => s.trim().replace(/;\s*$/, ""))
    .filter(Boolean);

  try {
    // Fast path: apply the whole migration in one call (keeps a fresh full apply to
    // ~1 CLI spawn per migration instead of one per statement).
    execSql(`${statements.join(";\n")};`);
  } catch {
    // Slow path: re-apply statement by statement, tolerating "already done" errors.
    // (A failed batch may have partially applied, so dupes here are expected.)
    for (const statement of statements) {
      try {
        execSql(statement);
      } catch (err) {
        const text = errorText(err);
        if (IDEMPOTENT_ERROR.test(text)) {
          toleratedCount += 1;
          console.warn(`  ⚠ ${name}: tolerated — ${text.match(IDEMPOTENT_ERROR)?.[0]}`);
          continue;
        }
        console.error(`d1-migrate: ✗ ${name} failed on a non-idempotent error:\n${text}`);
        process.exit(1);
      }
    }
  }

  // Record the migration as applied (INSERT OR IGNORE keeps it safe to re-run).
  execSql(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}')`);
  appliedCount += 1;
  console.log(`  ✓ applied ${name}`);
}

console.log(
  `d1-migrate: done — ${appliedCount} migration(s) applied, ${toleratedCount} idempotent statement(s) tolerated.`,
);
