# Rule: Questionnaire & Admin Workflow Conventions

These rules apply to all code that touches the construction questionnaire, the
material-quote ledger, the admin workflow control surface, or the AI rationale
loop.

## 1. Money is always integer cents

- All price/cost/quote/discount/budget columns MUST be stored as `integer("..._cents")`.
- Never use JavaScript floats to store money. Multiply by 100 and round at the
  parse boundary; divide by 100 only at the human-facing render boundary.
- Examples in the schema: `budget_tracker_items.estimated_low_cents`,
  `room_material_quotes.homeowner_quote_cents`,
  `room_material_quotes.contractor_discount_offer_cents`.
- New tables that add money columns MUST follow this pattern.

## 2. Three-state HITL retention for AI-derived associations

`checklist_room_mappings.associationStatus` is one of exactly three values:

| value | meaning | who writes it | safe to overwrite? |
|---|---|---|---|
| `ai_suggested` | written by the rationale workflow | system (Workflow) | yes |
| `user_confirmed` | homeowner explicitly accepted | homeowner | **never** |
| `user_disassociated` | homeowner explicitly removed | homeowner | **never** |

- The AI rationale workflow MUST filter out the two `user_*` states before
  upserting. Once a homeowner makes a decision, it is permanent until they
  explicitly change it.
- Any new AI-derived state column MUST follow the same three-state pattern.

## 3. Monolith aesthetic

- Default to the dark theme. Backgrounds anchor on `oklch(0.145 0 0)` via the
  existing `--background` token.
- Do NOT use traditional 1px borders to separate surfaces. Use `ring-1
  ring-border/30` for primary separation and `border-border/10` for fine
  dividers only.
- Money chips, status badges, and live-event tags use `rounded border-0` with a
  semantic background tint (e.g. `bg-emerald-500/10 text-emerald-400`).

## 4. Hono router validation

- Use `zValidator("json", schema)` middleware from `@hono/zod-validator` — NOT
  inline `safeParse`. Matches every other router in `src/backend/api/routes/`.
- Error envelope: `c.json({ success: false, error: "..." }, status)`.
- Success envelope: `c.json({ success: true, ...payload })`.

## 5. Workflow + scheduled-handler split

- Cron triggers in `wrangler.jsonc` are STATIC. The user-configurable schedule
  lives in `system_cron_schedules`.
- The bridge is the `* * * * *` master-tick cron + `dispatchDueWorkflows(env)`
  in `src/backend/services/workflow-dispatcher.ts`.
- Every new long-running job MUST:
  - extend `WorkflowEntrypoint` (not a one-shot service function)
  - publish progress via `publishRealtimeEvent(env, "admin-workflows:<jobKey>", payload)`
    at every `step.do` boundary
  - register in `wrangler.jsonc workflows[]`
  - get a new entry in `KNOWN_JOB_KEYS` inside `admin-workflows.ts` AND
    `workflow-dispatcher.ts`
  - seed a `system_cron_schedules` row (disabled by default)

## 6. Realtime room naming

- Admin workflow streams use the room `admin-workflows:<jobKey>` (e.g.
  `admin-workflows:checklist_rationale`).
- Frontend subscribes via the existing endpoint:
  `new WebSocket(\`${protocol}//${host}/api/realtime/estimates?room=${room}\`)`.
- Do NOT create a new realtime endpoint — the `EstimateCollabHub` DO is generic
  and broadcasts to any room name.

## 7. Sourcing deep research conventions

These rules apply to showroom/product sourcing research, category gap sweeps,
Browser Rendering extraction, Cloudflare Images ingestion, and Vectorize RAG.

- Extend `ShowroomResearchAgent` / `ResearchAgent`; do NOT create a parallel
  research worker or invoke agent methods through `stub.fetch(new Request(...))`.
- Worker/API/cron callers MUST use native Agents SDK RPC:
  `getAgentByName(env.SHOWROOM_RESEARCH_AGENT, "showroom-research")` followed
  by a typed method call.
- Gemini calls MUST use the shared AI Gateway client helper exported from
  `src/backend/services/render/providers/gemini-stage-provider.ts`.
- Workers AI calls that support Gateway options SHOULD pass
  `{ gateway: { id: env.AI_GATEWAY_ID } }`.
- Browser Rendering must go through
  `src/backend/ai/tools/browser-rendering.ts` and the
  `CF_BROWSER_RENDER_TOKEN` binding. Do NOT import `cloudflare:browser-rendering`.
- Scraped images must upload through `ImageProcessorService` before writing D1
  delivery URLs.
- Product/store/category source evidence must be embedded into
  `RESEARCH_INDEX` with target metadata (`productId`, `storeId`, `categoryId`,
  `sourceUrl`, namespace).
- AI prompts must be ES6 template literals with real newlines. Do not build
  prompts with string-array newline joins.
- New showroom sourcing endpoints must be `@hono/zod-openapi` routes with
  unique `operationId` values and matching `/openapi.json` entries.
- Category monitoring runs from the existing `* * * * *` master tick and must
  throttle automatic sweeps to avoid repeated category searches.
