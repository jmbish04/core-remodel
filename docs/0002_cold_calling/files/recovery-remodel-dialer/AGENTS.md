# AGENTS.md — Recovery Remodel Dialer

Cold-calling tool for vetting independent SF drafters/designers sourced from DBI permit data.

## Stack
- Cloudflare Worker (single worker, `src/index.ts`)
- Hono + `@hono/zod-openapi` API under `/api/*`; docs at `/openapi.json`, `/scalar`, `/swagger`
- D1 + Drizzle ORM (modular schemas under `backend/db/schemas/`)
- Static dark-theme SPA in `public/index.html` (served via ASSETS binding)
- D1 mirrored logging via `backend/lib/logger.ts` → `event_logs`

## Conventions (enforced)
- Deploy ONLY via `pnpm run deploy` (never `wrangler deploy` directly).
- After any binding change: `pnpm cf-typegen`.
- Migrations: `pnpm run db:generate` — never hand-write migration SQL.
- `Env` is global; access bindings via `env.*` / `c.env.*`.
- No mock data. Contact fields are populated only where verified; otherwise `contact_status='needs_research'`.

## Data provenance
- Prospects derived from SF DBI **Building Permits** `i98e-djp9` joined to **Building Permits Contacts** `3pee-9qhc` on `permit_number`, roles in (designer, architect, pmt consultant/expediter), single-family, kitchen/wall, issued/complete, filed > 2023-01-01.
- Phone/website/email researched manually; sources stored in `phone_source` / `email_source`.

## Tasks suitable for Jules
- New SPA views / React islands if migrating to Astro+shadcn later.
- Additional Hono routes given exact zod schemas.
NOT for Jules: wrangler.toml, migrations, bindings, deployment.
