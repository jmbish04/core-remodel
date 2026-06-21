# Build-Vision Implementation Plan

> **For agentic workers:** Each task is self-contained. The prototype lives at `/build-vision/` at the project root — read those files as the source-of-truth for visual + interaction details. The plan describes WHAT to build and WHERE; the prototype is HOW for visual parity.
>
> **Orchestration:** Tasks will be dispatched via the `codex` CLI by the main agent. Each task includes the prompt, the files it can touch, and the verification criteria.

**Goal:** Ship the vendor-facing remodel brief at `/build-vision/[uuid]` (interactive, annotatable, PDF-exportable, per-recipient permissioned) plus an admin UI at `/admin/build-vision` for issuing links, configuring per-link visibility, replying to questions, and viewing engagement stats.

**Architecture:**
- **Storage:** Hybrid model. A new set of `build_vision_*` tables holds the brief shell (links, narrative sections, photos, scenarios, comments, events, decisions). Line-item rows in `build_vision_brief_items` carry an optional FK to an existing budget row (`budget_tracker_items.track_id` / `static_budget_items.id` / `assumption_line_items.id`) when budget is shown; otherwise the line-item is narrative-only. Admin chooses per-brief whether budget is visible (off/rounded/detailed) and can override per-section.
- **API:** Hono routes under `/api/build-vision/*` (public) and `/api/admin/build-vision/*` (admin-auth-gated by `requireAccessAuth`). Mirrors `bid-portfolio-public.ts` + `bid-portfolios.ts` split.
- **Frontend:** Astro page `frontend/pages/build-vision/[uuid].astro` mounts a React island that mirrors prototype `app.jsx`. Admin pages under `frontend/pages/admin/build-vision/`. State persists via API; what-if config stays local.
- **PDF:** Server-side `@react-pdf/renderer` renders `BuildVisionPdf.tsx` (separate component tree from web view) at `GET /api/build-vision/[uuid]/pdf`. Light theme, letter size, Geist fonts via `Font.register`.
- **Photos:** Stored in R2 (`ARTIFACTS_BUCKET`) at `build-vision/{uuid}/{filename}`. Served via worker route that streams from R2 with CDN-friendly cache headers. Pre-resized to ≤1600px on upload.

**Tech Stack:** Hono · Drizzle · D1 · Cloudflare Workers · Astro SSR + React islands (`client:only="react"`) · Tailwind v4 + shadcn (base-nova) · `@react-pdf/renderer` · Geist / Geist Mono (Google Fonts in prototype tokens.css).

**Prototype location:** `/Volumes/Projects/workers/core-remodel/build-vision/` — DO NOT modify these files. They are the spec.

**Key prototype files to reference:**
- `data.jsx` — TRADES / PERSONAS / SECTIONS / MOCK_LINKS / BUDGET_CAP
- `app.jsx` — vendor app shell, state model, render loop
- `admin-app.jsx` — admin shell, tabs, settings form
- `sections.jsx` — Cover / Standard / Internal / KitchenOverview / EndOfBrief renderers + PhotoGrid
- `budget.jsx` — BudgetPulse / LineItems / KitchenComparator + AnimatedCurrency
- `sidebar.jsx` — TOC + thumbs sidebar
- `comments.jsx` — CommentAnchor / CommentPopover / CommentsStack
- `selection-toolbar.jsx` — highlight-to-comment toolbar
- `comment-rail.jsx` — side rail + idle hint
- `lightbox.jsx` — photo lightbox with region annotations
- `pdf-preview.jsx` — paginated PDF preview reference (UI only)
- `styles.css` — full styling + trade-color palette (`.bv-line-trade[data-trade=...]`)
- `_tokens.css` — the prototype's `tokens.css` (Geist + dark OKLCH tokens)

**Out of scope for v1:** `ask-ai.jsx`, `mindmap.jsx`, `tweaks-panel.jsx`, the demo persona switcher. Wire `view_count_cap` field in DB but don't enforce.

---

## File Map

### New files
**Migrations** (auto-generated via `npx drizzle-kit generate`):
- `drizzle/0027_build_vision.sql`

**Drizzle schema** (`src/backend/db/schema/build-vision/`):
- `build_vision_links.ts`
- `build_vision_brief_sections.ts`
- `build_vision_brief_items.ts`
- `build_vision_brief_photos.ts`
- `build_vision_brief_scenarios.ts`
- `build_vision_events.ts`
- `build_vision_questions.ts`
- `build_vision_decisions.ts`
- Update `src/backend/db/schema/index.ts` to export all eight.

**API routes** (`src/backend/api/routes/`):
- `build-vision.ts` — public vendor endpoints
- `admin-build-vision.ts` — admin CRUD
- Mount both in `src/backend/api/index.ts`

**Service modules** (`src/backend/services/build-vision/`):
- `bake-brief.ts` — assembles the bakedPackage for `GET /api/build-vision/[uuid]`
- `apply-permissions.ts` — filters sections + line items by persona + permissions
- `bake-pdf.ts` — server entry for react-pdf streaming
- `seed-prototype.ts` — one-shot seed of prototype `data.jsx` into D1 (run manually)

