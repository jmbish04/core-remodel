# 0016 — MCP Artifact Export ("Studio"): capture chat-built mini-apps onto the Worker

**Status:** PLAN — for review, to be executed in a FRESH session/worktree. No code yet.
**Author:** Claude (cloudflare-jedi + mcp-builder)
**Date:** 2026-07-08
**Builds on:** 0015 MCP server (`src/backend/mcp/*`, registry-driven tools). See `docs/0015_mcp_server/IMPLEMENTATION_PLAN.md`.

---

## 0. How to run this without colliding with the other active orchestration tree

You have a second orchestration tree in flight (the **worker-email-routing** build, which has **migration `0083` pending**). To avoid GitHub/worktree overlap:

1. **This plan is a doc only.** I'll push it on its own tiny branch (or you merge it) — it touches nothing but `docs/0016_mcp_artifacts/`, so it can't conflict with any code the other tree is writing.
2. **Execute in a brand-new session.** Each Claude session gets its own git worktree, so a new session is already isolated from the other tree's worktree. Start it **off the latest `origin/main`** and branch fresh (e.g. `claude/mcp-artifacts-0016`).
3. **Migration-number coordination (the real trap).** Drizzle numbers migrations sequentially. If the email tree hasn't merged its `0083` yet and this feature also generates `0083`, both merges collide. Rule: **run `pnpm run db:generate` only AFTER rebasing on the latest `main`** so this feature's migration lands as `0084+`. If both trees are mid-flight, merge email first, then rebase this branch and regenerate.
4. **DO migration tag: no new DO needed here (v1).** This feature is D1 + frontend + client-side rendering — it does NOT add a Durable Object, so it does NOT bump the DO migration tag (`v14` stays). That sidesteps the DO-tag-desync gotcha entirely. (If a later phase adds Worker-Loader server execution, that uses the EXISTING `LOADER` binding — still no new DO.)
5. **Deploy discipline unchanged:** Workers Builds does not run `migrate:remote`, so apply the D1 migration manually with `pnpm run migrate:remote` at ship time.

**Recommended handoff:** merge this plan doc to `main` (docs-only, zero collision), then the new session does `git pull` and reads `docs/0016_mcp_artifacts/IMPLEMENTATION_PLAN.md`.

---

## 1. Objective

Add an MCP capability so that during a chat, Claude can **export an artifact it built** — a report or a small interactive "mini-app" — onto the `core-remodel` Worker, where it is **stored, indexed, rendered, and reusable** long after the chat ends. Claude can also **list, view, and revise** previously-exported artifacts.

The pain being solved: great things get built organically in a chat, then die when the chat freezes. This makes them durable, first-class objects on the Worker.

**Hard constraint (non-negotiable):** artifacts are built from **shadcn/ui components** (our native library) and the configured shadcn **registries** — never bespoke Tailwind restyling, never hardcoded colors. Composition of shadcn components + Tailwind utilities for layout only, on the Monolith theme tokens.

---

## 2. Concept & user stories

- *As Justin, mid-conversation with Claude (via the MCP connector), I say "save this as an app I can use later."* Claude calls `create_artifact` with the component source; the tool returns a URL like `/admin/studio/<slug>`. The artifact now lives on the Worker.
- *Later, I open `/admin/studio`* and see a gallery of everything exported — reports, calculators, dashboards — each a card I can open and use.
- *In a new chat I say "pull up the closet-budget calculator and add a second closet."* Claude calls `list_artifacts` → `get_artifact` → `update_artifact` with revised source; a new version is stored, old versions retained.
- Artifact kinds: **report** (mostly data display), **app** (interactive), **dashboard** (charts). All rendered the same way; `kind` is a filter/label.

---

## 3. Current-state facts (grounding)

