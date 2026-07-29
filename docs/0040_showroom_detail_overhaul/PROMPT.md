# 0040 — Showroom Detail Overhaul · Build Prompt

You are building the Showroom Detail Overhaul. Read
`docs/0040_showroom_detail_overhaul/IMPLEMENTATION_PLAN.md` and `DESIGN_SPEC.md`
first. Ship **one PR per phase**. P0 is already done.

## Ground rules (repo)

- Verify branch fresh vs `origin/main` before touching code.
- D1 has **no transactions** — use `db.batch()`. Chunk any unbounded list at ~20
  rows (100 bound-param cap).
- Foreign keys, never denormalized `*_name` columns. Room/parent by id + JOIN.
- Currency = `price_text` + `price_cents`, `<CurrencyInput>`. Rich text =
  `*_markdown` + `*_html`, PlateJS `OverviewNoteEditor`.
- Schema change → `pnpm run db:generate` → `pnpm run migrate:remote`, then verify
  the column/table exists on remote. Migrations additive only.
- `npx tsc --noEmit` (esbuild build does not type-check). Update the changelog D1
  rows + `PhaseDetail` (with Mermaid `diagrams[]`). QC script per PR against
  preview **and** prod.

## P1 — Note format + safe render
1. Add `src/backend/services/notes/markdown.ts` → `renderNoteHtml(md)` producing a
   sanitized HTML subset (port `OverviewNoteEditor.markdownToHtml`, escape first,
   no `rehype-raw`). Add a self-check asserting `<script>` is stripped.
2. Route all note writes through it: `add_showroom_note` (write both cols),
   `record_showroom_visit` (render, don't copy md→html), visits `_shared.ts`
   (derive `notesHtml` from `notesMarkdown` when absent; sanitize when present).
   Update each tool description: "Body is Markdown; HTML derived server-side."
3. Frontend: render notes from `*Markdown` via `MarkdownProse`; legacy-HTML
   fallback stays. Add read-only visit-log note render (VisitCard + detail hero).

## P2 — Image management
4. Generalize note/delete to any `showroom_images` kind (routes already by-id).
   Add `PATCH /photos/:imageId` (altText, imageKind) + bulk delete.
5. Google Photos picker selections → `POST /:id/photos` (CF Images), same as file
   upload. Remove any separate downstream Google handling for showroom photos.
6. Photos section: multi-select + kebab (note/re-tag/delete) + selection bar.

## P3 — Photo folders / stacks
7. Schema: `showroom_image_groups` (name, description_markdown/html,
   price_text/price_cents, cover_image_id, sort_order, is_active) + nullable
   `group_id` FK on `showroom_images`. Generate + migrate.
8. API: CRUD groups; add/remove photos (set/clear `group_id`); delete group →
   photos to loose. Optional MCP: `create_image_group`, `add_images_to_group`,
   `set_image_group_details`.
9. Viewport: render stacks (per group) + loose; **no groups → flat grid**. Folder
   modal: carousel + editable name/description(PlateJS)/pricing(CurrencyInput) +
   add/remove members + delete. "Group into folder" from the P2 selection bar.

## P4 — Showroom inbox
10. Schema: `gmail_messages.read_at` (nullable timestamp); migration backfills
    existing → `read_at = created_at` (historical = read).
11. API: `GET /showroom-stores/:id/threads-by-domain` via generic participant
    helpers over the showroom's email columns; return threads + `unreadCount`.
    `POST /gmail/threads/:threadId/mark-read` stamps `read_at`.
12. Hero: mail icon + unread badge; click reveals `GmailThreadList` +
    `GmailThreadView` (mirror `CompanyGmailPanel`). Opening a thread marks read →
    badge decrements.

## Definition of done (each phase)
- `tsc` clean on touched files; QC green on preview + prod; changelog entry +
  detail page with diagrams; `plan_tasks` rows advanced (`in_review` w/ PR, `done`
  on merge); preview deleted after merge.
