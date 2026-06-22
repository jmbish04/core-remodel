# Workflow: Implement Feature

## Objective

Ship feature work by extending the existing single Cloudflare Worker systems in
place. Prefer current routers, agents, services, schemas, and workflows over
parallel implementations.

## Shared Steps

1. Read the relevant docs under `docs/` and update the feature spec before code
   changes when the request requires a shared agent handoff.
2. Inspect existing route, schema, service, agent, workflow, and frontend
   surfaces for the same domain.
3. Add D1 tables as one file per table under the closest existing schema
   namespace, export through that namespace index, then run
   `pnpm run db:generate`.
4. Register API changes on existing Hono routers with Zod validation and unique
   OpenAPI operation IDs.
5. Invoke Durable Objects and Agents through typed methods or native RPC. Do not
   route agent method calls through `stub.fetch(new Request(...))`.
6. Reuse shared Cloudflare service helpers before creating new clients.
7. Run focused lint/type/build verification and record any repo-wide baseline
   failures separately from feature-specific failures.

## Extension: Sourcing Deep Research

This extension covers `docs/0007_sourcing_deep_research/`.

### Phase 1 - Docs

1. Maintain `PRD.md`, `TASKS.json`, and `PROMPT.md` in
   `docs/0007_sourcing_deep_research/`.
2. Keep the action to endpoint contract explicit for frontend agents.

### Phase 2 - Schema

1. Add showroom sourcing tables under `src/backend/db/schema/showroom/`.
2. Re-export all new tables from `src/backend/db/schema/showroom/index.ts`.
3. Generate migrations with `pnpm run db:generate`; never hand-edit generated
   migration SQL.

### Phase 3 - Agent Orchestration

1. Extend `ShowroomResearchAgent` and `ResearchAgent`; do not build a parallel
   research worker.
2. Put sweep implementation details under
   `src/backend/ai/agents/ShowroomResearchAgent/methods/`.
3. Invoke agents via `getAgentByName(env.SHOWROOM_RESEARCH_AGENT,
   "showroom-research")` followed by a typed method call.
4. Route Gemini calls through the shared AI Gateway helper exported from
   `src/backend/services/render/providers/gemini-stage-provider.ts`.
5. Route Browser Rendering through
   `src/backend/ai/tools/browser-rendering.ts`.
6. Upload scraped image buffers through `ImageProcessorService`.
7. Embed synthesized summaries, warranty notes, and reviews into
   `RESEARCH_INDEX` with target metadata.

### Phase 4 - API Surface

1. Mount draft prompt and deep sweep actions on the existing research/showroom
   routers.
2. Use `@hono/zod-openapi` routes where new endpoints must appear in
   `/openapi.json`.
3. Return raw draft prompt strings for user review.
4. Return count-bearing sweep results for citations, sources, images, chunks,
   and warnings.

### Phase 5 - Autonomous Monitor

1. Use the existing scheduled handler and master tick instead of adding an
   unrelated scheduler.
2. Query D1 for category coverage and active homeowner rejections.
3. Trigger a new category sweep when coverage is empty or thin, or when mapped
   showrooms are rejected.
4. Append homeowner rejection notes as negative constraints in template literal
   prompt context.
5. Throttle automatic sweeps per category.

### Phase 6 - Verification

1. Run an agent invocation anti-pattern scan.
2. Run `pnpm run db:generate`.
3. Run `pnpm run cf-typegen`.
4. Run focused lint and build checks.