**Frontend components** (`src/frontend/components/build-vision/`):
- `BuildVisionApp.tsx`
- `Sidebar.tsx` (with TocMode, ThumbsMode)
- `StatusBar.tsx`
- `DemoSwitch.tsx` — **OMITTED in production** (prototype-only)
- `sections/CoverSection.tsx`
- `sections/StandardSection.tsx`
- `sections/InternalSection.tsx`
- `sections/KitchenOverviewSection.tsx`
- `sections/EndOfBriefSection.tsx`
- `BudgetPulse.tsx` (incl. AnimatedCurrency)
- `LineItems.tsx`
- `KitchenComparator.tsx`
- `PhotoGrid.tsx`
- `Comments.tsx` (CommentAnchor, CommentPopover, CommentsStack)
- `SelectionToolbar.tsx`
- `CommentRail.tsx`
- `IdleHint.tsx`
- `PhotoLightbox.tsx` (with region annotation)
- `Toast.tsx`
- `hooks/useBuildVisionEvents.ts` — batches & POSTs flow events
- `hooks/useBuildVisionData.ts` — fetches/refreshes the baked package
- `hooks/useBuildVisionComments.ts` — comment CRUD + optimistic updates
- `hooks/useBuildVisionDecisions.ts` — line-item decision CRUD
- `pdf/BuildVisionPdf.tsx` — react-pdf document tree
- `pdf/styles.ts` — react-pdf stylesheet (cream paper)
- `pdf/fonts.ts` — Font.register for Geist + Geist Mono
- `data/trades.ts` — TRADES constant (mirror of prototype)
- `data/personas.ts` — PERSONAS constant (mirror of prototype)

**Frontend admin components** (`src/frontend/components/admin-build-vision/`):
- `AdminApp.tsx`
- `AdminSidebar.tsx`
- `LinkHeader.tsx`
- `tabs/SettingsTab.tsx` — full a-la-carte controls
- `tabs/StatsTab.tsx`
- `tabs/FlowTab.tsx`
- `tabs/QuestionsTab.tsx`
- `CreateLinkPanel.tsx`
- `LineItemPicker.tsx` — searches existing budget/assumption tables, FK-attaches into brief items
- `BriefSectionEditor.tsx` — author/edit one brief section (photos, line items, scenarios)

**Astro pages** (`src/frontend/pages/`):
- `build-vision/[uuid].astro`
- `build-vision/expired.astro`
- `build-vision/revoked.astro`
- `admin/build-vision/index.astro`
- `admin/build-vision/[uuid].astro`

**Frontend styles** (`src/frontend/styles/`):
- `build-vision.css` — port of prototype `styles.css`, scoped to `.bv-*` classes
- `admin-build-vision.css` — port of prototype `admin-styles.css`

### Modified files
- `src/backend/db/schema/index.ts` — export new schema files
- `src/backend/api/index.ts` — mount new routers (note: register `/api/admin/build-vision/*` BEFORE the `requireAccessAuth` line affects it; the existing wildcard `app.use("/api/admin/*", requireAccessAuth)` at line 68 already covers it. Public `/api/build-vision/*` mounts without auth.)
- `package.json` — add `@react-pdf/renderer`
- `wrangler.jsonc` — no new bindings required (DB, ARTIFACTS_BUCKET, AI already there)

---

## Phase 1 · D1 schema (~1 task)

### Task 1.1: Create Drizzle schema files + generate migration

**Files:**
- Create: `src/backend/db/schema/build-vision/build_vision_links.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_brief_sections.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_brief_items.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_brief_photos.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_brief_scenarios.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_events.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_questions.ts`
- Create: `src/backend/db/schema/build-vision/build_vision_decisions.ts`
- Modify: `src/backend/db/schema/index.ts` — append 8 re-exports

**Schema specifications:**

```ts
// build_vision_links.ts
export const buildVisionLinks = sqliteTable("build_vision_links", {
  uuid: text("uuid").primaryKey(),                       // e.g. "gc-7f3a2b81"
  briefId: integer("brief_id").notNull(),                // points at the brief draft (single-tenant for now → constant 1; column exists for future multi-brief)
  recipientName: text("recipient_name").notNull(),
  recipientCompany: text("recipient_company").notNull(),
  recipientRole: text("recipient_role"),
  persona: text("persona").notNull(),                    // gc | architect | civil | structural | carpenter | electrician | plumber
  welcome: text("welcome"),
  permissions: text("permissions", { mode: "json" }).notNull(),  // { budgetMode, showInternal, showComparator, showPhotos, hiddenSections[], hiddenInternal[], photoCaptions{}, perSectionBudgetMode{} }
  viewCountCap: integer("view_count_cap"),               // NULL = unlimited; field exists, not enforced yet
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdBy: integer("created_by"),                      // FK to users.id (admin who issued it); soft for now
});
```

```ts
// build_vision_brief_sections.ts
// Each row = one narrative section in a brief.
export const buildVisionBriefSections = sqliteTable("build_vision_brief_sections", {
  id: text("id").primaryKey(),                           // slug: "cover", "backyard", "kitchen", "kitchen-c", etc.
  briefId: integer("brief_id").notNull(),
  groupNum: text("group_num").notNull(),                 // "00" / "01" / ...
  groupLabel: text("group_label").notNull(),             // "Overview" / "Backyard" / ...
  title: text("title").notNull(),                        // "Cover" / "Drainage & patio"
  eyebrow: text("eyebrow"),
  summary: text("summary"),
  kind: text("kind").notNull().default("standard"),      // cover | standard | internal | comparator | wrap
  hero: text("hero"),                                    // R2 key, only for cover
  fact: text("fact", { mode: "json" }),                  // cover facts JSON
  internalTitle: text("internal_title"),
  internalBody: text("internal_body"),
  trades: text("trades", { mode: "json" }).notNull().default(sql`('["all"]')`),
  flag: text("flag"),                                    // "primary"
  badge: text("badge"),                                  // "active" | "parked" | "baseline"
  budgetMin: integer("budget_min"),
  budgetAvg: integer("budget_avg"),
  budgetMax: integer("budget_max"),
  sortOrder: integer("sort_order").notNull(),
});
```

