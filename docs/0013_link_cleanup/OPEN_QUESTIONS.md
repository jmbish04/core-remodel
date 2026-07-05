# Open Questions — 0013 (ANSWERED)

Resolved with the user. Kept here as the decision record; `SITEMAP.md` + `TASKS.json` reflect these.

## Conventions
1. **Singular vs plural collection routes** → **plural** (`showrooms`, `stores`, `brands`, `products`).
2. **`design` vs `designs`** → **`designs`** (`/admin/designs/*`).
3. **PMO namespace** → **`/admin/pmo/operations`**, **`/admin/pmo/schedule/contractor`**. (PMO = **Program** Management Office.)
4. **Taxonomy/enums** → under **`/admin/config/*`** (e.g. `/admin/config/brands/types`).

## Deletions
5. **Deleted routes** → **hard-delete** (with redirect) **but keep a running tally** (see `SITEMAP.md` → Deleted routes) **and preserve the underlying data/features** ("desk stuff") for replanting.
6. **Questionnaire** → **move + keep** under `/admin/planning/questionnaire`.

## Contractor/public boundary
7. **`kitchen-layout`** → **admin** (`/admin/designs/layouts/[id]`).
8. **`/planning/design-master-plan`** → **public read-only** render of admin `decision-room` config; **contractors can leave comments**.
9. **Mood boards** → **admin-only**; contractors see them only via `/planning/design-master-plan`.

## Documents (Phase 2)
10. **View-visibility precedence** → default behavior as specced: a view marked contractor-visible exposes its member docs even if a doc is private; **amber warnings** fire on (a) dynamic views lacking a `visibility:public` filter and (b) static views containing private docs.
11. **Non-previewable files** → anything that can't render in an `<iframe>` → **download-only** with metadata.
12. **OCR/parse stack** → `npm i @llamaindex/liteparse` + Workers AI vision **`@cf/meta/llama-3.2-11b-vision-instruct`** (user supplied the exact call — see below); embeddings → existing Vectorize.

```ts
// Workers AI vision OCR (user-provided)
const imageBuffer = await request.arrayBuffer();
const imageArray = [...new Uint8Array(imageBuffer)];
const prompt = "Act as an OCR engine. Extract all readable text from this image exactly as it appears. Do not summarize, interpret, or add conversational filler. Maintain layout spacing where possible.";
const aiResponse = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { image: imageArray, prompt, max_tokens: 1024 });
// aiResponse.description || aiResponse.response
```

## Companies CRM (Phase 3)
13. **Gmail integration** → full spec in `specs/GMAIL_COMMS.md` (service-account domain-wide delegation via `GOOGLE_CREDS_SA_*` secrets, poll `justin@126colby.com`, per-contractor email-domain search, `gmail_threads`/`gmail_messages` D1 + Vectorize, reply-all send, Workers-AI drafts, Agent-SDK reader, inbox UI `shadcn sidebar-09`).
14. **Bid PIN** → contractor **phone number** is fine for now.

## Bids / Budget (Phase 6)
15. **Estimates vs Bids** → estimates **list deleted**; manual-estimate intake survives as **`/admin/bids/new`**.
16. **`/budget-reconciliation`** → **same** concept as the "Seed Homeowner Plan" button: CSV/Sheets data that needs reconciling. See `BudgetReconciliationApp.tsx` + `/api/budget-tracker/csv-ingestion`.

## Showroom/sourcing (Phase 5)
17. **`/admin/shopping/schedule`** → keep. Hours belong on the showroom **hero** (make it professional using the beste.co `BusinessHero`/`ShowroomContact` blocks), applied to the **List + Directory** cards, with the hero hours card **clickable → modal** (full M–Sun schedule + phone/email/address/socials; modal only inside the showroom viewport).
18. **`/admin/shopping/{sourcing,progress,scan,intake,showrooms[/tab]}`** → **found in code — keep and reintegrate** into the flow. `scan` = business-card OCR (Workers AI); `intake` = a **dedicated page** (linked from a "New showroom" button), not a modal; `showrooms/[tab]` = duplicative (tabs removed).
19. **`/store/[id]`, `/product/[id]` dedup** → these were tab-jump shortcuts (many tabs before); dedupe into `/admin/shopping/{showrooms,products}/[id]`.

## Floor/room (Phase 7)
20. **`/floor-plan/floors/[id]/rooms/[id]`** → `[id]` = floors/rooms **auto-PK**, reached via the **floorplan visual** (forces user intent — no mistaking lower vs upper "living room"). `closets` = "all closets on this floor" (for hardware-flooring takeoffs).

## Cross-initiative
21. **ClickUp vs Scrum** → task management is **ClickUp-backed** (`services/clickup-client.ts`) **mirrored into our own D1 + PMO on the worker**; ClickUp is a fallback safety net. Plan `0009`.

## Sidenote (Phase 5, folded into the enrichment pipeline)
Showroom-website scraping needs work: capture the whole page, socials, confirm contact (phone/email/mailing address), hours, and **extract all possible brands**. → `specs/SHOWROOM_ENRICHMENT.md`.
