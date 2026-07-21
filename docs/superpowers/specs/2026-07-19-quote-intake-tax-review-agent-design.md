# Quote Intake, Tax Configuration & Negotiation Review Agent — Design

**Date:** 2026-07-19
**Status:** Approved (supersedes `2026-07-18-sales-tax-rates-design.md`)
**Source:** Owner's implementation brief, reconciled against the repo below.

## Why this exists

126 Colby St, San Francisco CA 94134. Fixture quotes are collected from multiple
Bay Area showrooms for the same package. Four quotes on one Gessi package
revealed, by hand:

- San Carlos billed **9.375%**, San Jose would bill **10%**, delivery address is
  SF at **8.625%**. On a $10K basket that spread is ~$140 — recoverable by asking
  for the order to be written as a job-site delivery.
- One vendor quoted **10% off list**; three others quoted **exactly 25% off**, to
  the penny, across six SKUs.
- One vendor quoted a single line at **37.7% off** while every other line on the
  same quote sat at 25% — proving a deeper tier exists.
- Two quotes had expired or expired that same day.
- Freight was $0 / $200 / $445 across three vendors — enough to reverse the
  ranking on merchandise price.
- Only one of four vendors quoted the drains, which are mandatory (the faucets
  ship without them).

None of that is visible in the app today. The system should catch it
automatically and coach a professional-grade response.

## The gap this closes

`product_price_observations` is a **line-item** store with no parent. Tax rate,
freight, lead time, quote number, expiration, payment terms, ship-via, and
restocking policy are all **quote-header** properties with nowhere to live.
Everything here depends on introducing that parent entity.

## Scope

1. **Tax configuration** — user-managed jurisdiction rates + a designated
   delivery address (`/admin/config/tax`)
2. **Quote entity** — header + line items, ingested from PDF/image, linked to
   existing products and price observations
3. **Review agent** — automated compliance/completeness review producing both a
   coaching note and a draft vendor reply

---

## Repo reconciliation

The brief's paths were written from memory. Verified corrections — **use these,
not the brief's**:

| Brief | Actual |
|---|---|
| `backend/db/schemas/${category}/${subcategory}/${table}.ts` | `src/backend/db/schema/<category>/<table>.ts` — singular `schema`, no subcategory level |
| `src/hono/routes/` | `src/backend/api/routes/` |
| `wrangler.toml` | `wrangler.jsonc` |
| `price_observations` | `product_price_observations` |
| global `ErrorLogger` | **does not exist** — zero hits in `src/`. Use existing error handling; do not invent a logger as a side quest |

**`drizzle-zod` is banned repo-wide, not just in schema files.** The brief's "all
schemas derived via drizzle-zod" cannot be followed. There are **zero** actual
`drizzle-zod` imports anywhere in `src/` — every occurrence of the string is a
comment recording the ban, e.g. `src/backend/api/routes/brands.ts:18`:

> Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).

It breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0` while `tsc` still
passes, so it fails at build rather than typecheck and presents as an unrelated
regression. Rule: **hand-write Zod v4 schemas everywhere.**

`pnpm run deploy` exists and chains build → `migrate:remote` →
`migrate:tesla:remote` → `wrangler deploy`.

**No unit test framework exists.** Verification convention is
`scripts/qc/pr_<n>.mjs` + `scripts/config.mjs`, asserted over HTTP. Do not add
vitest.

---

## Data model

Migrations via `pnpm run db:generate`. Never hand-write SQL, never edit generated
migrations, never `wrangler d1 execute --file`.

### `config/tax_jurisdictions`

| column | type | notes |
|---|---|---|
| `id` | integer PK | |
| `name` | text | "San Francisco", "San Mateo County", "San Jose" |
| `kind` | text enum | `city` / `county` / `district` / `state` |
| `state` | text | `CA` |
| `postalCodes` | text (JSON array) | `["94134","94103"]` — address matching |
| `ratePpm` | integer | 8.625% → `86250`. **Integer, never float.** |
| `effectiveFrom` | text ISO date | |
| `effectiveTo` | text ISO date nullable | null = active |
| `isDefault` | integer bool | exactly one row may be default |
| `sourceUrl` | text nullable | CDTFA lookup link, for auditability |
| `notes` | text nullable | |
| timestamps | | |

Seed via a seed script against real D1 — **never hardcoded into application
logic**: San Francisco 8.625%, San Mateo County 9.375%, San Jose 10.0%, Santa
Clara County 9.125%, CA statewide base 7.25%. San Francisco `isDefault = true`.

> ZIP-based matching is acceptable here specifically because this table is
> hand-curated and small. It would not be for a generic statewide table —
> CDTFA publishes no ZIP field, jurisdiction polygons cross ZIP boundaries, and
> 19 of 310 Bay Area ZCTAs straddle a county line. Do not grow this into an
> auto-populated statewide ZIP table without revisiting that.
>
> CDTFA's address API (`services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress`)
> is free and unauthenticated if `sourceUrl` should ever be machine-verified.

### `config/delivery_profiles`

| column | type | notes |
|---|---|---|
| `id` | integer PK | |
| `label` | text | "126 Colby St job site" |
| `addressLine1`, `city`, `state`, `postalCode` | text | |
| `taxJurisdictionId` | FK → `tax_jurisdictions` | the rate that *should* apply |
| `isActive` | integer bool | |
| `deliveryTermsLanguage` | text | exact phrasing to request |
| timestamps | | |

### `shopping/quotes`

`id`, `showroomId` (FK nullable — null for online retailers), `retailerName`,
`quoteNumber`, `quotedBy`, `quotedByEmail`, `quotedByPhone`, `issuedAt`,
`expiresAt`, `currency` (default USD), `merchandiseCents`, `freightCents`,
`taxCents`, `totalCents`, `taxRatePpm` (**derived** from tax ÷ merchandise when
not stated), `taxRateSource` (`stated`/`derived`/`absent`), `shipViaRaw`,
`paymentTermsRaw`, `leadTimeRaw`, `returnPolicyRaw`, `sourceFileKey` (R2),
`status` (`draft`/`under_review`/`active`/`expired`/`superseded`/`awarded`),
`notes`, timestamps.

### `shopping/quote_line_items`

`id`, `quoteId` (FK cascade), `lineNumber`, `productId` (FK →
`showroom_store_products`, nullable until matched), `matchConfidence` (0–100),
`rawDescription`, `rawModelNumber`, `rawSku`, `finishCode`, `quantity`,
`unitPriceCents`, `extendedPriceCents`, `listPriceCents`, `discountPpm`
(computed), `priceObservationId` (FK → `product_price_observations`, so existing
comparison tooling keeps working), `notes`.

### `shopping/quote_reviews`

`id`, `quoteId` (FK), `modelUsed`, `runAt`, `overallGrade`
(`clean`/`needs_clarification`/`action_required`), `findings` (JSON),
`coachingNotes` (markdown), `draftVendorMessage` (markdown), `userStatus`
(`new`/`acknowledged`/`sent`/`resolved`/`dismissed`), timestamps.

### `shopping/product_dependencies`

`productId`, `requiresProductId`, `relationship`, `notes`. Models mandatory
companions (trim → rough valve, deck faucet → drain) as **data, not agent rules**.

### Finding object

Zod schema in `types.ts`, reused for AI structured output:

```ts
{
  code: string            // stable, e.g. 'TAX_RATE_MISMATCH'
  severity: 'info' | 'advisory' | 'action_required'
  category: 'tax' | 'freight' | 'lead_time' | 'expiration'
            | 'discount' | 'completeness' | 'terms' | 'finish'
  title: string
  detail: string
  evidence: string                    // specific numbers/text from the quote
  estimatedImpactCents: number | null
  suggestedQuestion: string | null
}
```

---

## API surface

Hono + `@hono/zod-openapi` under `src/backend/api/routes/`. `/openapi.json`,
`/scalar`, `/swagger` stay dynamic.

```
GET/POST/PATCH/DELETE  /api/config/tax/jurisdictions[/:id]
GET/PUT                /api/config/tax/delivery-profile
POST                   /api/config/tax/resolve      → { postalCode } → jurisdiction + rate

