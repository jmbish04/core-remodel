# Rule: Cloudflare Workers TypeScript Types

## Source of Truth

`worker-configuration.d.ts` is the **sole source of truth** for all Cloudflare runtime types AND project-specific `Env` bindings. This is the Cloudflare-recommended approach per https://developers.cloudflare.com/workers/languages/typescript/.

## NEVER DO

- **Never** add `@cloudflare/workers-types` to `tsconfig.json`'s `types` array
- **Never** import types from `@cloudflare/workers-types` in any source file
  ```typescript
  // ❌ FORBIDDEN
  import type { ExportedHandler } from "@cloudflare/workers-types";
  import type { D1Database } from "@cloudflare/workers-types";
  ```
- **Never** define manual `Bindings` or `Env` interfaces in route files
  ```typescript
  // ❌ FORBIDDEN
  interface Bindings { DB: D1Database; AI: Ai; }
  ```
- **Never** have both `@cloudflare/workers-types` and `worker-configuration.d.ts` loaded simultaneously — they declare conflicting runtime types causing `Request` type mismatches

## ALWAYS DO

- Keep `tsconfig.json` with `"types": ["./worker-configuration.d.ts"]` (and optionally `"node"` if using `nodejs_compat`)
- Use the global `Env` type directly without imports:
  ```typescript
  const handler: ExportedHandler<Env> = { ... };
  const app = new Hono<{ Bindings: Env }>();
  ```
- Run `pnpm run cf-typegen` (which runs `wrangler types`) after ANY change to `wrangler.jsonc`
- Maintain `src/env.d.ts` with `/// <reference path="../worker-configuration.d.ts" />` as a safety net

## tsconfig.json Reference

```json
{
  "compilerOptions": {
    "types": ["./worker-configuration.d.ts"]
  },
  "files": ["worker-configuration.d.ts"],
  "include": [".astro/types.d.ts", "src/**/*"]
}
```

## Why This Matters

The `@cloudflare/workers-types` npm package and `worker-configuration.d.ts` both declare ~13,000 lines of identical Cloudflare runtime globals (`Request`, `Response`, `D1Database`, `ExportedHandler`, etc.) but at potentially different versions. Loading both creates:
- `Request<IncomingRequestCfProperties>` vs `Request<CfProperties>` conflicts
- Duplicate interface declarations that confuse TypeScript
- IDE errors like "Property 'DB' does not exist on type 'Env'"
