# 0030 — Receipt → Material, with room deduction

## Problem

An emailed receipt now extracts into invoice line items (0024), and materials
now carry a type (0025/#184). But nothing connects the two: a line item sits
`unmatched` forever, and even once promoted to a material, **which room does it
belong to?** The house has three bathrooms; a toilet on a receipt belongs to
exactly one, and the receipt does not say which.

Doing this by hand does not scale, and guessing silently is worse than asking —
a wrong room propagates into budget, takeoffs and comparisons with nothing
downstream able to tell it was a guess.

## What this builds

Two separable operations over an `unmatched` line item:

1. **Promote** — line item → a typed `material_schedule_items` row, with the
   line item linked back (`material_schedule_item_id`, `match_status="created"`).
   Deterministic, reversible, low-risk.
2. **Deduce** — rank the candidate rooms for that material by elimination and
   judgement, and **stage a proposal**. Never writes `roomId` on its own except
   the one auto-confirm case below.

## The deduction, in order

Cheap deterministic steps narrow the field; an AI model only judges the
ambiguous remainder. Each step records *why* it kept or dropped a room, so the
human reviews an argument, not a verdict.

1. **Candidate set by type.** A `Toilet` material can only go in a room whose
   `asIsUse`/name marks it a bathroom. Deterministic.
2. **Quantity → expected count.** `2× Kohler` implies two rooms; surface that so
   a reviewer notices if only one bathroom is left.
3. **Eliminate the already-sourced.** A bathroom that already has a `Toilet`
   material is out. Reads `GET /api/materials/by-subcategory/:id`. Deterministic.
4. **Eliminate the dormant.** A bathroom with *zero* materials of any kind is
   probably not in this remodel. Deterministic, lower-weight (advisory, not a
   hard cut — the reviewer can override).
5. **Learn from past confirmations.** A room a human already confirmed for this
   material type is eliminated for the next unit of it. This is what makes
   deduction sharpen as the project fills in.
6. **Rank the survivors.** Only now, and only if >1 remain: an AI model ranks
   them with the receipt context ("the TOTO is the pricier, more luxurious unit
   → primary; the two identical Kohlers → the matching guest + hall baths").
   Structured output, ids not names, validated against the survivor set.

**Auto-confirm rule:** if exactly one candidate survives steps 1–5, set its
`roomId` automatically and record the proposal as `auto_confirmed` with the
elimination trace. Everything else stays `staged` for human confirmation.

## Trigger

Auto-stage at ingest. `analyzeAndPersist` (the email pipeline's extraction
phase, 0024) gains a downstream step: for each `unmatched` line item it just
created, promote + deduce + stage. One additional AI call per receipt, and only
when line items were actually extracted.

## Data model

New `src/backend/db/schema/materials/material_room_proposals.ts`:

| column | notes |
|---|---|
| `id` | PK |
| `material_id` | FK → `material_schedule_items`, cascade |
| `line_item_id` | FK → `worker_email_invoice_line_items`, set null — provenance |
| `subcategory_id` | FK → `subcategories`, set null — the type deduced over |
| `status` | enum `staged` / `auto_confirmed` / `confirmed` / `overridden` / `dismissed` |
| `proposed_room_id` | FK → `rooms`, set null — the top-ranked candidate |
| `confirmed_room_id` | FK → `rooms`, set null — what the human chose (may differ) |
| `candidates_json` | ranked `[{roomId, kept, score, evidence}]` — the full argument |
| `confidence` | 0–100 |
| `reasoning_markdown` | the narrative shown to the human |
| `confidence` | int |
| `created_at`, `updated_at`, `resolved_at` | |

The proposal is the audit trail: it survives confirmation so "why is this toilet
in the primary?" is always answerable.

Confirming a proposal sets `material_schedule_items.roomId` and the proposal's
`confirmed_room_id` + `status`. One write path, shared by both surfaces below.

## Surfaces

- **MCP tools** (`tools/materials/`):
  - `promote_line_item` — line item → material (+ optional category/subcategory)
  - `list_room_proposals` — pending proposals with their reasoning
  - `resolve_room_proposal` — confirm the proposed room, or override with another
- **REST** for the frontend HITL queue:
  - `GET /api/materials/room-proposals?status=staged`
  - `POST /api/materials/room-proposals/:id/resolve` `{ roomId }`
- **Frontend HITL surface** — deferred to a later phase; the API + MCP path is
  the first cut so the flow is usable and testable without UI.

## Phases

| Phase | Ships | PR |
|---|---|---|
| **1** | schema + migration, deduction service (deterministic + AI rank), promote path, REST resolve | this bundle |
| **2** | auto-stage hook in `analyzeAndPersist` | same PR if it stays small |
| **3** | MCP tools (promote / list / resolve) | same PR |
| **4** | frontend HITL queue surface | follow-up |

## Success criteria

Reprocess the real Costco receipt (email 3) and get:
- `1× TOTO` promoted to a `Toilet` material, staged against the 3 bathrooms
- `2× Kohler` promoted (quantity surfaced), staged
- the elimination trace visible on each proposal
- confirming the TOTO to the primary eliminates the primary from the next
  toilet's candidates (learning step proven)
- an unambiguous case (one surviving bathroom) auto-confirms and logs

## Risks

- **AI ranking over free-text.** The model ranks by receipt narrative; it must
  return room **ids** validated against the survivor set, never names. A
  hallucinated id is rejected, not written.
- **Auto-confirm being wrong.** Bounded to the single-survivor case, which is
  unambiguous by construction. Still reversible via override.
- **Cost.** One AI call per receipt with ambiguous line items. Acceptable; skips
  entirely when deterministic steps already resolve to one room.
