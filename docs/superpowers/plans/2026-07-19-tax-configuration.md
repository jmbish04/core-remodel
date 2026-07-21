# Tax Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-managed tax jurisdictions with preserved rate history, a designated delivery profile, a config API, and `/admin/config/tax` — the anchor every quote's tax is compared against.

**Architecture:** Two D1 tables in the existing `schema/config/` folder via Drizzle. A seed script writing five real Bay Area jurisdictions plus the 126 Colby delivery profile. A Hono + zod-openapi router at `/api/config/tax`. An Astro shell + React island at `/admin/config/tax`, gated on Stitch mockup sign-off.

**Tech Stack:** Cloudflare Workers, Hono + `@hono/zod-openapi`, Drizzle ORM + D1, Astro SSR + React islands, shadcn/ui (Monolith dark theme), Zod v4.

**Spec:** `docs/superpowers/specs/2026-07-19-quote-intake-tax-review-agent-design.md` (phase 1 of §Sequencing)

## Global Constraints

- **Integer ppm, never float.** 8.625% → `86250`. `ppm = Math.round(percent * 10_000)`. Format at display only.
- **Never delete or UPDATE a rate.** Supersede by setting `effectiveTo` and inserting a new row, so quotes reconcile against the rate that was live when issued.
- **Exactly one `isDefault` jurisdiction** and one `isActive` delivery profile.
- **Schema path:** `src/backend/db/schema/config/<table>.ts` — singular `schema`, no subcategory level. The brief's `backend/db/schemas/${category}/${subcategory}/` is wrong.
- **Routes:** `src/backend/api/routes/` — not `src/hono/routes/`.
- **`drizzle-zod` is banned everywhere — hand-write Zod v4 schemas.** There are zero drizzle-zod imports in `src/`; every occurrence of the string is a comment recording the ban (`src/backend/api/routes/brands.ts:18`). It breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0` while `tsc` still passes, so it fails at build rather than typecheck and looks like an unrelated regression.
- **`pnpm run build` does not type-check.** Also run `npx tsc --noEmit` (~179 pre-existing baseline errors; only new ones matter).
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:local`. Never hand-write SQL, never edit a generated migration, never `wrangler d1 execute --file`.
- **No unit test framework.** Verification is `scripts/qc/pr_<n>.mjs` + `scripts/config.mjs` over HTTP. Do not add vitest.
- **No mocks, no placeholder data.** Seed values below are real published rates.
- **No `window.alert/confirm/prompt`.** shadcn `Dialog` / `AlertDialog`.
- **Every table sorts + filters. Every page gets `<Navbar />`.** Mobile-responsive.
- There is no global `ErrorLogger` in this repo. Use existing error handling; do not build one as a side quest.

## Seed values (real, published)

| Name | Kind | Rate | ppm | Default |
|---|---|---|---|---|
| San Francisco | `city` | 8.625% | `86250` | **yes** |
| San Mateo County | `county` | 9.375% | `93750` | |
| San Jose | `city` | 10.000% | `100000` | |
| Santa Clara County | `county` | 9.125% | `91250` | |
| California statewide base | `state` | 7.250% | `72500` | |

San Francisco 8.625% and San Mateo 9.375% are independently confirmed against
issued vendor quotes (DJ Bath Plus / PGKB, and Decorative Plumbing Q051185), so
they double as QC anchors.

## File Structure

| File | Responsibility |
|---|---|
| `src/backend/db/schema/config/tax_jurisdictions.ts` | jurisdiction table |
| `src/backend/db/schema/config/delivery_profiles.ts` | delivery profile table |
| `src/backend/db/schema/config/index.ts` | barrel — two exports |
| `src/backend/db/seeds/seed-tax-config.ts` | seed rows + runner |
| `src/backend/services/tax/rates.ts` | ppm math, postal resolution, supersede |
| `src/backend/services/tax/index.ts` | service barrel |
| `src/backend/api/routes/config-tax.ts` | `/api/config/tax` router |
| `src/backend/api/index.ts` | route + auth registration |
| `src/frontend/pages/admin/config/tax.astro` | page shell |
| `src/frontend/components/config/TaxConfigApp.tsx` | admin UI |
| `scripts/qc/pr_152.mjs` | HTTP verification |

---

### Task 1: Schema + migration