```ts
// build_vision_brief_items.ts
export const buildVisionBriefItems = sqliteTable("build_vision_brief_items", {
  id: text("id").primaryKey(),                           // e.g. "by-1"
  sectionId: text("section_id").notNull().references(() => buildVisionBriefSections.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  trades: text("trades", { mode: "json" }).notNull(),
  min: integer("min").notNull(),
  avg: integer("avg").notNull(),
  max: integer("max").notNull(),
  source: text("source"),                                // e.g. "d1:scope.backyard.drainage_french"
  // Optional FK chain to authoritative budget row. Exactly one (or zero) populated.
  budgetTrackerTrackId: text("budget_tracker_track_id"),
  staticBudgetItemId: text("static_budget_item_id"),
  assumptionLineItemId: text("assumption_line_item_id"),
  rationale: text("rationale"),
  sortOrder: integer("sort_order").notNull(),
});
```

```ts
// build_vision_brief_photos.ts
export const buildVisionBriefPhotos = sqliteTable("build_vision_brief_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: text("section_id").notNull().references(() => buildVisionBriefSections.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),                       // ARTIFACTS_BUCKET key: "build-vision/{briefId}/{filename}"
  caption: text("caption"),                              // default caption; per-link override goes in link.permissions.photoCaptions
  sortOrder: integer("sort_order").notNull(),
});
```

```ts
// build_vision_brief_scenarios.ts (for the kitchen comparator)
export const buildVisionBriefScenarios = sqliteTable("build_vision_brief_scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: text("section_id").notNull().references(() => buildVisionBriefSections.id, { onDelete: "cascade" }),
  scenarioKey: text("scenario_key").notNull(),           // "a" | "b" | "c" | "d"
  label: text("label").notNull(),
  loc: text("loc"),
  sub: text("sub"),
  layout: text("layout"),
  plumbing: text("plumbing"),
  deviation: integer("deviation"),
  status: text("status"),                                // "active" | "parked" | "baseline"
  comparison: text("comparison", { mode: "json" }),      // array of { label, value }
  sortOrder: integer("sort_order").notNull(),
});
```

```ts
// build_vision_events.ts
export const buildVisionEvents = sqliteTable("build_vision_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkUuid: text("link_uuid").notNull().references(() => buildVisionLinks.uuid, { onDelete: "cascade" }),
  ts: integer("ts", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  eventType: text("event_type").notNull(),               // "opened" | "section_viewed" | "line_expanded" | "scenario_switched" | "decision_made" | "pdf_downloaded"
  eventPayload: text("event_payload", { mode: "json" }),
});
```

```ts
// build_vision_questions.ts
export const buildVisionQuestions = sqliteTable("build_vision_questions", {
  id: text("id").primaryKey(),                           // "q_xxxxx"
  linkUuid: text("link_uuid").notNull().references(() => buildVisionLinks.uuid, { onDelete: "cascade" }),
  sectionId: text("section_id").notNull(),
  anchorText: text("anchor_text").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull().default("text"),          // "text" | "photo" | "photo-region"
  photoSrc: text("photo_src"),                           // populated when kind != text
  annotations: text("annotations", { mode: "json" }),    // array of { x, y, w, h } in 0..1
  askedAt: integer("asked_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  editedAt: integer("edited_at", { mode: "timestamp" }),
  replyBody: text("reply_body"),
  repliedAt: integer("replied_at", { mode: "timestamp" }),
  repliedBy: integer("replied_by"),                      // users.id
});
```

```ts
// build_vision_decisions.ts
export const buildVisionDecisions = sqliteTable("build_vision_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkUuid: text("link_uuid").notNull().references(() => buildVisionLinks.uuid, { onDelete: "cascade" }),
  lineItemId: text("line_item_id").notNull().references(() => buildVisionBriefItems.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),                  // "accept" | "reject" | "counter"
  counterAmount: integer("counter_amount"),              // cents; only set when decision = "counter"
  decidedAt: integer("decided_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  // UNIQUE(linkUuid, lineItemId) — upsert
});
// + index: uniqueIndex on (link_uuid, line_item_id)
```

Add to `index.ts`:
```ts
export * from "./build-vision/build_vision_links";
export * from "./build-vision/build_vision_brief_sections";
export * from "./build-vision/build_vision_brief_items";
export * from "./build-vision/build_vision_brief_photos";
export * from "./build-vision/build_vision_brief_scenarios";
export * from "./build-vision/build_vision_events";
export * from "./build-vision/build_vision_questions";
export * from "./build-vision/build_vision_decisions";
```

