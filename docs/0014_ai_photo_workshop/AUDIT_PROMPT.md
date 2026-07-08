# Post-Build Audit Prompt — AI Photo Design Workshop (0014)

> **How to use:** Run this in a **fresh session** *after* the workshop (Slice 1) has been implemented. Its only job is to **evaluate the installation and report a full audit** — so we know exactly what landed, what's partial, what's missing/broken, and what fill-in work is needed. **This is read-only/evaluative: do NOT fix, refactor, or build anything. Audit and report only.**

---

## Mission

Evaluate the as-built **AI Photo Design Workshop** against its plan and report a complete, honest audit. Verify against the source **code and running app**, not against the commit messages or the PR description — those over-report completion. Where something is claimed done but isn't wired, say so plainly.

**Read these to establish the intended target:**
1. `docs/0014_ai_photo_workshop/FABLE_PROMPT.md` — the build brief + Slice 1 scope + hard constraints.
2. `docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md` — the full plan (front door, §7 design brief, §8 component kit, critical files, verification, locked decisions).
3. `docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md` — the component kit that was supposed to make it "pop" (§8 mapping).
4. `docs/0004_ai_image_editing/{IMPLEMENTATION_PLAN.md,PROMPT.md}` — the render pipeline it builds on + non-negotiable constraints.

---

## What to audit (grounded in the plan)

For **each area below**, determine status — **Built / Partial / Missing / Broken / Deviates** — with concrete evidence (file paths, line refs, route paths, table names, screenshots or command output). Note anything the build *added beyond* the plan too.

### A. Slice 1 feature completeness
1. **Canvas shell** — is `devl.dev` canvas-tools installed and hosted at `src/frontend/pages/admin/design/workshop.astro` as a `client:only` island? Pan/zoom/drag/select/inspector/layers/keyboard-shortcuts working? Collab bar removed? Missing primitives (`avatar`, `slider`, `tooltip`) added and `@orbit/ui/*` imports remapped to `@/components/ui/*`?
2. **Image nodes** — is there an `image` node type backed by a Cloudflare Images URL, rendered via `konva`/`react-konva`? Does the board seed from a room's real artifacts via a room context resolver?
3. **Persistence** — nodes + canvas position + lineage persisted to D1? Confirm `render_canvases` (`parentCanvasId` tree) is reused and a `board_nodes` position layer exists. Does state survive reload / multi-session (come-and-go)?
4. **Piles v1** — `Layered Stack` (Componentry, `gsap`) integrated? `photo_collections` + `photo_collection_items` tables created and migrated? Drag-to-pile, hover-to-fan, click-photo→pick-tool working? Naming optional at creation?
5. **Sample Library v1 (the "drawer")** — clipping extraction via `InspirationCanvas` bbox + `stage_0_IP_extraction` + CF Images crop → saved reusable clipping node? Drawer UI present?
6. **3 core recipes as node actions** — `extract`, `material-swap`, `mix` (`stage_5_LP_synthesis`) present as node context-menu actions? Each output a **child node with a lineage edge**? Live status streamed via the realtime socket + `PipelineStatusLoader` (no spinner)?