**Files:**
- Create: `src/backend/db/schema/config/tax_jurisdictions.ts`
- Create: `src/backend/db/schema/config/delivery_profiles.ts`
- Modify: `src/backend/db/schema/config/index.ts`

**Interfaces:**
- Produces: `taxJurisdictions`, `TaxJurisdiction`, `TaxJurisdictionInsert`, `deliveryProfiles`, `DeliveryProfile`, `DeliveryProfileInsert`

- [ ] **Step 1: Jurisdiction table**

```ts
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Tax Jurisdictions — user-managed CA sales tax rates.
 *
 * `ratePpm` is parts per million as an INTEGER: 8.625% => 86250. Never a float;
 * a float rate multiplied against integer cents drifts, and money is integer
 * cents throughout this codebase.
 *
 *     taxCents = Math.round(merchandiseCents * ratePpm / 1_000_000)
 *
 * Rows are effectively INSERT-ONLY. Changing a rate closes the current row's
 * `effectiveTo` and inserts a new row — it never updates in place. That is what
 * lets a quote issued last quarter still reconcile against the rate that was
 * live when it was written; an in-place update would silently re-check every
 * historical quote against a rate that did not exist at the time.
 *
 * `postalCodes` is a JSON array used for address matching. ZIP-based matching is
 * sound HERE because this table is hand-curated and small — a handful of
 * jurisdictions actually purchased from. It would NOT be sound as an
 * auto-populated statewide table: CDTFA publishes no ZIP field, jurisdiction
 * polygons cross ZIP boundaries, and 19 of 310 Bay Area ZCTAs straddle a county
 * line. Do not grow this into a statewide ZIP table without revisiting that.
 */
export const taxJurisdictions = sqliteTable(
  "tax_jurisdictions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    name: text("name").notNull(),
    kind: text("kind", { enum: ["city", "county", "district", "state"] }).notNull(),
    state: text("state").notNull().default("CA"),

    /** JSON array of 5-digit ZIPs, e.g. '["94134","94103"]'. */
    postalCodes: text("postal_codes"),

    /** Parts per million. 8.625% => 86250. */
    ratePpm: integer("rate_ppm").notNull(),

    effectiveFrom: text("effective_from").notNull(),
    /** Null = currently active. Set to supersede rather than deleting. */
    effectiveTo: text("effective_to"),

    /** Exactly one row may be true; enforced in the service layer. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),

    /** CDTFA lookup link, for auditability. */
    sourceUrl: text("source_url"),
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    nameIdx: index("tax_jurisdictions_name_idx").on(table.name),
    effectiveToIdx: index("tax_jurisdictions_effective_to_idx").on(table.effectiveTo),
  }),
);

export type TaxJurisdiction = typeof taxJurisdictions.$inferSelect;
export type TaxJurisdictionInsert = typeof taxJurisdictions.$inferInsert;
```

> No unique index on `isDefault` — SQLite partial unique indexes are awkward
> through drizzle-kit, and the constraint is "exactly one true", which a unique
> index cannot express anyway. Task 3 enforces it transactionally.

- [ ] **Step 2: Delivery profile table**

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { taxJurisdictions } from "./tax_jurisdictions";

/**
 * Delivery Profiles — the address the project actually ships to.
 *
 * This is the anchor the review agent compares every quote's tax against. CA
 * district tax on delivered goods is generally sourced to the delivery location,
 * so a vendor in another county shipping here should generally be collecting at
 * THIS jurisdiction's rate rather than their own.
 *
 * `deliveryTermsLanguage` is the exact phrasing to request on a quote, so the
 * generated vendor message asks for something concrete and writable.
 *
 * One active profile at a time; enforced in the service layer.
 */
