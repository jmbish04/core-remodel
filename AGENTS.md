# AGENTS.md — core-remodel

> AI agent instructions for the core-remodel project.  
> Read this file **at session start** before writing any code.

## Project Overview

**core-remodel** is a renovation inspiration photo manager deployed on Cloudflare Workers. It uses Astro SSR for the frontend, Hono for the API layer, Drizzle ORM for D1 (SQLite) persistence, and Workers AI for image analysis.

**Production URL:** `core-remodel.hacolby.workers.dev`

---

## Architecture

```
src/
├── _worker.ts              # Cloudflare Workers entry point (ExportedHandler<Env>)
├── env.d.ts                # Triple-slash reference to worker-configuration.d.ts
├── backend/
│   ├── api/
│   │   ├── index.ts        # Main Hono router (Hono<{ Bindings: Env }>)
│   │   └── routes/         # Feature-specific route handlers
│   ├── db/
│   │   └── schema/         # Drizzle ORM schema (domain-organized)
│   │       ├── index.ts    # Barrel export (single point of truth for drizzle-kit)
│   │       ├── auth/       # Auth tables
│   │       ├── ai/         # AI-related tables
│   │       ├── images/     # Image review tables
│   │       ├── dashboard/  # Dashboard tables
│   │       └── ...
│   └── services/           # Business logic services
└── frontend/
    ├── components/         # React components (Astro islands)
    ├── layouts/            # Astro layouts
    ├── pages/              # Astro pages (.astro files)
    ├── lib/                # Frontend utilities
    └── styles/             # CSS/Tailwind styles
```

---

## Critical Rules

### 1. TypeScript & Environment Types (MANDATORY)

**`worker-configuration.d.ts` is the SOLE source of truth for all Cloudflare types.**

Per [Cloudflare's official guidance](https://developers.cloudflare.com/workers/languages/typescript/):

- **DO NOT** import from `@cloudflare/workers-types` in any source file.
- **DO NOT** add `@cloudflare/workers-types` to `tsconfig.json`'s `types` array.
- `wrangler types` generates `worker-configuration.d.ts` which contains:
  - All runtime types (`Request`, `Response`, `D1Database`, `R2Bucket`, `Ai`, `ExportedHandler`, etc.)
  - The project-specific `Env` interface with all bindings from `wrangler.jsonc`
  - A global `interface Env extends Cloudflare.Env {}` for use everywhere

**tsconfig.json must look like:**
```json
{
  "compilerOptions": {
    "types": ["./worker-configuration.d.ts"]
  }
}
```

**After changing `wrangler.jsonc` bindings, always run:**
```bash
pnpm run cf-typegen  # → wrangler types
```

### 2. Using the Global `Env` Type

The global `Env` type is available everywhere without imports. Use it directly:

```typescript
// ✅ CORRECT — _worker.ts
const handler: ExportedHandler<Env> = { ... };

// ✅ CORRECT — Hono routes
const router = new Hono<{ Bindings: Env }>();

// ✅ CORRECT — accessing bindings
const db = drizzle(c.env.DB);
const bucket = c.env.IMAGES_BUCKET;
const ai = c.env.AI;

// ❌ WRONG — do NOT import from @cloudflare/workers-types
import type { ExportedHandler } from "@cloudflare/workers-types";

// ❌ WRONG — do NOT define manual Bindings interfaces
interface Bindings { DB: D1Database; AI: Ai; }
```

### 3. Database & ORM (Drizzle + D1)

- **ORM:** Drizzle ORM (required for all D1 interactions)
- **Schema location:** `src/backend/db/schema/{domain}/{table}.ts`
- **Barrel export:** `src/backend/db/schema/index.ts` (re-exports everything)
- **No raw SQL** in application code — use Drizzle query builder
- **Migrations:** Generated via `drizzle-kit` (`pnpm run db:generate`)
- **Import path:** Always use `@backend/db` alias (never relative paths)

```typescript
// ✅ CORRECT
import { imageReviews } from "@backend/db";

// ❌ WRONG
import { imageReviews } from "../../../db/schema/images/image_reviews";
```

### 4. Path Aliases

Use the configured TSConfig path aliases. Never use deep relative imports (`../../../`):

| Alias | Resolves To |
|-------|-------------|
| `@backend/db` | `src/backend/db/schema/index.ts` |
| `@backend/db/*` | `src/backend/db/*` |
| `@backend/api/*` | `src/backend/api/*` |
| `@backend/ai/*` | `src/backend/ai/*` |
| `@backend/services/*` | `src/backend/services/*` |
| `@frontend/*` | `src/frontend/*` |

### 5. API Routes (Hono)

- All routes live in `src/backend/api/routes/{feature}.ts`
- Each route file exports a `const {feature}Router = new Hono<{ Bindings: Env }>()`
- Routes are mounted in `src/backend/api/index.ts`
- The `_worker.ts` routes `/api/*` to Hono, everything else to Astro's `ASSETS` binding

### 6. Frontend (Astro + React)

- Pages are `.astro` files → use `class` not `className` for HTML attributes
- React components are islands → use `client:load` or `client:visible` directives
- When typing `fetch` responses in React, always annotate with explicit types:
  ```typescript
  const data = (await res.json()) as { images: ImageReview[] };
  ```

---

## Key Commands

| Task | Command |
|------|---------|
| Dev server | `pnpm run dev` |
| Build | `pnpm run build` |
| Generate DB migrations | `pnpm run db:generate` |
| Apply migrations (local) | `pnpm run migrate:local` |
| Apply migrations (remote) | `pnpm run migrate:remote` |
| Seed DB (remote) | `pnpm run db:seed` |
| Regenerate Env types | `pnpm run cf-typegen` |
| Full deploy | `pnpm run deploy` |

---

## Bindings (from wrangler.jsonc)

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1Database | Primary SQLite database |
| `IMAGES_BUCKET` | R2Bucket | Image storage |
| `AI` | Ai | Workers AI inference |
| `CACHE` | KVNamespace | General caching |
| `SESSIONS` | KVNamespace | Session storage |
| `VECTOR_INDEX` | VectorizeIndex | Embedding search |
| `ASSETS` | Fetcher | Astro SSR static assets |
| `*_API_KEY` / `*_TOKEN` | SecretsStoreSecret | Various API credentials |

---

## Common Pitfalls

1. **Duplicate type declarations:** Having both `@cloudflare/workers-types` and `worker-configuration.d.ts` causes `Request` type conflicts (`IncomingRequestCfProperties` vs `CfProperties`). Use only `worker-configuration.d.ts`.

2. **Stale Env types:** After adding/removing bindings in `wrangler.jsonc`, you MUST run `pnpm run cf-typegen` to regenerate `worker-configuration.d.ts`.

3. **Schema exports:** All Drizzle schema tables MUST be re-exported from `src/backend/db/schema/index.ts` or `drizzle-kit generate` will miss them.

4. **Astro vs React attributes:** `.astro` files use HTML attributes (`class`, `for`). React `.tsx` components use JSX attributes (`className`, `htmlFor`).