GET   /api/quotes                       list; filter showroom/status/expiry
POST  /api/quotes                       create (manual or parsed)
GET   /api/quotes/:id                   header + line items + latest review
PATCH /api/quotes/:id
POST  /api/quotes/ingest                multipart → R2 → async parse
GET   /api/quotes/:id/ingest-status
POST  /api/quotes/:id/review            trigger agent
GET   /api/quotes/:id/review
PATCH /api/quotes/:id/review/:reviewId  userStatus
POST  /api/quotes/:id/line-items/:lid/match
GET   /api/quotes/compare               ?productIds=… cross-vendor matrix
GET   /api/quotes/patterns              portfolio discount-tier analysis
```

Follow the existing photo-OCR async pattern: write D1 first for the fast path,
run AI enrichment in the background via `ctx.waitUntil`, surface status through
the poll endpoint. Progressive UI results — never block page render on AI.

---

## Admin UI

**Run Stitch mockups and get sign-off before building frontend.**

### `/admin/config/tax`

- **Delivery profile card** at top — address, jurisdiction, resolved rate shown
  prominently. Editable. The anchor everything compares against.
- **Jurisdictions table** — sortable, filterable, inline-editable. Rate input
  accepts `8.625`, stores `86250`; display always 3 decimals.
- **Add jurisdiction** dialog (shadcn `Dialog`, never `window.prompt`).
- **Rate history** — superseded rows collapsed, not deleted, so past quotes
  reconcile against the rate live when issued.
- Empty state invites the action rather than apologizing.

### `/admin/quotes` and `/admin/quotes/:id`

- List: vendor, quote number, issued, expires (countdown badge, red inside 7 days
  or lapsed), merchandise, freight, tax, total, effective discount %, grade.
- Detail: header facts; line-item table with list / net / % off per line; match
  confidence with one-click override; review panel.
- Review panel: findings grouped by severity, coaching notes as markdown, draft
  vendor message in a copyable block with "mark as sent".

---

## Review agent

`src/backend/ai/agents/quoteReview/{types,health,index}.ts` + `methods/`, one
file per capability. Model via AI Gateway; Workers AI default through the
provider abstraction.

Methods: `parseQuoteDocument`, `matchLineItemsToProducts`, `checkTaxCompliance`,
`checkLogistics`, `analyzeDiscountTier`, `composeReview`.

### Tax checks, in order

1. **`TAX_ABSENT`** (`action_required`) — no `taxCents`. A quote without tax
   isn't a real total and can't be compared to one that has it.
2. **`TAX_RATE_UNRECOGNIZED`** — derived `taxCents ÷ merchandiseCents` matches no
   known jurisdiction within ±0.05%. Show the derived figure.
3. **`TAX_RATE_MISMATCH`** (`action_required`) — quote's rate exceeds the
   delivery jurisdiction's.
   `estimatedImpactCents = merchandiseCents × (quotedPpm − profilePpm) ÷ 1_000_000`
4. **`NOT_JOBSITE_DELIVERY`** (`advisory`) — `shipViaRaw` reads as counter pickup,
   or the ship-to address isn't the delivery profile address.

**Encode the domain rule as a question-generator, never a legal conclusion.** In
California the statewide base applies everywhere, and *district* taxes are
generally sourced to the delivery location when the retailer is engaged in
business in that district. A vendor in San Carlos or San Jose shipping to a San
Francisco job site should generally collect at the SF rate. This is genuinely
nuanced and depends on nexus and deal structure — **the agent must never assert a
vendor is charging incorrectly.** Surface the discrepancy, quantify it, produce a
question. The coaching note carries a short disclaimer that this isn't tax advice
and CDTFA or a CPA is the authority.

Register for `suggestedQuestion`, and for **every** generated vendor message —
curious, not accusatory, assumes good faith, gives an easy path to fix:

> "Help me understand how tax is being calculated on this quote — it looks like
> it's at the San Carlos rate. Since this is delivering to my job site at 126
> Colby St in San Francisco, can you write it as a job-site delivery so the San
> Francisco rate applies? Want to make sure we've got it right before I sign."

These are relationships with showrooms, not arguments to win.

### Logistics checks

`FREIGHT_ABSENT` (advisory — ask if delivery is included, curbside or inside),
`FREIGHT_OUTLIER` (materially above median for a comparable basket; include the
comparison), `LEAD_TIME_ABSENT` (action_required on special-order/nonstock —
long-lead European fixtures need a date, not a range, because they gate
rough-in), `EXPIRY_ABSENT` / `EXPIRY_IMMINENT` (≤7 days) / `EXPIRED`,
`RETURN_POLICY_RESTRICTIVE` (a 48-hour cancellation window on a 14–16 week
special order is a real risk), `STORAGE_UNADDRESSED` (lead time > 8 weeks — will
the vendor hold the goods?).

### Completeness checks

`MISSING_REQUIRED_COMPANION` (from `product_dependencies`),
`FINISH_INCONSISTENT` (two finishes at the same list price are not the same
product; quotes carrying different finishes are not comparable),
`SKU_UNCONFIRMED`, `QUANTITY_MISMATCH`.

### Discount-tier analysis

Highest-value output. Compute `discountPpm` per line where `listPriceCents` is
known, then:

- **Cluster detection** — identical discount across vendors is a manufacturer
  dealer-program tier, not generosity. Tight clustering = real and standard; wide
  spread = negotiable per-rep.
- **Intra-quote outliers** — a single line materially deeper than the rest of the
  same quote proves a deeper tier exists and that this vendor can reach it. The
  most actionable signal in the dataset; surface prominently with line and pct.
- **Uniform-tier detection** — every line at one discount means a fixed sheet.
  State the tier, and that it's a starting position, not a floor.
- **Back-solve list prices** — `list = net ÷ (1 − discount)` where a tier is known
  and uniform. Write back to `showroom_store_products.msrpCents` **only** when ≥2
  independent sources agree within a dollar, always recording provenance.
- **Open-market benchmark** — against `product_price_observations` where
  `sourceType = 'online_retailer'`. Encode MAP: an authorized dealer's
  *advertised* price is often a manufacturer-enforced floor, so read it as a
  ceiling on what's obtainable, not the best available price.
- **Leverage summary** — realistic target band and dollar value of closing it.
  Grounded in dealer economics (decorative plumbing showrooms typically buy
  premium European brands at ~45–55% off list, so 25% off has real room; 30–38%
  is plausible on a single-vendor award). **Reasoning with assumptions stated,
  never a guaranteed number.**

### Coaching output

`coachingNotes` reads like an experienced owner's rep:

- Lead with the single most consequential finding, not a checklist.
- Quantify in dollars. "Ask about tax" is useless; "this is about $140" is actionable.
- Explain *why* each ask is standard practice, so it can be made confidently.
- Distinguish what's worth pushing on. Chasing a $12 item damages a relationship
  worth thousands.
- Name tradeoffs — consolidating with one vendor gets a better number but
  concentrates risk on one supplier's lead time.
- **Never invent a benchmark.** If there isn't enough data to know whether a price
  is good, say so.

---

## MCP tools

Extend the existing server: `create_quote`, `get_quote`, `list_quotes`,
`update_quote`, `add_quote_line_item`, `match_quote_line_item`, `review_quote`,
`compare_quotes`, `get_tax_config`, `set_tax_jurisdiction`,
`set_delivery_profile`, `analyze_discount_patterns`.

Tool descriptions specific about when to use each, following existing patterns.

---

## Guardrails

- **No mocks.** Every endpoint wired to real D1 / R2 / Workers AI before "done".
- **No floats for money or rates.** Integer cents, integer ppm. Format at display only.
- **The agent never asserts a vendor is wrong.** Discrepancies and questions only.
  Tax and contract terms carry a not-professional-advice note.
- **Match confidence < 80 requires confirmation.** Silently mismatching a SKU
  corrupts every downstream comparison.
- **Never delete a tax rate.** Supersede with `effectiveTo`.
- **Don't auto-send anything.** Drafts are drafts.
- No `window.alert/confirm/prompt`. Every table sorts + filters. Every page gets
  `<Navbar />`. Mobile-responsive, collapsible sidebar.
- Ask before building anything requiring auth, multi-tenancy, or payments — out
  of scope.

## Acceptance criteria

1. Delivery address + jurisdiction rates settable at `/admin/config/tax`, rate
   history preserved.
2. Quote PDF upload returns parsed header + line items matched to catalog
   products, confidence shown and overridable.
3. A quote billing a non-delivery-address rate produces `action_required` with
   dollar impact and a ready-to-send, good-faith question.
4. Missing tax / freight / lead time / expiration each produce their finding.
5. Wall-mount trim without its rough valve — or a deck faucet without a drain —
   is flagged.
6. Given ≥3 quotes on overlapping SKUs, the pattern endpoint identifies the common
   tier, flags intra-quote outliers, and produces a leverage summary with a target
   band.
7. Every AI step async with visible progress; nothing blocks initial render.
8. `pnpm run deploy` succeeds, routes live against real D1.

## Sequencing

1. **Tax schema + config API + `/admin/config/tax`** — self-contained, unblocks all
2. Quote + line-item schema, manual-entry API, backfill the four existing quotes
   already in `product_price_observations`
3. Stitch mockups for `/admin/quotes` + detail → sign-off → frontend build
4. Ingestion pipeline (R2 + vision parse + async status), following photo-OCR
5. Review agent methods, one at a time, tax checks first
6. Pattern analysis + MCP tool surface
7. Update `/AGENTS.md` and the docs route

## Related

- `2026-07-18-gmail-label-ingest-design.md` — subsystem 2, the automatic feeder
  into `POST /api/quotes/ingest`. Built after this brief; manual upload ships first.
