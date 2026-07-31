# 0042 — Build prompt

Build per IMPLEMENTATION_PLAN.md + DESIGN_SPEC.md. Cloudflare Workers + Astro +
Hono + Drizzle/D1, Base-UI shadcn. Reuse aggressively; this AMENDS #310 (merge #310
first). Order = each phase its own PR.

**P0 — pipeline split (enable non-AI-first).** In `src/backend/services/email/pipeline.ts`:
hoist `extractAttachmentText` (deterministic `toMarkdown` for PDF/Office) OUT of
`analyzeAndPersist` so it runs in the always-on non-AI phase; persist
`worker_email_attachments.extracted_text`; add **embeddings** (reuse `bge-large` +
`env.VECTOR_INDEX`, chunked like `gmail/ingestion.ts embedMessage`). Make the Gemini
extract a separately-callable step. Add `deferAiUntilApproval?: boolean` to
`RouteDecision`/profile (`services/email/types.ts`, `routes.ts`). Leave a self-check.

**P1 — trust gate.** Worker-email routes: AI runs inline (unchanged). Gmail bridge:
set `GATE_DECISION.deferAiUntilApproval = true` (both `ingest-gate.ts` and the Path A
bridge in `ingestion.ts` from #310) → run non-AI + embeddings, then stamp
`worker_emails.ai_status='pending_approval'` (migration: add `source`, `ai_status`,
`ai_approved_at/by`). Image attachments → `ocr_status='needs_ai_ocr'` → pending.

**P2 — approval.** `POST /api/worker-emails/:id/approve-ai` + MCP `approve_email_ai`:
runs the deferred Gemini extract (image OCR via vision model), then the normal
invoice/line downstream; `publishRealtimeEvent` on completion.

**P3 — alerts.** `GET /api/alerts` aggregator (UNION unread `gmail_messages` +
`ai_status='pending_approval'` worker_emails + unconfirmed `worker_email_invoices` +
staged `material_room_proposals` + extracted-quote pending-maps; each with a
deep-link). Header **bell** + `/admin/alerts` island, live via the realtime WS.
Fire a `mail_received` poke from the pipeline after persisting an email.

**P4 — showroom pending.** "Pending from email" panel in `StoreViewportApp`; price →
`record_price_observation` (source manufacturer/showroom, confidence=extracted).

**P5 — products.** Per extracted line: `ensure_brand` → `ensure_product` (dedup) →
`link_product_to_showroom` → set line `product_id`/`brand_id`; render "new from quote
— confirm/map". Add `product_id`/`brand_id` FK columns to
`worker_email_invoice_line_items`.

**Constraints:** never run extraction-AI on Gmail content without approval; embeddings
(non-interpretive) may auto-run; `db.batch()` not transaction; chunk >100 params; FKs
not name columns; structured-output for AI; QC + changelog + preview per repo rules;
each PR leaves a runnable check.
