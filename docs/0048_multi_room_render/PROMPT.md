# 0048 — Coding Prompt: Multi-Room Multi-Angle Render Campaigns

Implement the feature described in `IMPLEMENTATION_PLAN.md` in this same directory.

## Scope

1. **Schema** — add `render_campaigns`, `render_campaign_angles`, and `render_campaign_sessions` tables.
2. **Service** — add `src/backend/services/render/campaign.ts` with create/get/list/cancel.
3. **API** — add `/api/render/campaigns` routes.
4. **Workflow** — add `RenderCampaignWorkflow` that processes angles sequentially, hero first.
5. **MCP** — add `renderTools` domain in `src/backend/mcp/tools/render/` and register in the canonical OAuth registry.
6. **Frontend** — add `/admin/render/campaigns` list and detail pages.
7. **QC** — add a PR verification script and update `src/frontend/data/changelog.ts`.

## Constraints

- Do not modify the legacy bearer-auth MCP server (`src/backend/api/routes/mcp/`).
- Do not break existing `/api/render/looks` or room-scoped `render_sessions` flows.
- Use the existing `runStage` provider factory and `ImageProcessorService` for uploads.
- Hero angle must be rendered first and passed as a `ReferenceImage` to subsequent angles.
- All new code must pass `pnpm run build`, `pnpm run check`, and `npx tsc --noEmit`.
- Follow the Monolith design system (dark, OKLCH chart palette, no traditional borders) for any new UI.

## Entry points

- Backend routes: `src/backend/api/routes/render.ts`
- MCP registry: `src/backend/mcp/tools/index.ts`
- Workflow registration: `wrangler.jsonc` + `src/_worker.ts`
- Frontend pages: `src/frontend/pages/admin/render/campaigns.astro` + `[id].astro`

## Verification

Run the QC script you add and confirm:

- Campaign creation returns an id.
- Workflow processes all angles and updates campaign status.
- Hero canvas is linked and used as reference.
- MCP tools are listed in `/api/mcp-docs`.
- Admin page renders without errors.