export const deliveryProfiles = sqliteTable("delivery_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  label: text("label").notNull(),
  addressLine1: text("address_line1").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull().default("CA"),
  postalCode: text("postal_code").notNull(),

  /** The rate that SHOULD apply to goods delivered here. */
  taxJurisdictionId: integer("tax_jurisdiction_id").references(() => taxJurisdictions.id, {
    onDelete: "set null",
  }),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  /** Exact phrasing to request, e.g. "Job site delivery to 126 Colby St…". */
  deliveryTermsLanguage: text("delivery_terms_language"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type DeliveryProfile = typeof deliveryProfiles.$inferSelect;
export type DeliveryProfileInsert = typeof deliveryProfiles.$inferInsert;
```

- [ ] **Step 3: Barrel**

Append to `src/backend/db/schema/config/index.ts`:

```ts
export * from "./tax_jurisdictions";
export * from "./delivery_profiles";
```

The root barrel already re-exports `./config/index`, so no root change is needed.
Confirm with `grep -n 'config/index' src/backend/db/schema/index.ts`.

- [ ] **Step 4: Generate + inspect the migration**

Run: `pnpm run db:generate`

Open the new `drizzle/0112_*.sql`. Confirm two `CREATE TABLE` statements and
**no `DROP TABLE`** — a drop means unrelated schema drift got swept in, and on D1
`DROP TABLE` fires `ON DELETE CASCADE` (`PRAGMA foreign_keys=OFF` is a no-op
under wrangler), so it can silently wipe rows in another subsystem. If you see
one, stop and investigate.

- [ ] **Step 5: Apply and verify**

```bash
pnpm run migrate:local
npx wrangler d1 execute DB --local --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tax_jurisdictions','delivery_profiles')"
```
Expected: both listed.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit 2>&1 | grep "schema/config" || echo clean
git add src/backend/db/schema/config drizzle/
git commit -m "feat(tax): tax_jurisdictions + delivery_profiles schema"
```

---

### Task 2: ppm math + service helpers

**Files:**
- Create: `src/backend/services/tax/rates.ts`
- Create: `src/backend/services/tax/index.ts`

**Interfaces:**
- Produces:
  - `percentToPpm(percent: number): number`
  - `ppmToPercent(ppm: number): number`
  - `computeTaxCents(merchandiseCents: number, ratePpm: number): number`
  - `deriveRatePpm(taxCents: number, merchandiseCents: number): number | null`
  - `resolveJurisdictionByPostalCode(db, postalCode: string, asOf?: string): Promise<TaxJurisdiction | null>`
  - `getActiveDeliveryProfile(db): Promise<{ profile: DeliveryProfile; jurisdiction: TaxJurisdiction | null } | null>`
  - `supersedeJurisdictionRate(db, id: number, newRatePpm: number, effectiveFrom: string): Promise<TaxJurisdiction>`
  - `setDefaultJurisdiction(db, id: number): Promise<void>`

- [ ] **Step 1: Write the pure math**

```ts
/**
 * Percent to parts per million. 8.625 => 86250.
 * Math.round is required, not cosmetic: 8.625 * 10_000 is exact here, but
 * 10.075 * 10_000 is 100749.99999999999 in IEEE 754, and truncation would
 * yield 100749 — a rate one ppm light on every quote it touches.
 */
export function percentToPpm(percent: number): number {
  return Math.round(percent * 10_000);
}

/** Parts per million to percent. 86250 => 8.625. Display only. */
export function ppmToPercent(ppm: number): number {
  return ppm / 10_000;
}

/** Tax on merchandise at a ppm rate. Integer in, integer out. */
export function computeTaxCents(merchandiseCents: number, ratePpm: number): number {
  return Math.round((merchandiseCents * ratePpm) / 1_000_000);
}

/**
 * Back out the rate a quote actually applied, for quotes that state a tax
 * amount but not a rate. Returns null when merchandise is zero or absent —
 * never a fallback rate, because a wrong derived rate would silently pass or
 * fail QC on a quote we cannot actually evaluate.
 */
export function deriveRatePpm(taxCents: number, merchandiseCents: number): number | null {
  if (!merchandiseCents || merchandiseCents <= 0) return null;
  return Math.round((taxCents / merchandiseCents) * 1_000_000);
}
```

- [ ] **Step 2: Write `resolveJurisdictionByPostalCode`**

Select jurisdictions where `effectiveTo IS NULL OR effectiveTo > asOf`, parse each
`postalCodes` JSON array, and return the first whose array contains `postalCode`.

Prefer the most specific `kind` when several match, in order `city` → `district`
→ `county` → `state` — a ZIP legitimately belongs to a city *and* its county, and
the city rate is the one actually charged.

Return `null` when nothing matches. **Do not fall back to the default
jurisdiction here** — the caller decides whether a default is appropriate, and
silently substituting one would make an unmatched ZIP indistinguishable from a
matched one.

Malformed `postalCodes` JSON must be caught per-row and skipped, not thrown — one
bad row should not take down resolution for every other jurisdiction.

- [ ] **Step 3: Write `supersedeJurisdictionRate`**

The rate-history guarantee. In one transaction:

1. Load the current row by `id`; throw if it already has `effectiveTo` set.
2. `UPDATE` **only** its `effectiveTo` to `effectiveFrom`.
3. `INSERT` a new row copying `name`, `kind`, `state`, `postalCodes`,
   `isDefault`, `sourceUrl`, `notes`, with the new `ratePpm` and `effectiveFrom`,
   and `effectiveTo: null`.
4. Return the new row.

**Never `UPDATE` `ratePpm` on an existing row.** Any code path that edits a rate
goes through this function.

- [ ] **Step 4: Write `setDefaultJurisdiction`**

In one transaction: clear `isDefault` on all rows, then set it on `id`. This is
the "exactly one" enforcement — do it here rather than in the route, so every
caller gets it.

- [ ] **Step 5: Barrel, type-check, commit**

```bash
echo 'export * from "./rates";' > src/backend/services/tax/index.ts
npx tsc --noEmit 2>&1 | grep "services/tax" || echo clean
git add src/backend/services/tax
git commit -m "feat(tax): ppm math, postal resolution, rate supersede"
```

---

### Task 3: Seed script

**Files:**
- Create: `src/backend/db/seeds/seed-tax-config.ts`

**Interfaces:**
- Produces: `seedTaxConfig(db): Promise<{ jurisdictions: number; profile: boolean }>`

- [ ] **Step 1: Write it**

Follow `src/backend/db/seeds/seed-bay-area-cities.ts` for shape. Seed the five
jurisdictions from the table at the top of this plan with
`effectiveFrom: "2026-07-01"`, San Francisco `isDefault: true`, and
`sourceUrl: "https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm"`.

Then the delivery profile:

```ts
{
  label: "126 Colby St job site",
  addressLine1: "126 Colby Street",
  city: "San Francisco",
  state: "CA",
  postalCode: "94134",
  taxJurisdictionId: /* the San Francisco row's id */,
  isActive: true,
  deliveryTermsLanguage:
    "Job site delivery to 126 Colby St, San Francisco CA 94134",
}
```

Use `onConflictDoNothing()` and guard the profile insert on "no active profile
exists", so re-running is a no-op rather than a duplicate.

- [ ] **Step 2: Wire into the seed entrypoint and run**

Find the caller: `grep -rn "seedBayAreaCities" src/`. Add `seedTaxConfig`
alongside it, then run against local D1.

```bash
npx wrangler d1 execute DB --local --command \
  "SELECT name, rate_ppm, is_default FROM tax_jurisdictions ORDER BY rate_ppm"
```
Expected: 5 rows; San Francisco `86250` with `is_default = 1`; San Mateo `93750`.

- [ ] **Step 3: Commit**

```bash
git add src/backend/db/seeds/seed-tax-config.ts
git commit -m "feat(tax): seed Bay Area jurisdictions + 126 Colby delivery profile"
```

---

### Task 4: `/api/config/tax` router

**Files:**
- Create: `src/backend/api/routes/config-tax.ts`
- Modify: `src/backend/api/index.ts`

**Interfaces:**
- Consumes: Tasks 1–2
- Produces: `configTaxRouter`

| Method | Path | Notes |
|---|---|---|
| GET | `/jurisdictions` | `?includeSuperseded=true` to include closed rows |
| POST | `/jurisdictions` | create |
| PATCH | `/jurisdictions/:id` | **rate change routes through `supersedeJurisdictionRate`**; other fields update in place |
| DELETE | `/jurisdictions/:id` | **soft** — sets `effectiveTo` to now. Never a hard delete |
| GET | `/delivery-profile` | active profile + resolved jurisdiction + rate |
| PUT | `/delivery-profile` | upsert the active profile |
| POST | `/resolve` | `{ postalCode }` → jurisdiction + rate, or `null` |

- [ ] **Step 1: Write the router**

Follow `src/backend/api/routes/brands.ts` for the `OpenAPIHono` + `createRoute`
idiom. Note `showroom-sales.ts` uses plain `Hono`, so it is NOT the exemplar for
an OpenAPI-documented router.

**Hand-write the Zod v4 schemas — drizzle-zod is banned here too.**

Serialize `ratePercent` alongside `ratePpm`, derived via `ppmToPercent` at
serialization time. Computed, never stored, so it cannot disagree.

`PATCH /jurisdictions/:id` must branch: if the body contains a changed `ratePpm`,
call `supersedeJurisdictionRate` and return the **new** row; otherwise update in
place. A rate change that silently updated in place would break every historical
quote's reconciliation, which is the whole point of the table.

`POST /resolve` returns `{ jurisdiction: null, rate: null }` with HTTP **200** for
an unmatched ZIP — a valid answer, not an error.

- [ ] **Step 2: Register**

Mirroring `showroom-sales` at lines 89 / 143-144 / 266 of `src/backend/api/index.ts`:

```ts
import { configTaxRouter } from "./routes/config-tax";

app.use("/api/config/tax", requireAccessAuth);
app.use("/api/config/tax/*", requireAccessAuth);

app.route("/api/config/tax", configTaxRouter);
```

- [ ] **Step 3: Verify by hand**

Start with `preview_start` (never `wrangler dev` via Bash).

```
GET  /api/config/tax/jurisdictions          → 5 rows, SF ratePercent 8.625
GET  /api/config/tax/delivery-profile       → 126 Colby, jurisdiction SF, 8.625
POST /api/config/tax/resolve {"postalCode":"94134"}  → San Francisco, 86250
POST /api/config/tax/resolve {"postalCode":"00000"}  → 200, jurisdiction null
```

Then the rate-history guarantee — the single most important behaviour here:

```
PATCH /api/config/tax/jurisdictions/<sf-id>  {"ratePpm": 87500}
GET   /api/config/tax/jurisdictions?includeSuperseded=true
```
Expected: **two** San Francisco rows. The old one now has `effectiveTo` set and
still reads `86250`; the new one reads `87500` with `effectiveTo: null`. If the
old row's rate changed, `supersedeJurisdictionRate` is being bypassed — fix
before continuing, because every downstream quote reconciliation depends on it.

Restore the seed value afterwards (supersede back to `86250`) so the QC anchors
in Task 6 hold.

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit 2>&1 | grep "config-tax" || echo clean
git add src/backend/api/routes/config-tax.ts src/backend/api/index.ts
git commit -m "feat(tax): /api/config/tax jurisdictions, delivery profile, resolve"
```

---

### Task 5: `/admin/config/tax` — GATED ON MOCKUP SIGN-OFF

**The spec requires Stitch mockups and owner sign-off before frontend work.
Do not start Step 2 until that is given.**

**Files:**
- Create: `src/frontend/pages/admin/config/tax.astro`
- Create: `src/frontend/components/config/TaxConfigApp.tsx`

- [ ] **Step 1: Stitch mockup + sign-off**

Produce mockups for the delivery-profile card, the jurisdictions table with
inline edit, the add-jurisdiction dialog, and the collapsed rate-history view.
Present for sign-off. **Stop here until approved.**

- [ ] **Step 2: Astro shell**

```astro
---
/**
 * @fileoverview Sales Tax config page — `/admin/config/tax`.
 * Thin shell mounting `<TaxConfigApp>` (ConfigShell inside).
 */
import BaseLayout from "@/layouts/BaseLayout.astro";
import { TaxConfigApp } from "@/components/config/TaxConfigApp";
---

<BaseLayout
  title="Sales Tax — Configuration"
  description="Jurisdiction rates and the delivery address quotes are compared against."
>
  <TaxConfigApp client:only="react" />
</BaseLayout>
```

- [ ] **Step 3: React app**

Wrap in `ConfigShell`. Follow `PropertyAddressConfigApp.tsx` for
fetch/toast/loading conventions. Monolith rules: dark theme, shadcn only, no
hardcoded colors, `Separator` not 1px borders.

- **Delivery profile card**, top, visually dominant — address, jurisdiction,
  resolved rate at 3 decimals. Editable inline. This is the anchor everything
  else compares against, so it should read as the headline, not a settings row.
- **Jurisdictions table** — sortable and filterable. Columns: name, kind, postal
  codes, rate, effective range, default flag, source link. Inline edit. Rate
  input accepts `8.625` and sends `percentToPpm` → `86250`; display always 3
  decimals.
- **Add jurisdiction** — shadcn `Dialog`. Never `window.prompt`.
- **Rate history** — superseded rows collapsed under their active row, visibly
  greyed, never a delete affordance. Deleting uses the soft endpoint and reads as
  "supersede", so the UI should not offer a destructive-looking action for it.
- **Empty state** invites the action rather than apologizing.

- [ ] **Step 4: Verify in the browser**

`preview_start`, navigate to `/admin/config/tax`.
- `read_page` → 5 jurisdictions; SF shows `8.625%` and the default badge
- Delivery card shows 126 Colby / San Francisco / 8.625%
- Edit a rate → the old row appears in collapsed history, not overwritten
- `read_console_messages` → no errors
- `resize_window` mobile → table stays usable, sidebar collapses
- Screenshot for the record

- [ ] **Step 5: Commit**

```bash
git add src/frontend/pages/admin/config/tax.astro src/frontend/components/config/TaxConfigApp.tsx
git commit -m "feat(tax): /admin/config/tax jurisdictions + delivery profile"
```

---

### Task 6: QC script

**Files:**
- Create: `scripts/qc/pr_152.mjs` (rename to the real PR number once opened)

- [ ] **Step 1: Write it**

```js
#!/usr/bin/env node
/**
 * @fileoverview QC for tax configuration.
 *
 * Migrations: 0112 (tax_jurisdictions, delivery_profiles)
 *
 * Run:  pnpm run test:pr 152
 *       pnpm run test:pr 152 -- --base http://localhost:8787
 *
 * The two anchor rates are independently confirmed against issued vendor quotes
 * (DJ Bath Plus / PGKB at 8.625%; Decorative Plumbing Q051185 at 9.375%), so a
 * seed or unit error fails here rather than silently mis-flagging every quote.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

async function main() {
  console.log(`\nTax config QC → ${client.base}\n`);
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/config/tax/jurisdictions", { auth: false });
  checks.ok("tax config rejects unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  const list = await client.get("/api/config/tax/jurisdictions");
  checks.ok(
    "GET jurisdictions → 200 (migration 0112 applied)",
    list.status === 200,
    `got ${list.status}${list.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );

  const active = list.json?.jurisdictions ?? [];
  checks.ok("five seeded jurisdictions", active.length === 5, `got ${active.length}`);

  const sf = active.find((j) => j.name === "San Francisco");
  checks.ok("San Francisco is 8.625% (86250 ppm)", sf?.ratePpm === 86250, `got ${sf?.ratePpm}`);
  checks.ok("ratePercent derives to 8.625", sf?.ratePercent === 8.625, `got ${sf?.ratePercent}`);
  checks.ok("San Francisco is the default", sf?.isDefault === true, `got ${sf?.isDefault}`);

  const sm = active.find((j) => j.name === "San Mateo County");
  checks.ok("San Mateo County is 9.375% (93750 ppm)", sm?.ratePpm === 93750, `got ${sm?.ratePpm}`);

  checks.ok(
    "exactly one default jurisdiction",
    active.filter((j) => j.isDefault).length === 1,
    `${active.filter((j) => j.isDefault).length} rows flagged default`,
  );

  // ── Delivery profile is the anchor for every tax finding ──────────────────
  const profile = await client.get("/api/config/tax/delivery-profile");
  checks.ok("GET delivery-profile → 200", profile.status === 200, `got ${profile.status}`);
  checks.ok("profile is 94134", profile.json?.profile?.postalCode === "94134", `got ${profile.json?.profile?.postalCode}`);
  checks.ok(
    "profile resolves to the 8.625% jurisdiction",
    profile.json?.jurisdiction?.ratePpm === 86250,
    `got ${profile.json?.jurisdiction?.ratePpm}`,
  );

  // ── Postal resolution ────────────────────────────────────────────────────
  const hit = await client.post("/api/config/tax/resolve", { postalCode: "94134" });
  checks.ok("94134 resolves to San Francisco", hit.json?.jurisdiction?.name === "San Francisco", `got ${hit.json?.jurisdiction?.name}`);

  // Unmatched must be an ANSWER, not an error, and must not silently fall back
  // to the default — an unmatched ZIP has to stay distinguishable from a hit.
  const miss = await client.post("/api/config/tax/resolve", { postalCode: "00000" });
  checks.ok("unmatched ZIP → 200", miss.status === 200, `got ${miss.status}`);
  checks.ok("unmatched ZIP yields null, not the default", miss.json?.jurisdiction === null, JSON.stringify(miss.json?.jurisdiction));

  // ── Rate history is preserved, never overwritten ──────────────────────────
  // The single guarantee the whole table exists for: a quote issued last quarter
  // must still reconcile against the rate that was live when it was written.
  const before = sf.ratePpm;
  await client.patch(`/api/config/tax/jurisdictions/${sf.id}`, { ratePpm: 87500 });

  const withHistory = await client.get("/api/config/tax/jurisdictions?includeSuperseded=true");
  const sfRows = (withHistory.json?.jurisdictions ?? []).filter((j) => j.name === "San Francisco");
  checks.ok("rate change creates a second row", sfRows.length === 2, `got ${sfRows.length}`);

  const superseded = sfRows.find((j) => j.effectiveTo !== null);
  checks.ok("superseded row keeps its original rate", superseded?.ratePpm === before, `got ${superseded?.ratePpm}`);

  const current = sfRows.find((j) => j.effectiveTo === null);
  checks.ok("new row carries the new rate", current?.ratePpm === 87500, `got ${current?.ratePpm}`);

  // Restore so re-runs are idempotent.
  await client.patch(`/api/config/tax/jurisdictions/${current.id}`, { ratePpm: before });

  // ── Delete is soft ───────────────────────────────────────────────────────
  const sj = active.find((j) => j.name === "San Jose");
  await client.delete(`/api/config/tax/jurisdictions/${sj.id}`);
  const afterDelete = await client.get("/api/config/tax/jurisdictions?includeSuperseded=true");
  checks.ok(
    "deleted jurisdiction is superseded, not removed",
    (afterDelete.json?.jurisdictions ?? []).some((j) => j.id === sj.id),
    "row vanished — a hard delete breaks historical quote reconciliation",
  );

  checks.summary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> Confirm `checks.summary()` and the client's `patch`/`post`/`delete` helper names
> against `scripts/config.mjs` and `pr_151.mjs` before running — `pr_151.mjs` only
> exercises `get`, so the write helpers may need adding.

- [ ] **Step 2: Run against local dev**

Run: `pnpm run test:pr 152 -- --base http://localhost:8787`
Expected: all pass. A red QC script is not a deliverable.

- [ ] **Step 3: Commit**

```bash
git add scripts/qc/pr_152.mjs
git commit -m "test(tax): QC for jurisdictions, delivery profile, rate history"
```

---

## Self-Review

**Spec coverage (phase 1 only):**

| Spec item | Task |
|---|---|
| `tax_jurisdictions` incl. `postalCodes`, `effectiveFrom/To`, `isDefault`, `sourceUrl` | 1 |
| `delivery_profiles` incl. `deliveryTermsLanguage` | 1 |
| integer ppm, no floats | 2 |
| `deriveRatePpm` (used by the agent's `TAX_RATE_UNRECOGNIZED` check) | 2 |
| never delete a rate — supersede | 2, 4, 6 |
| seed 5 real jurisdictions + profile, via script not hardcoded | 3 |
| 7 config endpoints | 4 |
| `/admin/config/tax` incl. rate history, Dialog, sort/filter | 5 |
| Stitch sign-off gate | 5 Step 1 |
| verification | 6 |

Phases 2–7 (quote entity, ingestion, review agent, patterns, MCP) are out of
scope for this plan and get their own.

**Type consistency:** `ratePpm` spelled identically across schema, service, API,
QC. `percentToPpm` / `ppmToPercent` / `computeTaxCents` / `deriveRatePpm` /
`resolveJurisdictionByPostalCode` / `getActiveDeliveryProfile` /
`supersedeJurisdictionRate` / `setDefaultJurisdiction` match between producing
and consuming tasks. `kind` is `city`/`county`/`district`/`state` throughout.

**Known soft spots, flagged rather than hidden:**
1. Task 6 assumes `scripts/config.mjs` exposes `post`/`patch`/`delete`; `pr_151.mjs`
   only uses `get`. The step says to confirm and add if missing.
2. Task 3 Step 2 requires finding the seed entrypoint; the grep is given, the
   caller name is unverified.
3. "Exactly one default" is service-enforced, not DB-enforced. A direct SQL write
   could violate it. Acceptable — the DB has no clean way to express it — but it
   means the invariant lives in `setDefaultJurisdiction` and every writer must go
   through it.
