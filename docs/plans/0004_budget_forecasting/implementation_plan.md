# Remodel Mission Control: Budget Forecasting & Showroom Shopping Journal

This updated implementation plan details the new system-wide layout, data flow, database tables, and agentic workflows to support:
1. **Live Budgeting & Forecasting**: Drilldown forecasting matrix, persistent cost goals, and real-time AI budget reconciliation.
2. **REST Quote Restructuring**: Renaming "Truth Table" to "Labor & Materials Costs", introducing final engaged quotes, and top-level dynamic KPI strips.
3. **Showroom Shopping Journal**: Logging showroom trips/shopping visits using Plate.js ultra-rich-text editor, multi-file attachments (Cloudflare Images for photos, R2 for documents) with background Workers AI Vision tagging, Google Places auto-enrichment, and automated Deep Research creation and linking.

---

## User Review Required

> [!IMPORTANT]
> **Admin Sidebar Restructuring**
> We will reorganize the admin navigation into clear, logical groups to avoid clutter:
> - **Budget**: Tracker, Triage Matrix, Forecasting [new], Labor & Materials Costs [renamed]
> - **Contractors**: House Permits, Contractor Permits, Contracts, Estimates, Bid Portfolios
> - **Photos & Docs**: Uploads, Review, AI Edits, Supporting Docs
> - **Tools**: Analytics, Research Center, **Shopping Journal** [new]

> [!IMPORTANT]
> **Showroom Shopping Journal D1 Schemas**
> We will create a new schema file `shopping_journal.ts` in Drizzle D1 containing:
> 1. `shopping_journal_entries`: company details, contact person, mailing address, Plate.js Slate notes JSON, and a foreign key `research_session_id` referencing `research_sessions.id`.
> 2. `journal_attachments`: file metadata, delivery URL, R2 key/Cloudflare Images ID, and an `ai_description` field populated by Workers AI Vision.

> [!IMPORTANT]
> **⚡ Fully Automated Google places Enricher**
> Validation for logging shopping trips will be incredibly forgiving. The user can fill out **any single field** (e.g., only a phone number or partial showroom name) and hit "Auto-Enrich".
> The backend will call the Google Places (New) Text Search API via the project's Maps key, pull highly structured data (national phone number, formatted address, website URI, display name), and automatically populate the missing showroom coordinates.

> [!IMPORTANT]
> **🧠 Workers AI Vision & Deep Research Pipelines**
> Saving a Shopping Journal entry automatically fires two asynchronous AI pipelines:
> 1. **Workers AI Vision Description**: When attachments are uploaded, the backend uses `c.executionCtx.waitUntil` to run the `@cf/meta/llama-3.2-11b-vision-instruct` model to compile a visual/textual description of the photo or PDF and update the database.
> 2. **Automated Deep Research trigger**: Workers AI Llama extracts product names and pricing variables from the Plate.js notes. If products/pricing are found, it automatically creates a new Deep Research session (`research_sessions`), generates a prompt like *"Search for contractor reviews and competitive pricing indexes for [Company] focusing on [Products]"*, dispatches the stateful `ResearchAgent` DO in the background, and links it directly to the journal entry!
> 3. **Budget Delta Reconciliation**: The `BudgetAgent` DO parses any cost/pricing numbers from the entry and compares them against current caps and long-term goals. If it finds savings, it posts a celebration update; if it finds an overrun, it issues suggestions to scale back.

---

## Proposed Changes

### 1. Database & Schema Expansion

#### [NEW] [shopping_journal.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/home/shopping_journal.ts)
- Define `shoppingJournalEntries` table: `id` (pk), `companyName` (text, notNull), `phoneNumber` (text), `email` (text), `website` (text), `contactPerson` (text), `address` (text), `notes` (text, JSON PlateJS string), `researchSessionId` (integer, fk to `researchSessions.id` on delete set null), `createdAt` and `updatedAt`.
- Define `journalAttachments` table: `id` (pk), `journalEntryId` (integer, fk to `shoppingJournalEntries.id` cascade), `type` (text, e.g. 'photo', 'pdf', 'docx'), `hostingService` (text, enum 'cloudflare_images' / 'r2'), `url` (text, delivery URL), `r2Key` (text), `cfImageId` (text), `aiDescription` (text, visual/doc summary), `createdAt`.