**Steps:**
- [ ] Write all 8 schema files following the specs above (match patterns in `src/backend/db/schema/bid-portfolios/bid_portfolios.ts:1-30` for column conventions).
- [ ] Append 8 lines to `src/backend/db/schema/index.ts`.
- [ ] Run `npx drizzle-kit generate` → produces `drizzle/0027_build_vision.sql`.
- [ ] Inspect the SQL output. Confirm UNIQUE INDEX on `build_vision_decisions(link_uuid, line_item_id)` is present; add `.unique()` to schema if not.
- [ ] Apply locally: `npx wrangler d1 migrations apply core-remodel --local`.
- [ ] Verify: `npx wrangler d1 execute core-remodel --local --command ".schema build_vision_links"` → returns the table.
- [ ] Commit.

---

## Phase 2 · Prototype seed (~1 task)

### Task 2.1: Seed prototype data into D1

**Files:**
- Create: `src/backend/services/build-vision/seed-prototype.ts`
- Create: `scripts/seed-build-vision.ts` — node script entry that calls the worker seed endpoint (or use a one-shot route)

**Approach:**
1. Read prototype `/build-vision/data.jsx` SECTIONS array literally into TypeScript at script time (manual port; data.jsx has ~290 lines of SECTIONS).
2. INSERT one row into `build_vision_links` for each MOCK_LINK (3 in the prototype: gc-7f3a2b81, arch-c2d3e4, plumb-9a1f4c).
3. INSERT all SECTIONS into `build_vision_brief_sections` (briefId=1).
4. INSERT all lineItems into `build_vision_brief_items` with `source` populated from the prototype's `source: "d1:..."` field; leave the three FK columns NULL (they're stub references in the prototype anyway — admin will FK them properly via LineItemPicker later).
5. INSERT photos into `build_vision_brief_photos` — for now, just record the prototype paths as `r2Key`. Photos will be uploaded to R2 in a separate task.
6. INSERT scenarios + comparison rows into `build_vision_brief_scenarios`.
7. INSERT all questions into `build_vision_questions` (prototype seeds 5 — q1..q4 + ai_demo1; SKIP ai_demo1 since AI chat is out of scope).
8. Add an admin-only endpoint `POST /api/admin/build-vision/seed-prototype` (idempotent: DELETE-then-INSERT for briefId=1) that runs this seed. Easier than a CLI tool against remote D1.

**Verification:**
- After seeding, `SELECT COUNT(*) FROM build_vision_brief_sections WHERE brief_id=1` → 11.
- `SELECT COUNT(*) FROM build_vision_links` → 3.
- `SELECT COUNT(*) FROM build_vision_questions WHERE link_uuid='gc-7f3a2b81'` → 4.

---

## Phase 3 · Photos uploaded to R2 (~1 task)

### Task 3.1: Upload prototype photos to ARTIFACTS_BUCKET

**Files:**
- Create: `scripts/upload-bv-photos.sh`

**Steps:**
- [ ] Extract `photos/**` from `proofs/colby remodel rfp.zip` to `/tmp/bv-photos/`.
- [ ] For each photo: resize to ≤1600px wide using `sips` (macOS) or `convert` (ImageMagick), then `wrangler r2 object put core-remodel-artifacts/build-vision/1/{relative-path} --file=...`.
- [ ] Update `build_vision_brief_photos.r2_key` to match (relative path under `build-vision/1/`).
- [ ] Add a worker route `GET /api/build-vision/photo/:briefId/:path{.+}` that streams from R2 with `Cache-Control: public, max-age=31536000, immutable`. (Reuse pattern from `src/backend/api/routes/artifacts.ts`.)

**Verification:**
- `curl https://.../api/build-vision/photo/1/cover/house-front.jpg -I` → 200, image/jpeg, cache header present.

---

## Phase 4 · Public API (~3 tasks)

### Task 4.1: `GET /api/build-vision/:uuid` — bake the package

**Files:**
- Create: `src/backend/services/build-vision/bake-brief.ts`
- Create: `src/backend/services/build-vision/apply-permissions.ts`
- Create: `src/backend/api/routes/build-vision.ts`
- Modify: `src/backend/api/index.ts` — add import + `app.route("/api/build-vision", buildVisionRouter)` AFTER the admin auth middleware line so it stays unauthenticated.

**Response shape** (match what `app.jsx` expects after porting):
```ts
{
  link: {
    uuid, recipient: { name, company, role },
    persona, welcome, createdAt, expiresAt, revoked,
    permissions: { budgetMode, showInternal, showComparator, showPhotos,
                   hiddenSections, hiddenInternal, photoCaptions, perSectionBudgetMode },
  },
  sections: BriefSection[],  // already filtered + permission-applied
  comments: Question[],      // questions for this link, includes replies
  decisions: { [lineItemId]: { decision, counterAmount } },
  budgetCap: 300000,
}
```

`apply-permissions.ts` filters `SECTIONS`:
- Drop sections where `section.kind !== "internal"` AND NOT in persona.sections AND NOT explicitly forced visible.
- Drop sections where `link.permissions.hiddenSections` includes section.id.
- Internal sections (kind=="internal"): include only if `link.permissions.hiddenInternal` includes section.id.
- Drop `section.photos` if `link.permissions.showPhotos === false`.
- Drop `section.budget` if effective budget mode is "off" for that section (link-level `budgetMode` OR per-section override).
- Strip `min`/`avg`/`max` from each line-item when budget mode is "off".

**Side effect:** INSERT one row into `build_vision_events` with `event_type = "opened"`. Use `c.executionCtx.waitUntil(...)` so it doesn't block the response.

