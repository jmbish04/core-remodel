# Sourcing Deep Research

## Goal

Build an end-to-end sourcing research loop for showroom stores and products that composes with the existing core-remodel Cloudflare Worker systems:

- Hono API routes under the existing showroom/research surface.
- `ShowroomResearchAgent` and `ResearchAgent` invoked by native Agents SDK RPC.
- Gemini routed through the existing AI Gateway provider pattern.
- Browser Rendering routed through `src/backend/ai/tools/browser-rendering.ts`.
- Cloudflare Images uploads routed through `ImageProcessorService`.
- D1 persistence in the existing showroom domain tables plus narrowly scoped image/spec tables where the current schema lacks them.
- Vectorize RAG upserts into the existing `RESEARCH_INDEX` binding (`core-remodel-research`).

The feature exists to turn a showroom product or under-covered category into traceable research artifacts: a user-reviewed prompt, cited source sweep, scraped semantic images, stored findings/specs, and searchable chunks.

## Current-System Anchors

The implementation must extend these existing systems:

- `src/backend/ai/agents/ResearchAgent/`
- `src/backend/ai/agents/ShowroomResearchAgent/`
- `src/backend/ai/tools/browser-rendering.ts`
- `src/backend/services/render/providers/gemini-stage-provider.ts`
- `src/backend/services/image-processor/`
- `src/backend/db/schema/showroom/`
- `src/backend/api/routes/research.ts`
- `src/backend/api/routes/showroom-stores.ts`
- `src/_worker.ts` scheduled handler
- `wrangler.jsonc` bindings: `AI`, `RESEARCH_INDEX`, `CF_BROWSER_RENDER_TOKEN`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN`, `GEMINI_API_KEY`

## Scope

1. Draft prompt endpoint for a product/material record.
2. Deep-sweep agent RPC methods for products, stores, and category gaps.
3. Gemini citation URL generation through AI Gateway.
4. Browser Rendering extraction for page text, Open Graph metadata, semantic images, and source summaries.
5. Cloudflare Images uploads for scraped product/storefront images.
6. D1 upserts for research findings, specs, product images, storefront images, and ratings where available.
7. Vectorize embeddings for synthesized summaries, warranty notes, review snippets, and source evidence.
8. Scheduled monitor that triggers a sweep when category coverage is weak or active homeowner ratings indicate rejection.

## Non-Goals

- No greenfield frontend rebuild.
- No new Worker deployment target.
- No direct `cloudflare:browser-rendering` imports.
- No `stub.fetch(new Request(...))` for Agents SDK invocation.
- No new Gemini client outside the existing AI Gateway provider module pattern.
- Gemini Deep Research must use the Interactions API with `background: true`;
  do not call it through `models.generateContent`.
- Remote MCP bridge access is opt-in per interaction, scoped by an ephemeral KV
  token, and limited to research context/progress/source tools.
- No hand-edited SQL migrations.

## Action to Endpoint Contract

| Action | Endpoint | Caller | Behavior |
|---|---|---|---|
| Review generated product prompt | `POST /api/showroom-stores/products/{productId}/research/draft-prompt` | Frontend material/product UI | Compiles D1 product, store, notes, ratings, research, specs, and rejection constraints. Uses Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through `env.AI.run(..., { gateway: { id: env.AI_GATEWAY_ID } })`. Returns `{ success, productId, prompt }` with the raw prompt string for user review. |
| Launch product deep sweep | `POST /api/showroom-stores/products/{productId}/research/deep-sweep` | Frontend material/product UI | Accepts optional reviewed prompt, `maxSources`, `researchMode: "quick" \| "deep"`, `deepResearchWaitMs`, and `enableMcpBridge`. Dispatches `ShowroomResearchAgent.deepSweepProduct(...)` via `getAgentByName(env.SHOWROOM_RESEARCH_AGENT, "showroom-research")`. Deep mode uses Gemini Deep Research through Interactions API with bounded wait and quick fallback. |
| Launch store deep sweep | `POST /api/showroom-stores/{storeId}/research/deep-sweep` | Frontend showroom UI | Accepts optional reviewed prompt, `maxSources`, `researchMode`, and `enableMcpBridge`. Dispatches `ShowroomResearchAgent.deepSweepStore(...)` via native RPC. Persists storefront images and store findings. |
| Launch category gap sweep | `POST /api/showroom-stores/meta/categories/{categoryId}/research/deep-sweep` | Admin/showroom dashboard | Accepts optional negative constraints, `maxSources`, `researchMode`, and `enableMcpBridge`. Dispatches `ShowroomResearchAgent.deepSweepCategory(...)` via native RPC. Generates suggested showroom findings for under-covered categories. |
| Autonomous monitoring | Existing `* * * * *` scheduled handler in `src/_worker.ts` | Cloudflare Cron | Calls a sourcing monitor service. If a category has at most one mapped showroom or all active mapped showrooms have homeowner rating `<= 1`, it dispatches `ShowroomResearchAgent.deepSweepCategory(...)` with rating-note rejection reasons as negative constraints. |

### Deep Research MCP Bridge

When `enableMcpBridge` is true and `researchMode` is `deep`, the Worker creates
a short-lived KV token and passes `/api/mcp` to Gemini as a remote MCP server
with `allowed_tools` restricted to:

- `get_deep_research_context`
- `record_deep_research_progress`
- `record_deep_research_source`

The token scope is the current product, store, category, or admin research
session. It cannot call render or mood-board MCP tools.

All new OpenAPI-documented endpoints must define unique `operationId` values and be represented in `/openapi.json`.

## Data Contract

### Existing Tables Used

- `showroom_stores`
- `showroom_store_products`
- `store_research`
- `store_product_research`
- `showroom_store_ratings`
- `store_rating`
- `store_product_rating`
- `showroom_store_category`
- `showroom_store_category_mapping`
- `store_product_area_def`
- `store_pa_mapping`
- `store_product_docs`

### Tables Added Only Because Current Schema Lacks Them

- `product_images` for Cloudflare Images delivery URLs mapped to `showroom_store_products`.
- `product_specs` for structured specs extracted from cited pages.
- `showroom_images` for storefront/showroom imagery mapped to `showroom_stores`.

Each table must live in one schema file under `src/backend/db/schema/showroom/` and be re-exported by `src/backend/db/schema/showroom/index.ts`.

## Agent Contract

`ShowroomResearchAgent` exposes callable methods:

- `deepSweepProduct(input)` returns counts for citations, sources processed, findings, images, specs, and vectors.
- `deepSweepStore(input)` returns counts for citations, sources processed, findings, storefront images, ratings, and vectors.
- `deepSweepCategory(input)` returns coverage/rejection context and dispatches source discovery for category alternatives.
- `generateDraftPrompt(input)` may be shared by routes, but the route owns the user-facing prompt review endpoint.

Agent invocation is always:

```ts
const agent = await getAgentByName<Env, ShowroomResearchAgent>(
  env.SHOWROOM_RESEARCH_AGENT as any,
  "showroom-research",
);
await agent.deepSweepProduct(input);
```

Never call `stub.fetch(new Request(...))` for agent methods.

## AI Contract

### Draft Prompt

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

Gateway requirement:

```ts
await env.AI.run(
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  { messages },
  { gateway: { id: env.AI_GATEWAY_ID } },
);
```

### Gemini Sweep

Gemini calls must use the AI Gateway client exported from `src/backend/services/render/providers/gemini-stage-provider.ts`.

Prompt construction must use ES6 template literals. Prompts must ask for JSON with:

- citation URLs
- source intent
- expected evidence type
- warranty/review/spec/image priorities
- negative constraints from homeowner rejection reasons

## Browser Rendering Contract

Use only `src/backend/ai/tools/browser-rendering.ts`:

- `extractJson` for Open Graph, semantic image candidates, specs, warranty notes, rating snippets.
- `extractMarkdown` for source text.
- `scrapeUrl` only when a screenshot is useful as supporting evidence.

Do not import `cloudflare:browser-rendering`.

## Image Contract

For each selected image candidate:

1. Fetch the remote image URL.
2. Validate content type starts with `image/`.
3. Upload the fetched `Blob` through `ImageProcessorService.uploadToCloudflareImages`.
4. Resolve delivery URL through `ImageProcessorService.getDeliveryUrl`.
5. Upsert the delivery URL and source metadata into `product_images` or `showroom_images`.

## Vectorize Contract

For synthesized text:

- Chunk with the existing ResearchAgent chunker.
- Embed with Workers AI `@cf/baai/bge-large-en-v1.5`.
- Upsert to `env.RESEARCH_INDEX`.
- Metadata includes:
  - `namespace`
  - `sourceType`
  - `productId`
  - `storeId`
  - `categoryId`
  - `sourceUrl`
  - `textPreview`

Namespaces:

- `showroom:product:{productId}`
- `showroom:store:{storeId}`
- `showroom:category:{categoryId}`

## Acceptance Criteria

- Draft prompt endpoint returns a raw prompt string based on live D1 state.
- Deep sweep endpoint invokes `ShowroomResearchAgent` by RPC and not HTTP fetch.
- Gemini citation discovery is routed through AI Gateway.
- Browser Rendering extraction uses the existing token-backed helper.
- Product/storefront images are uploaded through `ImageProcessorService`.
- New D1 tables have generated migrations only.
- Synthesized text chunks are embedded into `RESEARCH_INDEX`.
- The scheduled monitor reuses the existing cron handler.
- `/openapi.json` includes the new endpoints and unique operation IDs.
- `pnpm run db:generate` is run after schema changes.
- `pnpm run cf-typegen` is run before completion.
