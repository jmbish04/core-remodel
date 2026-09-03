# The Worker can no longer be deployed: startup CPU, and where it actually goes

- **Date raised:** 2026-09-03
- **Raised by:** budget-ux-overhaul session (orca/budget-ux-overhaul)
- **Status:** diagnosed, fix not started

## What happened

Every deploy of this Worker — production or preview, any branch — fails at
validation with:

```
Error: Script startup exceeded CPU time limit. [code: 10021]
```

A Worker must parse and execute its global scope within **1 second** of CPU
([limits](https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time)).
This one no longer does.

## Why it matters

Nobody can deploy anything. It is not one branch's problem: it was reproduced by
cutting a scratch worktree from clean `origin/main` (`88bc9b20`), symlinking
`node_modules`, and deploying a preview from there — identical failure. Any
session that hits this and goes looking through its own diff is wasting its time.

## It is not the size limits

| Measure | Value | Limit |
| --- | --- | --- |
| Bundle, gzipped | 6.04 MB | 10 MB (paid) |
| Bundle, raw | 30.9 MB | 64 MB |
| Local startup profile | ~569 ms window, 28.9% GC | 1 s CPU |

Measure without deploying:

```bash
npx wrangler check startup                              # needs wrangler >= 4.116.0 (repo pins 4.114.0)
npx wrangler deploy --outdir /tmp/bundled --dry-run      # prints "Total Upload: … / gzip: …"
```

## Where the startup CPU actually goes

Measured by mapping every CPU sample's line number back to the module that owns
it, using esbuild's `// <path>` banners in the built `_worker.js`:

| share | bucket |
| --- | --- |
| 28.9% | garbage collection |
| **28.9%** | **zod — schema construction** |
| 25.3% | unattributed (esbuild prelude/helpers) |
| 5.8% | runtime |
| 5.4% | backend routes (our code) |
| 1.8% | hono |
| 1.4% | other deps |
| 1.4% | frontend (Astro/React) |
| 0.7% | db schema (our code) |
| 0.0% | MCP tool registry |

The hottest individual modules are `zod/v4/classic/schemas.js` (12.6%),
`zod/v4/core/core.js` (7.6%), `zod/v4/core/util.js` (4.0%). The garbage
collection is downstream of allocating all those schema objects, not a separate
problem.

What runs before a single request is served:

- **96 routers** eagerly imported by `src/backend/api/index.ts`
- **231 module-scope `z.object()`** schemas and **116 `createRoute()`** calls
- **359 Drizzle table definitions** across **161 schema files** behind one barrel

This is precisely the failure Cloudflare's docs name: *"generating or consuming a
large schema at the top level is a common cause of exceeding this limit."*

There is an irony worth noting: `CLAUDE.md` mandates hand-written Zod v4 schemas
everywhere (because drizzle-zod breaks the build). That rule is correct, and it
is also what put 231 schema constructions on the startup path.

## Two things that will NOT fix it

Both were considered and measured, not argued about:

1. **Splitting the frontend into its own Worker.** The frontend is **1.4%** of
   startup. The split is worth doing on its own merits — Cloudflare recommends
   it, and 6 MB gzipped against a 10 MB cap is not comfortable — but the backend
   Worker would keep essentially all of the startup cost and still fail.
2. **Finishing the code-mode MCP work first.** The MCP tool registry is **0.0%**
   of startup samples. Collapsing 87 tool schemas into `list_tools`/`execute` is
   worth doing for token cost; it will not move this. Do not sequence the two.

Also measured and ruled out: Shiki. The bundle carries 8 TextMate grammars
(~0.5 MB of `JSON.parse` literals), which looked like the obvious culprit — the
profile contains **zero** Shiki frames. It is bundle weight, not startup CPU.

## The fix

Make `src/backend/api/index.ts` mount its routers lazily, so a request builds
only the schemas for the route it actually touches instead of all 96 up front.
The same applies to the Drizzle schema barrel. That turns a fixed startup cost
into per-route cost paid on demand, and takes the GC share down with it.

## Caveats on these numbers

- 25.3% is unattributed esbuild prelude. It is not a hidden subsystem, but it
  does cap how precise the attribution can be.
- The profile is local. Cloudflare's machines differ, and the docs say so
  explicitly. Trust the direction, not the absolute milliseconds.
- **Do not attribute bundle bytes by counting between esbuild banners.** Doing
  that blamed `agents/dist/index.js` for 18.84 MB; that file is 0.18 MB on disk.
  esbuild does not emit a banner per module, so a region gets credited to
  whichever banner preceded it. Verify any attribution against on-disk size.

## Decision

_(none needed — this is a diagnosis. The fix is scoped in its own branch.)_