**404/410/403 handling:**
- Link not found → 404
- `revokedAt != null` → 410 with `{ reason: "revoked" }`
- `expiresAt < now` → 410 with `{ reason: "expired" }`

**Tests:**
- Seed test link with persona=plumber, hit endpoint, assert sections in response = ["cover","backyard","bathrooms","primary-suite","kitchen","kitchen-c","end-of-brief"], no `budget` field on standard sections, no scenarios on kitchen overview.

### Task 4.2: Events / Questions / Decisions endpoints

**File:** `src/backend/api/routes/build-vision.ts` (continue from 4.1)

**Endpoints:**
- `POST /api/build-vision/:uuid/events` — body: `{ eventType, payload }`. Throttle by inserting at most 1 event per (uuid, eventType, payload-hash) per 5 seconds (in-memory Map per worker isolate is fine for v1). Returns 204.
- `POST /api/build-vision/:uuid/questions` — body: `{ sectionId, anchorText, body, kind?, photoSrc?, annotations? }`. Validates the link is active. Returns the created question with generated `id` like `"q_" + nanoid(7)`.
- `PATCH /api/build-vision/:uuid/questions/:id` — body: `{ body }`. Only allowed if (link active) AND (`replyBody IS NULL`). 403 otherwise.
- `DELETE /api/build-vision/:uuid/questions/:id` — same constraint as PATCH.
- `POST /api/build-vision/:uuid/decisions` — body: `{ lineItemId, decision, counterAmount? }`. UPSERT on (link_uuid, line_item_id). If decision === null, DELETE the row. Also INSERT an event with `event_type = "decision_made"`.

**Tests:**
- Seed an active link. POST a question. PATCH it. DELETE it. Verify state at each step.
- POST a question; admin replies; recipient PATCH → 403.
- POST a decision twice with different decisions → second wins (upsert).

### Task 4.3: PDF endpoint

**File:** `src/backend/api/routes/build-vision.ts` (continue)

`GET /api/build-vision/:uuid/pdf` →
- Re-uses `bake-brief.ts` to get the same baked package.
- Lazy-imports `pdf/BuildVisionPdf.tsx` and `@react-pdf/renderer` (heavy module — keep lazy so cold-start of non-PDF requests stays fast).
- `pdf(<BuildVisionPdf package={baked} />).toBuffer()` → return as `application/pdf` with `Content-Disposition: attachment; filename="126-colby-build-vision-{uuid}.pdf"`.
- Also INSERT event `event_type = "pdf_downloaded"`.

---

## Phase 5 · Admin API (~2 tasks)

### Task 5.1: Admin link CRUD

**Files:**
- Create: `src/backend/api/routes/admin-build-vision.ts`
- Modify: `src/backend/api/index.ts` — mount at `/api/admin/build-vision` (covered by existing `/api/admin/*` auth wildcard at line 68).

**Endpoints:**
- `GET /api/admin/build-vision/links` — list all links with computed `state` (active/expired/revoked) and open-question count.
- `POST /api/admin/build-vision/links` — body: `{ recipientName, recipientCompany, persona, welcome?, budgetMode, ttl, permissions? }`. Generates UUID (`{persona.slice(0,4)}-{nanoid(8)}`). Defaults `permissions` from PERSONAS. Returns the created link.
- `GET /api/admin/build-vision/links/:uuid` — full link incl. stats (opens, lastOpen, timeSpent, sectionsViewed, all questions with replies, flow).
- `PATCH /api/admin/build-vision/links/:uuid` — partial update of recipient, welcome, persona, expiresAt, permissions (deep merge), viewCountCap.
- `POST /api/admin/build-vision/links/:uuid/revoke` — set `revokedAt = now`.
- `DELETE /api/admin/build-vision/links/:uuid` — hard delete (cascades to questions, decisions, events).

**Stats computation** is derived from `build_vision_events`:
- `opens` = COUNT(WHERE event_type='opened')
- `lastOpen` = MAX(ts WHERE event_type='opened')
- `timeSpent` — approximate: sum of gaps between consecutive events <60s apart, formatted as `"Nm Ms"`.
- `sectionsViewed` = COUNT(DISTINCT JSON_EXTRACT(event_payload, '$.sectionId') WHERE event_type='section_viewed')

### Task 5.2: Admin question reply + brief authoring

**Endpoints (continue same file):**
- `POST /api/admin/build-vision/links/:uuid/questions/:id/reply` — body: `{ replyBody }`. Sets `replyBody` + `repliedAt = now` + `repliedBy = userId`.
- `GET /api/admin/build-vision/briefs/:briefId` — full brief (sections + items + photos + scenarios) for authoring UI.
- `PUT /api/admin/build-vision/briefs/:briefId/sections/:sectionId` — upsert a section (kind, title, eyebrow, summary, hero, fact, badge, internalTitle/Body, trades, flag, budget, sortOrder).
- `PUT /api/admin/build-vision/briefs/:briefId/sections/:sectionId/items/:itemId` — upsert one item incl. FK to budget table.
- `DELETE /api/admin/build-vision/briefs/:briefId/sections/:sectionId/items/:itemId`
- `POST /api/admin/build-vision/briefs/:briefId/sections/:sectionId/photos` — multipart upload, resizes ≤1600px, stores in R2 at `build-vision/{briefId}/{sectionId}/{filename}`, INSERT row.
- `DELETE /api/admin/build-vision/briefs/:briefId/sections/:sectionId/photos/:photoId` — delete R2 object + row.
- `GET /api/admin/build-vision/line-item-search?q=...&kind=tracker|static|assumption` — search across `budget_tracker_items`, `static_budget_items`, `assumption_line_items` by scope/description for the LineItemPicker.

