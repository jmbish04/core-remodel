# FABLE_PROMPT — Handoff to Fable: deliver the rest of the 0013 site/IA roadmap

> **You are Fable**, taking over the multi-phase **0013 site/URL-cleanup + two-viewport IA redesign** for the `core-remodel` app from the previous (Opus) session. Phase 1 is fully shipped and deployed. This document is your single entry point: it tells you the ground truth, what's done, what's left, exactly how work gets shipped here, and the traps that will bite you if you don't respect them.
>
> Read this top-to-bottom once, then keep it open. When in doubt, prefer the more specific source-of-truth docs it points you to.

---

## 0. First moves (do these before writing any code)

1. **Read the roadmap package** (this folder, `docs/0013_link_cleanup/`), in this order:
   - `ROADMAP.md` — workstreams → phases, sequencing, dependencies.
   - `SITEMAP.md` — the **target-state** sitemap (every route → `keep|move|new|delete|investigate`) + the running "Deleted routes" tally. This is the authority for where a route should end up.
   - `PROMPT.md` — the per-session coding-agent workflow (pick next unblocked task → build → PATCH tracker status).
   - `OPEN_QUESTIONS.md` — every embedded question, **already answered** by the user; the answers are conventions you must honor.
   - `RECOVERY.md` — the Workstream W0 lost-work inventory.
   - `IMPLEMENTATION_PLAN.md`, `TASKS.json`, `specs/GMAIL_COMMS.md`, `specs/SHOWROOM_ENRICHMENT.md`.
2. **Read `AGENTS.md`** at the repo root (stack rules) and `wrangler.toml` + `package.json` (bindings, script names, exact version pins).
3. **Look at the live tracker**: `/admin/plans` and `/admin/plans/0013_link_cleanup` — D1-backed board of every task with live status. Backed by `plans` + `plan_tasks` (migration 0066), seed = `src/backend/db/seeds/seed-plan-tasks.ts` (source of truth; auto-seeds on first authed load). API: `/api/admin/plans/*`.
4. **Do NOT touch the primary checkout's working tree.** `/Volumes/Projects/workers/core-remodel` (the non-worktree checkout) sits on branch `room-floorplan-overview-and-room-viewport-changes` with ~80–100 **uncommitted** files (the "deploy-uncommitted drift" pattern). That work is already preserved on `rescue/w0-uncommitted` and `rescue/showroom-brands-wip`. Never `git add -A`/commit/checkout in that directory — always work in a fresh worktree off `origin/main` (see §4).

---

## 1. Who the user is & how he works

- **Justin** (`justin@126colby.com`) — homeowner renovating **126 Colby**, technically sophisticated, drives product direction himself. He owns the product decisions; you own the delivery.
- **No mock/placeholder data, ever.** Wire real endpoints and real D1 data. Half-built stubs that pretend to work are worse than nothing.
- He values **exact numbers** (measurements → material takeoffs) and clean, professional UI (see Monolith theme, §3).
- He often runs **parallel sessions in separate worktrees**. Assume other branches may be moving; always branch from fresh `origin/main`.
- Surface genuine product forks with a crisp recommendation; don't stall on choices that have an obvious default.

---

## 2. Stack (what this app is)

