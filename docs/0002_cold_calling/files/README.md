# Recovery Remodel · Dialer

A single Cloudflare Worker + D1 app that turns the SF DBI permit analysis into a **cold‑calling
machine** for hiring an independent drafter / architectural designer for a permit‑only set.

Pick a prospect → see their permit stats, a **call script tailored to them**, click‑to‑call,
and a **Gmail draft** prefilled via URL params → log the call, rate them, leave notes, mark
favorite / "not available to hire" / "not a good feeling" → filter out everyone you've already
called.

---

## What's inside

| Layer | Tech |
|---|---|
| API | Hono + `@hono/zod-openapi` (`/api/*`, docs at `/openapi.json`, `/scalar`, `/swagger`) |
| DB | D1 + Drizzle ORM, modular schemas under `backend/db/schemas/` |
| Logging | D1 mirrored logging layer (`backend/lib/logger.ts` → `event_logs`) |
| UI | Dark‑theme single‑page app in `public/index.html`, served via the ASSETS binding |

### Deliberate deviations from the full cloudflare‑jedi template (flagged honestly)
- **Static SPA instead of Astro SSR + shadcn/Stitch/Jules.** This ships as one self‑contained
  Worker that deploys with a single command and runs with no build step — instead of the
  Astro+shadcn pipeline that needs a Stitch mockup sign‑off loop. The UI mirrors the shadcn
  dark aesthetic (same tokens/radius) and keeps the Navbar + OpenAPI links. Migrating to the
  full Astro stack later is straightforward; `AGENTS.md` notes what to hand to Jules.
- Everything else follows your rules: `pnpm run deploy` only, modular schemas with `index.ts`
  re‑exports, D1 mirrored logging, dynamic OpenAPI docs, **no mock data**.

---

## Setup

```bash
pnpm install

# 1) create the D1 database, then paste the returned id into wrangler.toml
wrangler d1 create recovery_remodel_dialer

# 2) generate types + migration from the Drizzle schema
pnpm cf-typegen
pnpm run db:generate

# 3) local run
pnpm run migrate:local
pnpm run seed:local
pnpm run dev          # → http://localhost:8787

# 4) ship it (db:generate + migrate:remote + seed:remote + wrangler deploy)
pnpm run deploy
```

> `seed/seed.sql` is **data‑only** INSERTs (not a migration). Re‑running it is safe — it
> `DELETE`s and re‑inserts the 12 prospects. Your call notes/ratings live in `prospect_state`
> and `call_attempts` and are **not** touched by re‑seeding.

---

## Data provenance (so you can trust / audit it)

Prospects come from joining two **public** DataSF datasets:

- **Building Permits** `i98e-djp9` — filtered to single‑family, `permit_type in (3,8)`,
  `status in (issued, complete)`, description containing KITCHEN or WALL, `filed_date > 2023‑01‑01`
  → 6,468 permits.
- **Building Permits Contacts** `3pee-9qhc` — joined on `permit_number`, roles in
  `designer`, `architect`, `pmt consultant/expediter`. Corporate‑looking names excluded.

The top 12 individuals by matching‑permit count are seeded.

### Contact info — verified, not invented
Phone/website/email are filled in **only where verified**, with the source recorded:
- **Aaron Lim (Aaron Lim Design)** — website + email verified first‑party (aaronlimdesign.com).
- **Katherine Fontaine (Actually Design Build)** — website verified first‑party; phone is
  **directory‑sourced (Manta) and flagged UNVERIFIED** in the UI.
- Everyone else → `contact_status = needs_research`. The detail view links you straight to the
  DBI permit lookup to pull the applicant's contact off the actual permit record.

### Two honesty flags baked into the UI
- **`verify identity` (collision risk):** common names like *Tony Lee* (120 permits), *Ken Chan*,
  *Tommy Lee* are almost certainly **multiple different people merged** — the contacts data isn't
  entity‑resolved. Confirm exactly who filed permits near your block before trusting the count.
- **High permit volume = experience, not endorsement.** Given SF's documented permit‑expediter
  fraud history, the app frames DBI throughput as *fluency with the process*, nothing more.
  Verify licenses (CA Architects Board) and expediter registration (SF Ethics Commission).

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/prospects?status=&q=&hideUnavailable=` | List with call state |
| GET | `/api/prospects/{id}` | One prospect |
| PATCH | `/api/prospects/{id}/state` | Rating, favorite, available‑to‑hire, good‑feeling, notes |
| POST | `/api/prospects/{id}/call` | Log a call attempt (no_answer / voicemail / connected / callback) |
| POST | `/api/prospects/{id}/emailed` | Mark emailed (fires when you open the Gmail draft) |

Interactive docs: `/scalar` and `/swagger`.