| Fact | Implication |
|---|---|
| shadcn components in `src/frontend/components/ui/*` (button, card, dialog, tabs, chart(recharts), badge, input, select, scroll-area, tooltip, …). `cn` in `src/frontend/lib/utils`. | These become the **allow-listed render scope** — the only components an artifact can import. |
| `components.json` registers 8 external registries (@bundui, @diceui, @spectrumui, …); iconLibrary `lucide`; style `base-nova`; CSS vars on. | "Other shadcn registries" is real. v1 exposes installed components; pulling registry components on demand is a Phase-3 note. |
| **No in-browser transpile / react-live infra exists.** | The renderer is net-new — the central build item. |
| `LOADER` (Worker Loader) binding declared in `wrangler.jsonc` but **unused** anywhere in `src`. | Available for optional server-side artifact execution later; not needed for UI rendering. |
| Frontend = Astro SSR + React islands; dark Monolith; admin nav via `src/frontend/components/sidebar/nav-groups.ts`; admin pages under `src/frontend/pages/admin/*`. | The gallery + viewer follow this exact pattern; add a nav-group entry. |
| MCP tools are registry-driven: add a `defineTool` to `src/backend/mcp/tools/*.ts` → auto-exposed on `/mcp`, `/api/mcp`, `/api/mcp-docs`, `/connect/tools`. | Artifact tools are just a new `tools/artifacts.ts` file. |
| D1 + Drizzle; migrations via `pnpm run db:generate` → `migrate:remote`; **never import drizzle-zod** (breaks build). | New tables in `src/backend/db/schema/artifacts/`; hand-written Zod in the MCP tool. |

---

## 4. Architecture

```
claude.ai chat ──(MCP: create_artifact/update_artifact)──► /mcp
                                                             │ store TSX + metadata
                                                             ▼
                                                       D1: artifacts + artifact_revisions
                                                             │
        /admin/studio (gallery, Astro+shadcn) ◄─── GET /api/artifacts ───┐
        /admin/studio/[slug] (viewer)                                    │
              └─ <iframe src="/studio-runtime?id=…"> ───────────────────┘
                         │  (isolated origin-less sandbox)
                         ▼
              STUDIO RUNTIME (dedicated React island bundle)
               - fetches artifact source
               - transpiles TSX in-browser (sucrase)
               - executes against a FIXED shadcn scope map
               - renders the default-exported component
```

### 4.1 The renderer (the hard part) — **recommended: sandboxed in-browser runtime**

An artifact is a **single TSX module that `export default`s a React component** and may only import from an **allow-listed scope** (shadcn ui components, `cn`, `react`, `recharts`, `lucide-react`, a small `@/studio/data` fetch helper). Rendering:

1. A dedicated route **`/studio-runtime`** serves a minimal React app (its own Astro page + island) that **bundles the entire allowed scope** (all shadcn ui components + recharts + lucide + React). This is the only place the scope is bundled.
2. `/admin/studio/[slug]` embeds `/studio-runtime?id=<id>` in a **sandboxed `<iframe>`** (`sandbox="allow-scripts"`). This isolates artifact code from the admin session/cookies and contains the eval.
3. Inside the runtime: fetch the artifact source → **transpile TSX→JS with `sucrase`** (tiny, fast, browser-friendly; no `@babel/standalone` bloat) → execute via a scoped module loader that maps each `import` specifier to the bundled scope. **Unknown specifiers throw** — this is what enforces "shadcn only."
4. The Monolith theme CSS is loaded in the runtime so shadcn components look native.

**Why in-browser + iframe, not Worker Loader:** artifacts are *interactive React UI for the browser*. Worker Loader runs server-side JS isolates — great for a dynamic backend function, wrong tool for rendering hydrated shadcn UI with our Tailwind theme. The iframe+sucrase+scope pattern is the standard "generative UI" approach and gives real interactivity with guaranteed-native components.

**CSP note:** in-browser transpile+execute needs `script-src 'unsafe-eval'` **in the runtime route only** (scoped via the iframe), not the whole app. The iframe sandbox keeps eval contained.

**Simpler fallback (if we want to de-risk v1):** support only **report/dashboard** artifacts rendered **server-side** (the runtime `renderToString`s the component to static HTML; charts as static SVG). Loses interactivity but avoids client eval. Recommendation: build the interactive runtime — it's the feature's whole point — but ship reports first if time-boxed.

### 4.2 Storage / data model

`src/backend/db/schema/artifacts/`:

- **`artifacts`** — `id`, `slug` (unique), `title`, `description`, `kind` ("report"|"app"|"dashboard"), `status` ("draft"|"published"|"archived"), `currentRevisionId`, `sourceConversation` (text — the note/summary of where it came from), `createdAt`, `updatedAt` (`(unixepoch())` seconds).
- **`artifact_revisions`** — `id`, `artifactId` (FK), `revisionNumber`, `sourceTsx` (TEXT — the component code), `entryExport` (default "default"), `importsJson` (TEXT — declared allow-listed specifiers, for validation + docs), `changeNote`, `createdAt`. Immutable chain (mirrors the budget-item revision pattern). Update = new revision + bump `artifacts.currentRevisionId`.
- Code stored in D1 TEXT (artifacts are small). If one exceeds a sane cap (e.g. 64 KB), store in **R2** (`ARTIFACTS_BUCKET` already exists) and keep a pointer. v1: D1 TEXT with a size guard.

