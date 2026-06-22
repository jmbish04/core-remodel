# Coding Prompt: Sourcing Deep Research

You are working inside `/Users/126colby/.codex/worktrees/cda6/core-remodel`.

Implement the sourcing deep research feature described in `docs/0007_sourcing_deep_research/PRD.md` and `TASKS.json`.

## Absolute Constraints

- Invoke/extend existing systems. Do not build a parallel greenfield research stack.
- Keep the app as one Cloudflare Worker.
- Use native Agents SDK RPC:

```ts
const agent = await getAgentByName<Env, ShowroomResearchAgent>(
  env.SHOWROOM_RESEARCH_AGENT as any,
  "showroom-research",
);
await agent.deepSweepProduct(input);
```

- Never call an agent with `stub.fetch(new Request(...))`.
- Use `src/backend/ai/tools/browser-rendering.ts`; do not import `cloudflare:browser-rendering`.
- Use the Gemini AI Gateway client helper from `src/backend/services/render/providers/gemini-stage-provider.ts`.
- Route Gemini Deep Research through `src/backend/services/gemini/deep-research.ts`;
  use the Interactions API with `background: true`, not `models.generateContent`.
- Route Workers AI calls through `env.AI.run(..., { gateway: { id: env.AI_GATEWAY_ID } })` when the SDK supports the third argument.
- Use `ImageProcessorService` for Cloudflare Images uploads.
- Use Drizzle schema files and `pnpm run db:generate`; never hand-edit SQL migrations.
- Build AI prompts as ES6 template literals with real newlines.
- Only attach `/api/mcp` to Deep Research when `enableMcpBridge` is true. The
  MCP token must be KV-backed, short lived, scoped to the current target, and
  restricted with `allowed_tools`.
- Add unique `operationId` values for all OpenAPI-documented endpoints.

## Implementation Order

1. Add missing showroom schema files only after confirming no existing product/storefront image tables exist.
2. Export the new tables from `src/backend/db/schema/showroom/index.ts`.
3. Add a shared Gemini AI Gateway client helper to the existing Gemini provider module and point existing Gemini usage in touched files at it.
4. Add showroom research helper modules under `src/backend/ai/agents/ShowroomResearchAgent/methods/`.
5. Keep `ShowroomResearchAgent/index.ts` as the class wiring file; move deep-sweep logic into methods.
6. Add draft prompt and sweep endpoints to `src/backend/api/routes/showroom-stores.ts` with `@hono/zod-openapi` route definitions.
7. Update the static/dynamic OpenAPI surface so `/openapi.json` includes the action endpoint contract.
8. Add a scheduled monitor service and call it from the existing `* * * * *` cron path.
9. Merge sourcing-specific rules into `.agents/rules/questionnaire-conventions.md` and `.agents/workflows/implement-questionnaire-portal.md`; do not overwrite.
10. Run generation and verification commands.

## Endpoint Contract

- `POST /api/showroom-stores/products/{productId}/research/draft-prompt`
- `POST /api/showroom-stores/products/{productId}/research/deep-sweep`
- `POST /api/showroom-stores/{storeId}/research/deep-sweep`
- `POST /api/showroom-stores/meta/categories/{categoryId}/research/deep-sweep`

Deep sweep request options:

```ts
{
  prompt?: string;
  maxSources?: number;
  negativeConstraints?: string[];
  researchMode?: "quick" | "deep";
  deepResearchWaitMs?: number;
  enableMcpBridge?: boolean;
}
```

## Expected Result Shape

The deep-sweep RPC methods and endpoints should return:

```ts
{
  success: boolean;
  targetType: "product" | "store" | "category";
  targetId: number;
  citationsFound: number;
  sourcesProcessed: number;
  findingsWritten: number;
  imagesWritten: number;
  specsWritten: number;
  vectorsWritten: number;
  warnings: string[];
}
```

## Monitoring Behavior

On the existing master tick cron, query category coverage:

- If a category has `<= 1` mapped showroom, trigger category sweep.
- If all mapped active showrooms for a category have active homeowner rating `<= 1`, trigger category sweep.
- Append active rating notes as negative constraints.
- Limit automatic work per cron tick to avoid stampedes.
