# Rule: Database Schema & ORM

## ORM: Drizzle (D1 / SQLite)

This project uses Drizzle ORM exclusively for D1 database interactions.
For runtime validation around table models, use `drizzle-zod` (`createInsertSchema`, `createSelectSchema`) alongside Drizzle table definitions.

## Schema Organization

```
src/backend/db/schema/
├── index.ts              # Barrel re-export (single source of truth)
├── auth/
│   └── users.ts
├── ai/
│   └── ai_sessions.ts
├── images/
│   └── image_reviews.ts
├── dashboard/
│   └── projects.ts
└── {domain}/
    └── {table_name}.ts
```

## Rules

1. **Schema files** live in `src/backend/db/schema/{domain}/{table_name}.ts`
2. **Every table** MUST be re-exported from `src/backend/db/schema/index.ts`
   - `drizzle-kit generate` reads from this barrel file
   - Missing exports = missing migrations
3. **Import via alias**: Always use `@backend/db`

   ```typescript
   // ✅ CORRECT
   import { imageReviews } from "@backend/db";

   // ❌ WRONG — never use relative paths
   import { imageReviews } from "../../../db/schema/images/image_reviews";
   ```

4. **No raw SQL** in application code — use Drizzle's query builder
5. **Schema definition** lives in TypeScript (`sqliteTable`). The `.sql` files in `drizzle/` are the **applied migration history**, not the schema.

## Migrations — multi-session discipline (READ THIS)

Multiple Claude/agent sessions run against this repo concurrently. `drizzle-kit generate`
mutates a single shared, linear journal (`drizzle/meta/_journal.json`) + snapshot chain, so
concurrent `db:generate` runs **clobber each other** (duplicate prefixes, phantom journal
entries, no-op tombstones). The rules below exist to stop that.

**Source of truth = the `d1_migrations` table** (per-database, managed by
`wrangler d1 migrations apply`). The drizzle `_journal.json`/snapshots are **advisory only**.

1. **Apply migrations ONLY via the migration runner** — never bypass tracking:
   ```bash
   pnpm run migrate:local     # wrangler d1 migrations apply DB --local
   pnpm run migrate:remote    # wrangler d1 migrations apply DB --remote
   ```
   ❌ **NEVER** apply schema with `wrangler d1 execute --file=...` — it does not record the
   migration in `d1_migrations`, so the next `db:generate` regenerates it, collides on the
   already-applied column/table, and someone has to neuter it to a `SELECT 1;` no-op.
2. **`migrate:*` and `deploy` do NOT run `db:generate`** — applying never regenerates.
3. **Prefer hand-authored, forward-only migrations** on shared branches. Create
   `drizzle/<NNNN>_<short_desc>.sql` with the next free numeric prefix (idempotent where
   possible: `ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`). This avoids touching the shared
   journal entirely.
4. **Only run `pnpm run db:generate` deliberately**, when you know no other session is
   mid-migration, and commit the result immediately. Treat a dirty journal as expected; do
   not "patch" it per-session — run `npx drizzle-kit check` and fix to consistency, or leave
   it (deploys don't depend on it).

## Adding a New Table / Column

1. Create/edit `src/backend/db/schema/{domain}/{table_name}.ts` and export it from
   `src/backend/db/schema/index.ts`.
2. Hand-author `drizzle/<NNNN>_<short_desc>.sql` with the matching `ALTER`/`CREATE` (or run
   `db:generate` deliberately per rule 4 above).
3. Apply with `pnpm run migrate:local` then `pnpm run migrate:remote` (NOT `d1 execute`).