### B. Hard-constraint compliance (flag every violation)
- **Zod v4** on all new routes; routes registered in the API barrel + on the OpenAPI doc.
- **Drizzle only, no hand-SQL**; migrations generated via `pnpm run db:generate`; **`db.batch` used (no `db.transaction`)**.
- **Every image-model call routes through AI Gateway via `model-registry`** — grep for raw `fal.run` / `api.replicate.com` (should be none). Default Gemini 3 Pro for structure-critical stages.
- **CF Images** for storage; crop via CF Images transforms (**no `sharp`/libvips** import anywhere); **delivery URLs passed to models, not base64**; `image_config {aspect_ratio,image_size}` pinned from source dims; `crypto.randomUUID()` (no `crypto` import).
- **Fidelity:** `PRESERVATION_BLOCK` included on structure-lock recipes; references scoped material/form-only; `prompt-kit.ts` reused.
- **Reuse check:** did it reuse the existing `render/` services & components (`stage-runner`, `failover`, `StudioBuilder`, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`) or duplicate them?

### C. Design system & component kit (§8 + taste-design)
- **Monolith compliance:** near-black canvas (never `#000`); **no traditional 1px borders** (ring/divide only); `Inter font-semibold tracking-tight`; `JetBrains Mono` + tabular numerals; `prefers-reduced-motion` respected. Flag anti-slop violations (neon/purple glows, AI gradients, gradient headlines, centered hero, circular spinners, fake metrics, "Elevate/Seamless/Unleash" copy).
- **Component kit usage:** which `ANIMATION_COMPONENTS.md` components were actually pulled in, for which role (piles, drawer, inspiration browsing, waiting-state ambience, 3D viewer)? Were the flashy WebGL pieces (Lightning/LaserFlow/LightRays) **tamed to subtle/dark** and heavy libs (`three`/`ogl`) lazy-loaded? Note kit items the plan called for that were skipped.
- **PlateJS** used for prompt authoring; **reference cap = 10** enforced.

### D. Health / correctness
- `pnpm run build` (esbuild) passes; `tsc --noEmit` on changed files (note new type errors vs. the ~171 baseline).
- Migrations apply cleanly (`pnpm run migrate:local`); schema exported from the barrel.
- Run the app / preview and walk the end-to-end flow (plan §Verification): room artifacts load as nodes → form a pile → fan out → extract a clipping to the drawer → run `mix` → child node appears with lineage + live status. Note console/network errors.
- Floating promises, missing error handling, N+1 D1 reads, unbounded image loads, missing `client:only` on canvas islands, secrets in client code.

---

## Method

- **Read-only.** Investigate with search + file reads + running the app/preview + inspecting the D1 schema and routes (`/openapi.json`, `/sitemap`). Do not edit code (other than writing the report file). Run build/typecheck/tests to observe, not to fix.
- Base every finding on evidence you actually saw. If you couldn't verify something, mark it **Unverified** and say why — never assume it works.

---

## Output — the audit report

Write findings to `docs/0014_ai_photo_workshop/AUDIT_FINDINGS.md` **and** summarize in your final message. Structure:

1. **Verdict** — one line: is Slice 1 shippable as-is, or does it need fill-ins first?
2. **Scorecard table** — every area A1–D above with Status (Built / Partial / Missing / Broken / Deviates / Unverified) + one-line evidence.
3. **Fill-in backlog** — the concrete follow-up work, each item ranked **P0 (blocks the slice) / P1 (should fix before fan-out) / P2 (polish)**, with the file(s) to touch and why.
4. **Constraint violations** — any hard-constraint breach (its own list; these are always at least P1).
5. **Deviations & bonus** — where the build diverged from the plan (good or bad) and anything added beyond scope.
6. **Ready-for-Slice-2?** — a yes/no gate with the blocking items called out.

Keep it scannable but specific — file paths and line refs, not vibes.

---

## STARTER PROMPT (paste this into the new session to begin)

```
Audit the AI Photo Design Workshop that was just built. This is a READ-ONLY evaluation — do not fix or build anything.

Read, as the intended target:
1. docs/0014_ai_photo_workshop/AUDIT_PROMPT.md   (your audit brief — follow it exactly)
2. docs/0014_ai_photo_workshop/FABLE_PROMPT.md   (what was supposed to be built — Slice 1 scope + constraints)
3. docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md   (the full plan)
4. docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md   (the component kit that was meant to make it pop)

Evaluate the as-built code and the running app against the plan (areas A–D in AUDIT_PROMPT.md).
Verify against actual source + a running preview, not the PR description. Run pnpm run build and tsc --noEmit
on changed files to observe health. Mark anything you can't confirm as Unverified.

Produce a full audit: write it to docs/0014_ai_photo_workshop/AUDIT_FINDINGS.md and summarize in your final message,
using the report structure in AUDIT_PROMPT.md (verdict, scorecard, ranked fill-in backlog, constraint violations,
deviations, ready-for-Slice-2 gate). Do not change any code.
```