### 4.3 Hono API (for the frontend)

- `GET /api/artifacts` — list (id, slug, title, kind, status, updatedAt). Admin-gated.
- `GET /api/artifacts/:slug` — full metadata + current revision source (used by the runtime + viewer). The **runtime fetch** may need to be reachable from the sandboxed iframe — serve the source via a dedicated `GET /api/artifacts/:slug/source` returning the raw TSX.
- Admin mutations (rename/publish/archive/delete) — `requireAccessAuth`.

---

## 5. Enforcing "always shadcn, never bespoke Tailwind"

Two layers — **hard** (mechanical) + **soft** (contract/lint):

- **Hard — import allowlist.** The runtime's module resolver only resolves specifiers in the scope map (`@/components/ui/*`, `react`, `recharts`, `lucide-react`, `@/lib/utils`, `@/studio/data`). Any other import throws at both **submit-time validation** (static parse of import statements in `create_artifact`) and **render-time**. Claude physically cannot pull in a non-shadcn UI lib.
- **Soft — style rules in the tool contract + a lightweight linter** run on submit:
  - Ban inline `style={{…}}` and `<style>` blocks (reject).
  - Ban hardcoded color utilities (`bg-[#…]`, `text-red-500`, arbitrary color values) — require theme tokens (`bg-card`, `text-muted-foreground`, `bg-primary`, etc.). Regex-flag and reject with an actionable message.
  - Require that interactive/structural UI use shadcn components (heuristic: flag raw `<button>`/`<input>`/`<select>` → tell Claude to use `<Button>`/`<Input>`/`<Select>`). `<div>` for layout is allowed (Tailwind fl*layout* utilities only: grid/flex/gap/spacing).
- **`list_allowed_components` MCP tool** returns the live scope catalog (component names + their import specifiers + a one-line usage hint) so Claude writes valid, in-scope code from the start. Grounds generation → fewer rejects.

---

## 6. MCP tools (new `src/backend/mcp/tools/artifacts.ts`, category `"artifacts"`)

| Tool | Ann | Purpose |
|---|---|---|
| `list_allowed_components` | R | The scope catalog: every shadcn component (+ import specifier + hint) and the sanctioned libs an artifact may use. Call this BEFORE writing an artifact. |
| `create_artifact` | W | Submit a new artifact: `title`, `description`, `kind`, `sourceTsx` (default-exports a React component), optional `sourceConversation` note. Validates imports against the allowlist + style rules; on pass, stores rev 1, returns `{ id, slug, url }`. On fail, returns actionable errors so Claude can fix and resubmit. |
| `list_artifacts` | R | What's been exported (id, slug, title, kind, status, updatedAt, revisionCount). So Claude can see prior work. |
| `get_artifact` | R | Full metadata + current `sourceTsx` (so Claude can revise). Optional `revision` to fetch an old version. |
| `update_artifact` | W | New revision of an existing artifact (revised `sourceTsx` + `changeNote`). Re-validates. Bumps `currentRevisionId`. |
| `set_artifact_status` | W | publish / archive (soft-hide from the gallery). |

All follow the 0015 `defineTool` contract (hand-written Zod v4, annotations, examples, money-n/a). `create_artifact`/`update_artifact` are the interesting ones — validation is the bulk of the logic.

---

## 7. Frontend — "Studio" section

- **Nav:** add a "Studio" (or "Apps") group/item to `src/frontend/components/sidebar/nav-groups.ts` (admin side).
- **`/admin/studio`** — gallery: shadcn `Card` grid, filter by `kind`, search, status badges, "opened N times" (optional usage counter). Empty/loading/error states. Real data from `GET /api/artifacts`.
- **`/admin/studio/[slug]`** — viewer: the sandboxed runtime iframe (the running artifact) + a side panel with title/description/kind, a **revision dropdown**, a "View source" sheet (read-only TSX), and admin actions (rename, publish/archive, delete via shadcn `AlertDialog` — never `window.confirm`).
- **`/studio-runtime`** — the isolated runtime page (bundles scope + sucrase); not linked in nav; only embedded via iframe.
- Monolith dark, no traditional borders (ring/divide), mobile-responsive, `<Navbar/>`, errors through the global `ErrorLogger`.

