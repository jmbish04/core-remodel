# Target Sitemap — 0013 (resolved from DRAFT_SITEMAP_NOTES.md)

> Companion to the **live** dynamic `/sitemap` (which shows *current* foldering). This is the **target** state. Conventions locked with the user: **plural** collection routes; `/admin/designs/*`; `/admin/pmo/*` (Program Management Office); taxonomy under `/admin/config/*`; public URLs stay at root.

## Public viewport (root)

| Target route | Change | Notes |
|---|---|---|
| `/` | keep | Home / mission control (contractor briefing) |
| `/access` | keep | Auth gate (reused as-is) |
| `/photos/listing` | move | from `/listing-photos` |
| `/photos/inspiration` | move | from `/inspiration-photos` |
| `/floor-plan` | keep | + `/floor-plan/floors/[id]/rooms/[id]` (Phase 7; `[id]`=floor PK + room PK via floorplan visual) + `.../rooms/closets` (all closets) |
| `/log/daily` | move | from `/daily-log` |
| `/log/weekly` | move | from `/weekly-log` |
| `/specs/measurements` | move | from `/measurements` (contractor-facing specs) |
| `/docs` | new | Public docs list — public-marked only; filters + URL-persisted search + saved views |
| `/docs/[id]` | new | Doc viewer (pdf-viewer / image iframe / non-previewable → download) |
| `/docs/view/[id]` | new | Saved view (bucket) |
| `/planning/design-master-plan` | new | Public read-only render of `decision-room` config + **contractor comments** |
| `/bid` + `/bid/[token]` | keep | Per-contractor **phone-number PIN** (cookie after first auth) |

## Admin viewport (`/admin/*`)

- **Analytics/System:** `/admin` (analytics), `/admin/plans` (this tracker), `/admin/config/*` (incl. `/admin/config/brands/types`), `/admin/integrations/usage`, `/admin/dialer`, `/admin/permits/*`.
- **PMO:** `/admin/pmo/operations` (from `/planning`), `/admin/pmo/schedule/contractor` (from `/admin/contractor-schedule`), `/admin/tasks` (ClickUp-mirrored — plan 0009).
- **Budget:** `/admin/budget/{tracker,dashboard,truth-table,reconciliation}` (from `/budget-tracker`, `/budget-dashboard`, `/admin/truth-table`, `/budget-reconciliation`).
- **Bids:** `/admin/bids` (from `/bid-portfolios`), `/admin/bids/new` (manual intake — absorbs `/admin/estimates/new`).
- **Prepare:** `/admin/prepare/uploads` (from `/uploads`), `/admin/prepare/review` (from `/review`), `/admin/prepare/blank-canvas/*` (`upload`/`generate`/`exclusions`/`floor/[id]`/`.../room/[id]`/`angles`).
- **Designs:** `/admin/designs/moodboards/*` (list, `floors/[id]`, `.../room/[id]`, `new`, `upload`, `[id]`, `[id]/revisions`), `/admin/designs/workshop` (plan 0014), `/admin/designs/decision-room`, `/admin/designs/layouts/[id]` (from `/kitchen-layout`).
- **Planning:** `/admin/planning/measure` (from `/measure`), `/admin/planning/questionnaire*` (move+keep), `/admin/planning/research(/[id])` (from `/admin/research`).
- **Docs (admin):** `/admin/docs` (all docs), `/admin/docs/upload`, `/admin/docs/permissions`, `/admin/docs/view/{new,[id]}`, `/admin/docs/[id](/edit)`.
- **Companies (CRM):** `/admin/companies` (+ `/new`), `/admin/companies/[id]` (+ `/contacts`, `/notes`, `/todos`, `/documents`, `/permits`, `/emails` — see `specs/GMAIL_COMMS.md`).
- **Shopping/Sourcing:** `/admin/shopping` hub; `/admin/shopping/showrooms/[id]/{products,brands,research,shopping-journal}`; `/admin/shopping/brands/[id]/{edit,new,products,research,shopping-journal}`; `/admin/shopping/products/[id]/{shopping-journal}`; `/admin/shopping/journal` (RAG); keep `/admin/shopping/{compare,gaps,intake,scan,schedule,sourcing,progress,research}` and reintegrate.
- **Contracts:** `/admin/contracts(/[id])` (keep).

## Deleted routes tally (hard-delete + redirect; **preserve underlying data/features**)

| Deleted route | Replant / note |
|---|---|
| `/gallery` | Render gallery folds into designs/prepare surfaces |
| `/supporting-docs` (root) + `/admin/supporting-docs` | Replaced by the Documents system (`/docs`, `/admin/docs`) |
| `/photo-edits` | Upgraded to `/admin/designs/workshop` (nano-banana) |
| `/docs/[audience]/[slug]`, `/docs/homeowners/permits` | Old static docs → new Documents system |
| `/admin/planning/decision-room` | → `/admin/designs/decision-room` |
| `/admin/planning/moodboards(/[slug])` | → `/admin/designs/moodboards` |
| `/admin/showrooms/[id]/brands/[brandId]` (plural legacy) | → `/admin/shopping/brands/[id]` |
| `/admin/estimates` (list) | Fold into `/admin/bids`; keep manual intake as `/admin/bids/new` |
| `/store/[id]`, `/store/[id]/[section]`, `/product/[id]` | Were tab-jump shortcuts; dedupe into `/admin/shopping/{showrooms,products}/[id]` |
| `/admin/shopping/showrooms/[tab]` | Tabs removed |

> Every delete keeps a redirect (in `_worker.ts`) and preserves the underlying D1 data + feature logic for replanting. Update this table as deletions land.