---

## Phase 6 · Vendor frontend (~6 tasks)

For each component task: read the prototype file once, port it to TSX, preserve class names (`bv-*` and `data-trade=*`) so `build-vision.css` styles map 1:1. Replace `React.createElement / hooks attached to window` with proper imports. Replace `window.BV_*` globals with proper TS imports / props from the baked package.

### Task 6.1: CSS port + tokens registration

**Files:**
- Create: `src/frontend/styles/build-vision.css` — port of `/build-vision/styles.css` (87k chars). Find/replace where needed:
  - Verify all `--bv-accent`, `--bv-emerald`, `--bv-amber`, `--bv-red`, `--bv-blue`, `--bv-accent-soft`, `--ink-strong`, `--ink-soft`, `--ink-muted`, `--ink-faint`, `--rule`, `--hairline`, `--card`, `--font-heading`, `--font-mono`, `--radius-md`, `--radius-xl`, `--bv-emerald-soft` are defined either here or via the imported tokens.
  - Per-trade colors: confirm `.bv-line-trade[data-trade=...]` and `.bv-trade-chip[data-trade=...]` rules for each of: gc, architect, civil, structural, carpenter, electrician, plumber.
- Modify: `src/frontend/styles/global.css` — `@import` Geist + Geist Mono from Google Fonts (or download into `public/`). Add the missing custom properties (`--font-heading`, `--font-mono`, `--bv-*`) needed by `build-vision.css` if they aren't already in tokens.
- Create: `src/frontend/components/build-vision/data/trades.ts`
- Create: `src/frontend/components/build-vision/data/personas.ts`

### Task 6.2: BuildVisionApp shell + Sidebar + StatusBar + hooks