Because these pages have real UX, executing this plan should run the stitch/UX-confirmation flow (cloudflare-jedi Q2=YES) in the new session.

---

## 8. Worker Loader — deferred, optional (Phase 3)

For an artifact that needs a **dynamic server function** (e.g., a report that queries D1 with custom logic, or an endpoint the mini-app calls), the existing `LOADER` binding can spin up an ephemeral Worker isolate from stored code at request time. This is powerful but a separate, harder trust/security surface (server-side code execution). **Not in v1.** Documented as the growth path for "artifacts with a backend."

---

## 9. Security / trust model

Single operator (Justin), and he's the one asking Claude to build these — so the trust bar is "protect Justin from footguns," not "run hostile code." Still:
- Artifact code runs in a **sandboxed iframe** (`allow-scripts`, no same-origin) → no access to the admin cookie/session or the parent DOM.
- Import allowlist → no network/module escape; `@/studio/data` is a thin, read-scoped fetch helper (initially read-only, calling existing `/api/*` GETs with the session — reconsider before allowing writes from artifacts).
- Submit validation rejects `eval`, `fetch` to arbitrary hosts, `<script>`, inline handlers beyond React props.
- All artifact routes admin-gated (`requireAccessAuth` / the `/admin` cookie gate).

---

## 10. Phased plan

**Phase 1 — storage + tools (no UI yet).**
1. `artifacts` + `artifact_revisions` schema; `db:generate` (AFTER rebasing on main — §0.3); `migrate:remote` at ship.
2. `tools/artifacts.ts`: `list_allowed_components`, `create_artifact` (+ validator), `list_artifacts`, `get_artifact`, `update_artifact`, `set_artifact_status`. Register in `tools/index.ts`.
3. `GET /api/artifacts*` Hono routes.
4. Verify via MCP Inspector / bearer: create → list → get → update round-trips; validator rejects non-shadcn imports + hardcoded colors.

**Phase 2 — the renderer + Studio UI.**
5. `/studio-runtime` island: sucrase transpile + scope map + scoped module loader + error boundary.
6. `/admin/studio` gallery + `/admin/studio/[slug]` viewer (iframe embed, revision dropdown, source sheet, admin actions).
7. nav-groups entry. Stitch/UX pass for the two pages.
8. End-to-end: export a real artifact from a claude.ai chat → open it in Studio → interact → revise from chat → see v2.

**Phase 3 — polish / growth.**
9. Usage counter, "duplicate", export-to-file. On-demand shadcn **registry** component fetch (from `components.json` registries). Worker-Loader backend functions. `/context` + docs page updates (`/connect/tools` auto-updates already).

Each phase: `pnpm run build` + `tsc --noEmit` on changed files + Inspector smoke. Update `AGENTS.md` (the MCP section already instructs registry + docs upkeep; add a short "artifacts" note).

---

## 11. Open questions (confirm in the new session)

1. **Route + gating:** `/admin/studio` (admin-gated, recommended — personal tools) vs a public `/apps`? Name: "Studio" vs "Apps" vs "Exports"?
2. **Renderer scope for v1:** interactive iframe+sucrase runtime (recommended — it's the point) vs reports-only server-rendered HTML first?
3. **Can artifacts WRITE data** (call mutating `/api/*` or MCP-backed actions), or read-only in v1? (Recommend read-only first; writes are a bigger trust step.)
4. **Registry breadth:** expose only currently-installed shadcn components in v1 (recommended), or wire on-demand pulls from the configured registries now?
5. **`sourceConversation` capture:** just a freeform note Claude passes, or do you want a structured transcript/summary field? (Recommend freeform note v1.)

---

## 12. Rough size

Phase 1 ≈ 1 schema migration + 1 tool file + 1 route file (~a day). Phase 2 ≈ the runtime + 2 pages + nav (~2–3 days, the runtime is the risk). Phase 3 open-ended. No new Durable Object; one D1 migration; reuses `ARTIFACTS_BUCKET` and `LOADER` only if/when needed.