#### [MODIFY] [index.ts (Schema)](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/index.ts)
- Export all schemas from `home/shopping_journal`.

#### [MODIFY] [truth_table_activities.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/home/truth_table_activities.ts)
- Add column `isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false)`
- Add column `vendorName: text("vendor_name")`

---

### 2. Backend Hono API Routers

#### [NEW] [shopping-journal.ts (API)](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/shopping-journal.ts)
- Mount under `/api/shopping-journal`.
- **`GET /`**: Return list of recent entries including attachments count, linked research status, and creation date.
- **`GET /:id`**: Return single entry detail with full attachments list, linked `researchSessions` status, and research markdown/webapp keys if complete.
- **`POST /`**: Create a new journal entry. Auto-extracts product names and pricing from `notes`. If keywords are detected:
  - Generates deep research topic & prompt via `@cf/meta/llama-3.1-8b-instruct`.
  - Inserts pending `researchSessions` row.
  - Spawns `ResearchAgent` DO (`startResearch` async).
  - Triggers `BudgetAgent` DO `onBudgetChange` if prices are parsed.
- **`POST /enrich`**: Takes partial fields (phone, address, or companyName), checks `GoogleMapsService` monthly quota, queries Google Places API `places:searchText`, and returns structured fields to auto-fill the frontend form.
- **`POST /:id/attachments`**: Single or multi-file multipart upload:
  - Non-images: Save to R2 `ARTIFACTS_BUCKET` under `journal_attachments/{id}/...` and output `/api/artifacts/` URL.
  - Images: Upload to Cloudflare Images API using `CF_IMAGES_TOKEN` and return delivery URL.
  - Background Task (`c.executionCtx.waitUntil`): Call `@cf/meta/llama-3.2-11b-vision-instruct` with the image/PDF contents to generate a highly detailed `aiDescription` and save it to `journalAttachments` in D1.

#### [MODIFY] [index.ts (API Index)](file:///Volumes/Projects/workers/core-remodel/src/backend/api/index.ts)
- Mount `shoppingJournalRouter` under `/api/shopping-journal`.
- Protect routes with `requireAccessAuth` where applicable.

---

### 3. Navigation & Quote UI Catalog Refactoring

#### [MODIFY] [AppSidebar.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/AppSidebar.tsx)
- Restructure the `"Admin"` list into 4 grouped subsections (Budget, Contractors, Photos & Docs, Tools).
- Rename the link for **Truth Table** to `/admin/truth-table` (labeled "Labor & Materials Costs").
- Add **Shopping Journal** (`/admin/shopping-journal`) under the **Tools** subsection.

#### [MODIFY] [TruthTableApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/TruthTableApp.tsx)
- Rename headers globally to **Labor & Materials Costs**.
- Add top-level **Real-time Recalculator Strip**:
  - Committed Cost: Sum of `isFinal = true` items.
  - Estimated Cost: Sum of `isFinal = false` items.
  - Projected Total: Committed + Estimated.
  - Target Cap Status: Clearance compared to Cap.
- Add `"isFinal"` toggle and `"vendorName"` text input to Add/Edit activity forms.
- Render solid green `ENGAGED` badge and inline vendor name in list rows.

#### [MODIFY] [truth-table.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/truth-table.astro)
- Rename page title to "Labor & Materials Costs".

---

### 4. New Shopping Journal UI

#### [NEW] [shopping-journal.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/shopping-journal.astro)
- Astro page that loads the authenticated `ShoppingJournalApp` React island.