**Files:**
- `src/frontend/components/build-vision/BuildVisionApp.tsx` — mirror `prototype/app.jsx:9-521`. Replace the `const [currentUuid, setCurrentUuid] = useState(...)` switcher with a prop `uuid` passed from the Astro page. Remove `DemoSwitch` and `TweaksPanel`. Tweakable controls (`tweaks` state) become hardcoded defaults: `{ selectionToolbar: true, commentRail: true, idleHint: true, varianceBars: true, density: "comfortable" }`.
- `src/frontend/components/build-vision/Sidebar.tsx` — port `sidebar.jsx`. Two modes: toc / thumbs. PDF button hits `/api/build-vision/{uuid}/pdf` with `<a download>`.
- `src/frontend/components/build-vision/StatusBar.tsx` — the top crumb + pills block from `app.jsx:311-331`.
- `src/frontend/components/build-vision/hooks/useBuildVisionData.ts` — `const { data, error, isLoading, refresh } = useBuildVisionData(uuid)`. Fetches `/api/build-vision/{uuid}`. Polls every 30s for question replies (or use SWR if it's already a dep).
- `src/frontend/components/build-vision/hooks/useBuildVisionEvents.ts` — batches events. `recordEvent(eventType, payload)`. Flushes every 5s or on `beforeunload`.

### Task 6.3: Section renderers

**Files:**
- `src/frontend/components/build-vision/sections/CoverSection.tsx` — port `sections.jsx:96-133`.
- `src/frontend/components/build-vision/sections/StandardSection.tsx` — port `sections.jsx:138-200`. Includes `SectionBudgetCallout`.
- `src/frontend/components/build-vision/sections/InternalSection.tsx` — port `sections.jsx:207-231`.
- `src/frontend/components/build-vision/sections/KitchenOverviewSection.tsx` — port `sections.jsx:236-260`.
- `src/frontend/components/build-vision/sections/EndOfBriefSection.tsx` — port `sections.jsx:265-305`. Drop the mindmap trigger; we excluded mindmap.
- `src/frontend/components/build-vision/PhotoGrid.tsx` — port `sections.jsx:25-70`.

### Task 6.4: Budget panel + line items + comparator

**Files:**
- `src/frontend/components/build-vision/BudgetPulse.tsx` — port `budget.jsx:42-142`. Keep `AnimatedCurrency` co-located.
- `src/frontend/components/build-vision/LineItems.tsx` — port `budget.jsx:147-282`. Decisions persist via `useBuildVisionDecisions` hook (POST on every change, debounced 400ms for counter-amount typing). Inline `CommentAnchor` from comments component.
- `src/frontend/components/build-vision/KitchenComparator.tsx` — port `budget.jsx:287-402`. Drop the mindmap trigger; we excluded mindmap.
- `src/frontend/components/build-vision/hooks/useBuildVisionDecisions.ts` — fetch initial decisions from baked package; `onDecide(itemId, decision)` POSTs to `/api/build-vision/{uuid}/decisions` with optimistic local update.

### Task 6.5: Comments (text anchors + popover + stack)

**Files:**
- `src/frontend/components/build-vision/Comments.tsx` — combines `CommentAnchor`, `CommentPopover`, `CommentsStack` (port `comments.jsx` in full).
- `src/frontend/components/build-vision/SelectionToolbar.tsx` — port `selection-toolbar.jsx`. Remove the "Ask AI" branch (we excluded ask-ai).
- `src/frontend/components/build-vision/CommentRail.tsx` — port `comment-rail.jsx`.
- `src/frontend/components/build-vision/IdleHint.tsx` — extract from `app.jsx` (IdleHint is referenced but actual implementation likely in comment-rail; locate it and split).
- `src/frontend/components/build-vision/Toast.tsx` — simple toast from `app.jsx:469-476`.
- `src/frontend/components/build-vision/hooks/useBuildVisionComments.ts` — fetch initial comments from baked package, expose `addComment / editComment / deleteComment`. POSTs to API. Optimistic insert with temp id; replaces on server response.

**Anchor stability rule (spec §9):** `anchorText` for line-item comments = `lineItem.scope` (the raw scope string from D1). For section-level rail comments = `section.group + " · " + section.title`. For photo comments = `"Photo · " + photo.caption`. For photo-region comments = `"Photo region · " + photo.caption`. Document this in the hook's JSDoc.

### Task 6.6: Photo lightbox + region annotations

**File:**
- `src/frontend/components/build-vision/PhotoLightbox.tsx` — port `lightbox.jsx` in full. Region annotations save as `{ x, y, w, h }` in 0..1 normalized coords. Drawing UI = click-and-drag on the photo to draw a rectangle, then type a comment. Persists via `addComment({ kind: "photo-region", photoSrc, annotations, body })`.

---

## Phase 7 · Astro pages (~2 tasks)

### Task 7.1: Vendor route + 410 pages

**Files:**
- Create: `src/frontend/pages/build-vision/[uuid].astro`
```astro
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import BuildVisionApp from "@frontend/components/build-vision/BuildVisionApp.tsx";
import "@frontend/styles/build-vision.css";

const { uuid } = Astro.params;
// SSR-fetch to redirect on expired/revoked before paint
const res = await fetch(`${Astro.url.origin}/api/build-vision/${uuid}`, {
  headers: { "x-internal": "ssr" },
});
if (res.status === 404) return Astro.redirect("/build-vision/expired");  // generic friendly page
if (res.status === 410) {
  const j = await res.json();
  return Astro.redirect(j.reason === "revoked" ? "/build-vision/revoked" : "/build-vision/expired");
}
---
<BaseLayout title="Build Vision">
  <BuildVisionApp uuid={uuid!} client:only="react" />
</BaseLayout>
```
- Create: `src/frontend/pages/build-vision/expired.astro` — static "This link expired. Contact 126colby.com for a new link." page with link mailto.
- Create: `src/frontend/pages/build-vision/revoked.astro` — "This link has been revoked." Same template.

### Task 7.2: Admin routes

**Files:**
- Create: `src/frontend/pages/admin/build-vision/index.astro` — mounts `AdminApp.tsx` (list view).
- Create: `src/frontend/pages/admin/build-vision/[uuid].astro` — mounts `AdminApp.tsx` with `initialUuid={uuid}` prop.
- Both `client:only="react"` (matches existing admin page pattern at `src/frontend/pages/admin.astro:18`).

---

## Phase 8 · Admin frontend (~3 tasks)

### Task 8.1: AdminApp shell + sidebar + link header + create panel

**Files:**
- `src/frontend/components/admin-build-vision/AdminApp.tsx` — port `admin-app.jsx:15-170`. Replace `useState(structuredClone(window.BV_MOCK_LINKS))` with `useAdminBuildVisionLinks()` hook that fetches from `GET /api/admin/build-vision/links` and refetches after mutations.
- `src/frontend/components/admin-build-vision/AdminSidebar.tsx` — port `admin-app.jsx:175-254`.
- `src/frontend/components/admin-build-vision/LinkHeader.tsx` — port `admin-app.jsx:259-294`.
- `src/frontend/components/admin-build-vision/CreateLinkPanel.tsx` — port `admin-app.jsx:643-712`.

### Task 8.2: Settings tab + stats tab + flow tab + questions tab

**Files:**
- `src/frontend/components/admin-build-vision/tabs/SettingsTab.tsx` — port `admin-app.jsx:299-480`. **Extend** beyond prototype:
  - Add **per-section budget toggle**: each section row in "Sections this recipient sees" has a small chip beside the on/off switch with `[Budget: link default | off | rounded | detailed]`. Saved into `link.permissions.perSectionBudgetMode[sectionId]`.
  - Add **per-photo caption override**: a small "Captions" button per visible section opens a modal listing photos with editable caption fields; save into `link.permissions.photoCaptions[r2Key]`.
- `src/frontend/components/admin-build-vision/tabs/StatsTab.tsx` — port `admin-app.jsx:497-533`.
- `src/frontend/components/admin-build-vision/tabs/FlowTab.tsx` — port `admin-app.jsx:538-562`.
- `src/frontend/components/admin-build-vision/tabs/QuestionsTab.tsx` — port `admin-app.jsx:567-638`.

### Task 8.3: Brief authoring (LineItemPicker + BriefSectionEditor)

**Files:**
- `src/frontend/components/admin-build-vision/LineItemPicker.tsx` — modal that opens from BriefSectionEditor. Search box → debounced call to `/api/admin/build-vision/line-item-search?q=...&kind=...`. Shows results from three tables. Picking one writes the FK into the brief item.
- `src/frontend/components/admin-build-vision/BriefSectionEditor.tsx` — full editor for one section's: title/eyebrow/summary/badge/flag, budget min/avg/max, line-items table (add/edit/delete; "Link source" button opens LineItemPicker), photos (drag-drop upload), scenarios (if kind=comparator). New admin tab: "Brief content" — shows all sections in collapsed accordion; click to expand → BriefSectionEditor.
- Add the "Brief content" tab to AdminApp.

---

## Phase 9 · PDF (~2 tasks)

### Task 9.1: react-pdf dependency + fonts + styles

**Files:**
- Modify: `package.json` — add `"@react-pdf/renderer": "^4.x"`. Run `pnpm install`.
- Create: `src/frontend/components/build-vision/pdf/fonts.ts`:
```ts
import { Font } from "@react-pdf/renderer";
import GeistRegular from "../../../public/fonts/Geist-Regular.ttf?url";
// ...
Font.register({ family: "Geist", fonts: [
  { src: GeistRegular, fontWeight: 400 },
  { src: GeistMedium, fontWeight: 500 },
  { src: GeistBold,   fontWeight: 700 },
]});
Font.register({ family: "Geist Mono", fonts: [...] });
```
- Download Geist + Geist Mono TTFs to `public/fonts/` (avoids hitting Google Fonts at server-render time).
- Create: `src/frontend/components/build-vision/pdf/styles.ts` — StyleSheet.create for cream paper #fdfcfa, 72pt margins, type scale matching `pdf-preview.jsx`.

### Task 9.2: BuildVisionPdf document

**File:**
- `src/frontend/components/build-vision/pdf/BuildVisionPdf.tsx` — full document tree:
  - `<Document>` → cover Page, TOC Page, one Page per section (paginated as needed), questions appendix Page.
  - Running header (left: "126 Colby · Build Vision · {section group + title}"; right: `link.recipient.company`).
  - Running footer (centered: `Page {pageNumber} / {totalPages}`).
  - Cover: hero image + welcome + recipient facts.
  - Standard sections: title, lede, photos in 2-col grid (use `<Image>`), section budget callout if budgetMode != off, line items as a table.
  - Kitchen comparator: 4 scenario cards + comparison table.
  - Internal sections: same styling as standard with a "Shared with you only · {title}" pin.
  - End: questions appendix listing all questions grouped by section.
- Photos are fetched from R2 via the public photo URL constructed in §3. react-pdf can render remote images.

---

## Phase 10 · Edge cases + verification (~1 task)

### Task 10.1: Wire-up integration test pass + polish

- [ ] Add link expiry / revoke behavior tests at the API layer.
- [ ] Add a Playwright smoke test (or manual checklist) for each persona:
  - GC link: cover + welcome, all sections, Budget Pulse rounded numbers, what-if toggles working, line items with variance bars + accept/reject/counter persisting, kitchen comparator with active=C, comments save+reload, PDF downloads.
  - Plumber link: only [cover, backyard, bathrooms, primary-suite, kitchen, kitchen-c, end-of-brief] visible, NO Budget Pulse, NO comparator, photos shown.
  - Architect link: no budget anywhere, comparator visible.
- [ ] Admin flow: create new link → copy URL → visit → see opens increment → leave a question → admin sees it on refresh → reply → recipient sees reply after refresh.
- [ ] Revoke a link → vendor page redirects to `/build-vision/revoked` within 60s.

---

## Verification (end-to-end)

```bash
# Local dev
pnpm dev   # Astro + Worker
# In another shell:
curl http://localhost:8788/api/build-vision/gc-7f3a2b81 | jq '.sections | length'  # expect 10 (cover + 8 others + end-of-brief; some hidden for plumber → 7)
curl http://localhost:8788/api/build-vision/plumb-9a1f4c | jq '.sections | map(.id)'
# Open vendor view:
open http://localhost:8788/build-vision/gc-7f3a2b81
# Open admin view:
open http://localhost:8788/admin/build-vision
# PDF download:
curl http://localhost:8788/api/build-vision/gc-7f3a2b81/pdf -o /tmp/test.pdf && open /tmp/test.pdf
```

---

## Out-of-scope (deferred for v2)

- AI chat from highlighted passages (`ask-ai.jsx`)
- Scenario mind map (`mindmap.jsx`)
- Tweaks panel
- View count cap enforcement (column exists, no enforcement yet)
- Cloudflare Images integration for photos (using R2 + cache headers is enough for v1)
- Real-time question notifications (polling every 30s is fine for v1)
- Per-link audit log of admin edits (not in spec)

---

## Risks + Open questions

1. **react-pdf bundle size** — `@react-pdf/renderer` is heavy (~500KB gzipped). Mitigation: dynamic import in the PDF route only.
2. **Photo bundle size** — prototype has 70+ photos averaging 700KB. After resize to ≤1600px wide we should be at ~150-250KB each, ~15MB total upload. Should be fine for R2.
3. **Comment anchor stability** — if admin renames a section's title, existing comments whose anchor was the old title become orphaned-looking. Mitigation: store `sectionId` separately (already done) so comments group by section regardless of title changes; only the displayed anchor string in the End-of-brief comments stack might drift, which is acceptable.
4. **Per-section budget override** — added beyond spec, confirmed by user request. The data shape `link.permissions.perSectionBudgetMode: { [sectionId]: "off" | "rounded" | "detailed" }` extends the existing `permissions` JSON column; no schema change needed.