- **Cloudflare Workers** + **Astro SSR** (`output: "server"`, `@astrojs/cloudflare`) + **Hono** API (`@hono/zod-openapi`) + **Drizzle ORM on D1** + **shadcn/ui** + **Monolith dark theme**.
- **Entry point `src/_worker.ts`** routes `/api/*` (+ `/openapi.json`, `/scalar`, `/swagger`, `/context`, `/api-docs`) to the Hono app; everything else to Astro SSR. It also holds:
  - `LEGACY_REDIRECTS` — the prefix-matched 301 table for moved pages (**this is where page redirects live — NOT Astro's `redirects` config**; see §5 gotcha).
  - The `/admin*` auth gate (redirects unauthenticated users to `/access?next=`).
  - Durable Object / Workflow re-exports and the `scheduled()` cron dispatch.
- **Auth**: `remodel_access` HttpOnly cookie = `SHA-256(WORKER_API_KEY)`. Endpoints `/api/access/{status,login,logout}`. Admin pages gated by the `/admin` prefix in `_worker.ts`.
- **Agents SDK** (`agents` package) for AI: DO-based agents with a built-in FIFO queue (`this.queue(...)`) — used instead of a CF Queue for self-throttling background work (e.g. showroom backfill enrichment).
- **AI/OCR stack for the Documents pipeline** (Phase 2): `@llamaindex/liteparse` + Workers AI vision `@cf/meta/llama-3.2-11b-vision-instruct`; embeddings → the existing **Vectorize** index. (User supplied the exact call shape — see `specs/`.)

---

## 3. Non-negotiable conventions & gotchas (these WILL bite you)

**Theme — "Monolith" dark:** `bg-card`, `ring-1 ring-border/40` for edges — **never** hard 1px borders. Recharts only for charts. Match the density/idiom of surrounding components.

**shadcn Dialog is Base UI, NOT Radix.** shadcn components here wrap `@base-ui/react`. Radix props (`onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`, `dismissible`) **do not exist**. To block dismissal, guard the controlled `onOpenChange`. Checkboxes/switches follow the Base UI pattern (`data-checked:` etc.), see `src/frontend/components/ui/checkbox.tsx`.

**Never import `drizzle-zod` in schema files.** It passes `tsc` but **breaks `pnpm run build`** on the pinned `drizzle-orm@0.33.0`. Hand-write route Zod schemas (Zod **v4**).

**Astro `redirects` config is broken here.** The CF adapter emits a malformed self-referential `_redirects` splat rule for dynamic destinations → wrangler rejects deploy with `"infinite loop detected"`. **All page redirects go in `LEGACY_REDIRECTS` in `src/_worker.ts`** instead.

**`pnpm run build` does NOT type-check** — it's esbuild + astro build (no `tsc`). So:
- Always **also** run `pnpm exec tsc --noEmit` and filter to files you changed. There is a **~171-error pre-existing baseline** (`cn` unimported, PlateJS `Value` typing, `unknown` payloads, etc.) — don't chase those; only care about NEW errors on YOUR lines.
- The client bundle can **OOM CI** (the `react-filerobot-image-editor` dep). `package.json` build script already sets `NODE_OPTIONS=--max-old-space-size=8192` — keep it.

**Migration discipline:** generate with `pnpm run db:generate`; apply with **`pnpm run migrate:remote` ONLY**. Never `wrangler d1 execute --file`. Migrations are numbered sequentially — base is currently past **0067**. Do **not** blind-apply the stale `drizzle/0055–0058` sitting on `rescue/w0-uncommitted` (they're superseded/renumbered).

**DO migration-tag desync:** branch deploys advance the prod Worker's Durable-Object migration tag. An unmerged branch with a higher DO-migration tag can leave `main` + sibling branches unable to deploy (error 10074). If you hit this: merge the higher-migration branch **up** first, then rebase — never delete DO namespaces.

**Deploy = every push.** Workers Builds runs `pnpm run deploy` (build → `migrate:remote` → `wrangler deploy`) on **every push to any branch**. Therefore **a passing PR build means it is already deployed to prod.** Treat every PR as a production change. Merging to `main` re-deploys.

---

## 4. How work ships here — the loop (follow it exactly)

This is the user's **standing directive**, honor it every time:

> "Anytime you create a PR, take on another task while you await Gemini to provide a code review, then circle back once your mini task is completed and address any Gemini code comments, patch the PR, and merge the PR."

Concrete per-increment recipe:

1. **Branch in a fresh worktree off latest main:**
   ```bash
   cd /Volumes/Projects/workers/core-remodel
   git fetch origin --quiet
   git worktree add -b claude/<slug> .claude/worktrees/<slug> origin/main
   ```
2. **Make the change.** Keep each increment tightly scoped (one coherent slice → one PR). Don't bundle unrelated moves.
3. **Verify locally:** `pnpm install --frozen-lockfile` → `pnpm exec tsc --noEmit` (filtered to your files) → `CI=true pnpm run build` (server+client green) → `rm -rf dist`.
4. **Commit + push + open PR.** Commit trailer: `Co-Authored-By:` your model line. PR body trailer: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. **While Gemini (`gemini-code-assist[bot]`) reviews, start the next mini-task.** Poll the build with `gh pr checks <n>`; it deploys on green.
6. **Circle back:** read Gemini's review (`gh pr view <n> --json reviews` + `gh api repos/jmbish04/core-remodel/pulls/<n>/comments`), apply valid comments, push the fix, wait for green.
7. **Merge:** `gh pr merge <n> --squash --delete-branch`. Then `git worktree remove .claude/worktrees/<slug> --force`.
8. **Update the tracker & memory** (see §7).

**`/swarm`** is available (cloudflare-jedi specialist sub-agents: `cf-database-engineer` → `cf-api-engineer` → `cf-frontend-engineer` pipeline for DB-driven features; parallel frontend+agents-sdk for chat). Use it for large cross-stack builds (e.g. Phase 2 Documents system). Route-move slices like Phase 1 were done by hand (delicate link rewrites) — that's fine, don't force a swarm where a careful manual pass is safer.

### The route-move playbook (reuse verbatim for any remaining moves)

Phase 1 moves used this **anchored** link rewrite so a short slug never corrupts a longer sibling and mid-string paths (e.g. `/api/listing-photos`) are never touched:

```perl
# one rule per move; anchor to a URL-literal delimiter (" ' `) + trailing (?![\w-])
s{(["\x27\x60])/OLD/PATH(?![\w-])}{$1/NEW/PATH}g;
```
Run it over `src/frontend src/backend` (it auto-fixes `nav-groups.ts` and `portal.ts`), but **EXCLUDE `src/_worker.ts`** and edit its `LEGACY_REDIRECTS` by hand:
```bash
find src/frontend src/backend -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.astro' \) -print0 \
  | xargs -0 perl -i -p /path/to/rewrite.pl
```
Then verify: (a) zero OLD page-links remain (`rg -F`), (b) preserved siblings intact, (c) each new redirect TARGET is not itself a redirect FROM (single-hop, no chains), (d) no `/admin/admin` / double-prefix, (e) `git mv` the page files, (f) **update `portal.ts` navigationGuide** if you moved any of its 5 contractor links (`/floor-plan`, `/photos/listing`, `/photos/inspiration`, `/supporting-docs`, `/log/daily`) — breaking the contractor guide is the #1 regression risk on public moves.

---

## 5. What's already DONE (Phase 1 — do not redo)

All merged to `main` and deployed:

| PR | What shipped |
|---|---|
| **#57** | W0 blank-canvas + photo-editing subsystem restored (migration 0067; needs the 8GB build heap). |
| **#58** | **Viewport split**: `AppSidebar` → `PublicSidebar` / `AdminSidebar` (`src/frontend/components/sidebar/{shared,nav-groups,PublicSidebar,AdminSidebar}`), chosen by path in `BaseLayout` (`isAdmin = /admin` prefix). "Enter Admin Portal" / "Exit" / "Log out" reuse `remodel_access` auth. Contractor `navigationGuide` repointed to public pages. |
| **#59** | Namespace reorg **slice 1** — budget/pmo/planning: `/admin/budget/{tracker,dashboard,truth-table,reconciliation}`, `/admin/pmo/{operations,schedule/contractor}`, `/admin/planning/{measure,research}`. |
| **#60** | Namespace reorg **slice 2** — designs/prepare/bids/config + public photos/log: `/admin/bids(/new)`, `/admin/prepare/{uploads,review,blank-canvas}`, `/admin/designs/{decision-room,moodboards}`, `/admin/config/brands/types`, and public `/photos/{listing,inspiration}` + `/log/{daily,weekly}`. |

The **mechanical route-move work of Phase 1 is complete.** `LEGACY_REDIRECTS` in `_worker.ts` has single-hop 301s for every old path. Sidebar `nav-groups.ts` and `portal.ts` are current.

---

## 6. What's LEFT (your work) — prioritized

### 6a. Deferred slice-2 items (each needs a build or a product decision — NOT a `git mv`)
These were intentionally NOT done because doing them mechanically would break things or expose data. Each is its own small PR:

1. **`/specs/measurements` (read-only public view)** — ⚠️ the current `admin/measurements.astro` hosts `<MeasurementsApp>` which **fetches AND mutates** `/api/measurements`. It is an admin *editor*, not a viewer. Do **not** just move it public. The roadmap's `/specs/measurements` is a **new read-only** contractor surface: render measurements read-only (no create/edit/delete), backed by a read-only GET. The editor **stays gated** at `/admin/measurements`. Confirm scope/sensitivity with the user before publishing home dimensions.
2. **`kitchen-layout` → `/admin/designs/layouts/[id]`** — root→admin, static→`[id]` param, auth change. Needs a layouts data model / id scheme.
3. **Estimates fold into `/admin/bids`** — `/admin/estimates` (list) is deleted; manual intake survives as `/admin/bids/new`. Data/feature work (Phase 6), not a move. Bid PIN = contractor **phone number**.
4. **`builder` → `/admin/prepare/blank-canvas/angles`** — camera-on-floorplan rework (Phase 4).
5. **Dead-route deletions** (`/gallery`, `/supporting-docs` root+admin, `/photo-edits`) — **blocked**: their replacements (Documents system; `/admin/designs/workshop`) don't exist yet. Hard-delete only once the replacement ships, and **keep a running tally in `SITEMAP.md` + preserve the underlying data**. `/photo-edits` was just restored by W0 (#57) — don't delete it.

### 6b. Roadmap Phases 2–7 (the big builds; see `ROADMAP.md` for full detail)
Dependency order: **P1 done → P2 before P3/P4/P5 → P7 underlies rooms/design deep-links.**

- **Phase 2 — Documents system** *(the unblocker; largest single build; good `/swarm` candidate)*: extend the `documents` schema for visibility (private-by-default) + associations + saved views (static/dynamic); a **reusable upload pipeline** (dropzone → metadata/type/tags/associations → OCR/VisionAI text → R2 → D1 keys → Vectorize embeddings); public `/docs` (public-marked, saved views, URL-persisted search, viewer) + `/admin/docs` (all docs, permissions, view builder with **amber exposure warnings**, edit). Visibility precedence: view overrides doc; warn on dynamic-without-`visibility:public` and static-with-private. Non-iframe-previewable files → download-only.
- **Phase 3 — Companies CRM**: `/admin/companies/[id]/{contacts,notes,todos,documents,permits,emails}`. Notes/todos in **PlateJS**; documents reuse Phase 2; **emails = Gmail integration** (service-account DWD; `gmail_threads`/`gmail_messages` D1 tables; body embeddings→Vectorize; reply-all send; UI via shadcn `sidebar-09`). Full spec: `specs/GMAIL_COMMS.md`. Large / OAuth-gated.
- **Phase 4 — Design**: `/admin/designs/moodboards/*` (Gemini reference-image flow, revisions, floor/room scoping), `/admin/designs/workshop` (nano-banana-spatial-design, plan 0014), `/admin/designs/decision-room` (room→materials→product), blank-canvas rebuild sub-routes, `builder`→`.../angles`, public `/planning/design-master-plan` (read-only render of decision-room + **contractor comments**). Moodboards are admin-only (surfaced to contractors only via design-master-plan).
- **Phase 5 — Brands / Products / Showroom sourcing**: consolidate `/admin/shopping/*`; e-commerce-style brand + product pages; brand↔product↔showroom associations; showroom sub-pages `/admin/shopping/showrooms/[id]/{products,brands,research,shopping-journal}`; RAG journal viewer. **Keep ALL showroom sub-pages** (sourcing/progress/scan/intake/schedule/compare/gaps/research). Showroom enrichment spec: `specs/SHOWROOM_ENRICHMENT.md` (crawl→AI-triage→full-page screenshot→CF-Images→extract contact/hours/socials/brands). ⚠️ `/admin/shopping` + brands is an area the user actively edits (his agy-ide agent) — coordinate; his WIP is snapshotted on `rescue/showroom-brands-wip`.
- **Phase 6 — Bids & Budget**: per-contractor phone-PIN bids (`/bid`, `/bid/[token]`), `/admin/bids` (from bid-portfolios), condense estimates into bids; budget namespace already moved (#59).
- **Phase 7 — Floor plan / rooms restructure**: `/floor-plan/floors/[id]/rooms/[id]` (the `home/floors` + `home/rooms` D1 tables already exist; `[id]` = auto-PKs reached via the floorplan visual), `kitchen-layout` → layouts.

### 6c. Workstream W0 — remaining uncommitted-work rescue
Everything is preserved on branch **`rescue/w0-uncommitted`** (pushed). Blank-canvas already restored (#57). Still to bring in (each its own reconciliation PR — 3-way onto current base, do NOT blind cherry-pick; several files overlap what Phase-1 rewrote):
- **ClickUp** task management (0009): `routes/clickup.ts`, `services/clickup-client.ts`, `components/clickup/`, `schema/scrum/`, `pages/admin/tasks.astro`. PMO is **ClickUp-backed, mirrored into our own D1** (ClickUp = fallback).
- **Admin Chat** (`AdminChatAgent/`, `RemodelOrchestrator/`, `AdminChatPanel.tsx`).
- **Saved image searches** (0010): `schema/images/saved_image_searches.ts`.
- **Blank-canvas serverless hardening** (Gemini flagged in #57, pre-existing): in-memory job `Map` → DO/queue; sequential AI generations in `waitUntil`; unbounded `arrayBuffer` buffering; slow `String.fromCharCode`/`btoa`; smoke-test `blank-canvas-generator.ts`'s `ai.interactions.create` path. Full inventory: `RECOVERY.md`.

---

## 7. Keeping the tracker & memory current

- **Tracker (`/admin/plans`)**: as you start/finish a task, `PATCH /api/admin/plans/tasks/:id` with `{status}` (`pending|in_progress|blocked|deferred|done`). Task keys are like `P2-DOC-03`, `W0-01`. The seed (`seed-plan-tasks.ts`) uses `onConflictDoNothing`, so re-seeding never overwrites live rows — status is edited via the API/UI, not the seed. ⚠️ These PATCHes need prod `remodel_access` auth; from a worktree you may not hold `WORKER_API_KEY`. If so, update status via the `/admin/plans` UI in a browser, or ask the user. (The previous session left P1-03 reorg + P6-03 budget to be advanced there.)
- **Persistent memory** lives at `/Users/126colby/.claude/projects/-Volumes-Projects-workers-core-remodel/memory/`. The roadmap state file is `site-roadmap-tracker.md` (indexed in `MEMORY.md`). After each merged PR, update it with what shipped + what's next, converting relative dates to absolute. Follow the one-fact-per-file + `MEMORY.md` pointer convention described there.

---

## 8. Locked conventions cheat-sheet (from OPEN_QUESTIONS, all user-approved)

- **Plural** collection routes (`showrooms`, `stores`, `brands`, `products`, `bids`, `companies`).
- Namespaces: `/admin/designs/*`, `/admin/prepare/*`, `/admin/pmo/*` (**Program Management Office**), `/admin/config/*` (all taxonomy/enums), `/admin/bids/*`, `/admin/budget/*`, `/admin/planning/*`. Public URLs stay at **root**.
- Hard-delete dead routes **but keep a tally** (`SITEMAP.md`) **and preserve the underlying data/features** for replanting.
- questionnaire → `/admin/planning/questionnaire` (move + keep). `kitchen-layout` → `/admin/designs/layouts/[id]`.
- `design-master-plan` = **public read-only** render of admin `decision-room` + contractor comments.
- Bid PIN = contractor **phone number**. Estimates list deleted; manual intake → `/admin/bids/new`.
- Floor/room `[id]` = auto-PKs reached via the floorplan visual (+ a `closets` "all closets on this floor" view).
- OCR = `@llamaindex/liteparse` + `@cf/meta/llama-3.2-11b-vision-instruct`; embeddings → existing Vectorize.

---

## 9. Recommended first increment for you

**Phase 2 (Documents system)** is the highest-leverage next move — it unblocks Phases 3/4/5 and is the kind of cross-stack build `/swarm` is built for (DB → API → frontend pipeline). If you'd rather warm up first, the deferred **`/specs/measurements` read-only view** (§6a #1) is a small, self-contained PR — but confirm with Justin that publishing measurements is intended before you expose them.

Whatever you pick: branch off fresh `origin/main`, keep the slice tight, run the loop in §4, and update the tracker + memory when it merges. Ship real, wired features — no mock data.

Good luck. — handoff from the Opus session, Phase 1 complete.