#### [NEW] [ShoppingJournalApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/ShoppingJournalApp.tsx)
- High-fidelity showroom tracking screen matching the Monolith dark theme.
- **Journal Entries Grid**: Browse recent showroom visits with quick cards displaying company info, notes snippets, attachment count, and deep research status.
- **View Journal Entry Viewport (Slide-over / Full Modal)**:
  - **Company Card**: Click-to-call phone number, click-to-open website link, mailing address with directions lookup.
  - **Notes Content**: Renders rich Plate.js ultra-rich-text content safely in read-only mode.
  - **Attachments Deck**: Multi-file carousel showcasing photos/documents with their custom, background-generated AI descriptions overlayed dynamically.
  - **Deep Research status link**: A beautiful card representing the linked deep research project. If complete, it embeds a clickable button to go to the specific research report; if incomplete, it shows a sleek loading state: *"AI Deep Research is active for this showroom. Check back soon for vendor ratings, reviews, and competitive pricing matrixes."*
- **Log Shopping Trip Viewport (Add / Edit Form)**:
  - **Forgiving Detail Inputs**: Inputs for company name, contact, phone, email, website, and mailing address.
  - **"Auto-Enrich via Google Places" Button**: Triggers Hono enricher endpoint with one click.
  - **PlateJS Rich Editor**: Ultra rich text editor island equipped with toolbar (headers, bold, lists, quotes) for detailed notes.
  - **Drag-and-Drop Uploader**: Uploader with visual progress bars. Supports photos and documents. Files are sent instantly to the upload endpoint.

---

### 5. AI Agent & Budget Integration

#### [MODIFY] [budget-model.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/services/budget-model.ts)
- Add new variables goal parser (e.g. saves `GOAL_FLOORING_PER_SF` to `project_system_variables`).
- Implement `reconcileBudgetDeltas(env, event)`: Computes budget clearance vs cap, maps quotes against active goals, and computes proposals for achieving those goals.

#### [MODIFY] [index.ts (BudgetAgent)](file:///Volumes/Projects/workers/core-remodel/src/backend/ai/agents/BudgetAgent/index.ts)
- Implement `onBudgetChange(event)` RPC:
  - Triggered in background on quote updates or journal cost extractions.
  - Runs delta computations, triggers Workers AI Llama to formulate a friendly conversational response detailing committed cost impacts and goal clearance, and appends the message directly to the DO's chat thread.
- Update `chat` method to stream proposals alongside AI responses.

---

## Verification Plan

### Automated/Local Pass
1. Run Drizzle Kit to generate migrations and apply them locally to D1:
   ```bash
   pnpm run db:generate
   pnpm run migrate:local
   ```
2. Test Google Places API enricher via local mock request:
   ```bash
   curl -X POST http://localhost:8788/api/shopping-journal/enrich -d '{"companyName": "Porcelanosa San Francisco"}'
   ```
3. Verify that R2/Cloudflare Images uploads execute correctly without throwing memory boundaries.

### Manual Acceptance
- **Validation Auto-Enrichment**: In the "Log Shopping Trip" panel, enter only *"Home Depot San Rafael"* and click Auto-Enrich. Confirm all other details (phone, website, mailing address) instantly populate.
- **Plate.js Editor**: Enter rich text comments, format them with bullet points, and save. Reload the journal entry and verify layout structure is perfectly preserved.
- **R2 and CF Images Uploads**: Drop an image file and a PDF document. Confirm the image goes to Cloudflare Images, the PDF goes to R2, and in a few seconds, the **AI visual descriptions** populate underneath them.
- **Deep Research Hook**: Log a showroom visit to a custom company. Verify that a linked pending Deep Research session appears in the research center automatically and dispatches the research loop!
- **Budget celebration**: Add an activity under Labor & Materials Costs with `isFinal = true` representing savings of $1,000. Verify the **✨ Live AI Strategy Feed** banner instantly updates and celebrates.
