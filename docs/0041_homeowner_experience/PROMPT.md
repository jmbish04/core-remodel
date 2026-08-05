# 0041 · PROMPT — Homeowner Experience

Copy-paste this to the coding agent that builds it.

---

You are building the public homeowner experience for **Core Remodel**, a Cloudflare Worker running a real renovation. Read these first, in order:

1. `CLAUDE.md` — project law. Non-optional.
2. `PRODUCT.md` — product truth.
3. `docs/0041_homeowner_experience/IMPLEMENTATION_PLAN.md`
4. `docs/0041_homeowner_experience/DESIGN_SPEC.md`
5. `docs/0041_homeowner_experience/TASKS.json`

**Before you read any source file**, run `pnpm run worktree:check` and confirm 0 commits behind `origin/main`. A stale checkout manufactures confident wrong analysis.

---

## What you are building

A net-new public homeowner product **alongside** the existing 140 `/admin/*` pages. Six destinations in v1: **Home · Vision · Rooms · Out There · Money · Needs You**. Build is deferred.

The governing idea: **the adversary is drift, not the contractor.** Ambiguity is the exploit surface; specification removes it. Every screen must let a homeowner answer *where am I, what changed, what needs me next.*

The visual direction: **Diagram outside, Atelier inside.** Transit-wayfinding grammar carries orientation and nothing else. Vision, Out There, and the entry to every Room are warm, image-rich, and tactile. If the whole product feels like infrastructure, you have built the wrong thing.

## What you must not touch

- Any existing `/admin/*` page.
- `src/frontend/components/sidebar/nav-groups.ts`.
- The current dark admin theme.

## Hard constraints — these are project law, not preferences

- **Stack:** one Cloudflare Worker. Astro SSR + React islands, Hono + `@hono/zod-openapi`, Drizzle on D1. **Not** Next.js, **not** Prisma.
- **shadcn here wraps Base UI, not Radix.** `render={<a/>}`, never `asChild`. `Badge` has no `size` prop. Run `shadcn add --dry-run` first, every time; never `--overwrite`.
- **D1 has no transactions.** `db.batch()`, never `db.transaction()`.
- **D1 caps a statement at 100 bound parameters.** Chunk multi-row inserts and `inArray()` at 20 whenever the list length is not yours to control.
- **Foreign keys, never denormalized `*_name` columns.** Join for the display name.
- **Currency: store both** `<field>_text` (verbatim) and `<field>_cents` (integer). Use `<CurrencyInput>`. Never a bare number, never a bare `<Input>` for money.
- **Rich text: store both** `<field>_markdown` and `<field>_html`. Use the PlateJS editor. Never a bare `<textarea>` for a note.
- **Multi-selects are definition + mapping tables.** Never a delimited string, never a JSON blob. Style axes, profiles, spec vocabularies, and colors all follow this.
- **AI calls use structured output with an explicit JSON schema**, return primary keys rather than display names, validate returned ids against the live set before inserting, and never degrade a failed parse to `{}` silently.
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:remote`. Never raw SQL, never hand-edit a migration.
- **Astro shells use `class`, never `className`.** A `className` on a native element in a `.astro` file silently does nothing.

## Build order

Strict. Do not start a phase before its dependencies land.

| Phase | Deliverable |
|---|---|
| **0** | 140-page triage with owner + reason per page; project type; room line identity + stop state; spec fields; the decision graph; impact definitions + impacts + targets + blocking; `roomReadiness()`; `nodeHealth()` |
| **1** | Shell with six destinations; the Diagram component; one Needs You queue behind landing + shell counter |
| **2** | Vision — profiles, axes, non-negotiables, partner alignment, divergence detection |
| **3** | Rooms — atelier entry, persistent diagram orientation, in-place spec work, the enforced threshold, the reopened-decision marker |
| **4** | Out There — capture → enrich → propose → human commit; the interchange |
| **5** | Money — budget, commitments, exposure, bids, soft landing |
| **6** | The living graph — impact surfaces, blocking semantics, derived health with blast radius, traversable history |
| **7** | Conversational capture — `assistant-ui` thread, voice transcription, generative-UI confirmation, MCP parity |
| **8** | Forecasting & locality — evidence-gated alarms with pre-staged mitigations, the watch list, permit integration, AI locality research |

**Phase 3 is make-or-break.** Give it the most room. If the room workspace does not simultaneously feel like the homeowner's future home and tell them exactly where the room stands, nothing else in this plan matters.

## The two rules that must not be duplicated

1. **`roomReadiness(roomId)`** — one server-side resolver. The translation-ready badge, the drawn threshold, and any future contractor gate all call it. A room with a null required spec field must never report ready; write a direct check for exactly that.
2. **`nodeHealth(kind, id)`** — one server-side resolver. Health is **derived from open impacts and their blocking graph, never stored**. Every badge, every highlighted blast radius, and every forecast reads from it.

## The impact model

Ripples, tariffs, a lost subcontractor, a code change before filing, asbestos in demo, PG&E scheduling, weather — all the same object. **An Impact**, typed from `impact_definitions`, attached to any number of targets through `impact_targets`, able to block other impacts through `impact_blocks`. Bug-tracker semantics.

- `impact_definitions.risk_inputs` declares which fields on an impact feed its risk score, so **a new impact type is configuration, not a migration.** Do not hardcode an impact enum.
- `impact_targets.target_kind` reaches rooms, decisions, budget lines, permits, deliveries, contractors, and the project itself.
- Every impact carries `source` (rule · agent · conversation · contractor · homeowner · integration) and full provenance. Provenance is not optional here.

## No unattributed regression

**A room's stop never retreats.** Work reached is never erased. When something upstream invalidates a settled decision, the room keeps its stop and gains a separate, attributable reopened marker. The cause is always another decision or an impact — never a person.

This is the most important behavioral rule in the plan. Getting it wrong is what makes a homeowner feel they lost two months, and it is where real projects and real partnerships break.

## Forecasting bar

Two tiers, hard-separated, never blended.

- **Alarm:** must name its trigger, its evidence, and a mitigation that is already started. **Without evidence it does not render.**
- **Watch list:** known category risks, visibly labeled as what to expect, never as a prediction about this project.

Crying wolf destroys the trust the feature exists to build. Locality intelligence renders as a range with its source, never as a confident date.

## Behavioral rules

- **Agents propose; people own commitments.** Every agent write lands as a proposal with its reasoning visible. Human confirmation is required for money, scope, access, irreversible changes, and anything sent outside the household.
- **Ambiguity is a first-class state.** `known` · `assumed` · `range` · `unknown` render as themselves. False precision is the failure mode.
- **Park before committing.** Capturing must never require deciding. A parked find keeps why it mattered.
- **Preserve disagreement.** Store per-partner axis scores alongside the household synthesis. Never average two people into one preference.
- **Soft landing.** When a constraint kills the preferred option, preserve the governing intent, generate at least one alternative that honors it differently, show consequences, and let the homeowner choose. Never substitute the cheap default.
- **Provenance on everything.** Who supplied a measurement, price, recommendation, or approval, and when.

## Per-PR obligations

1. Check for concurrent work before opening: `git worktree list`, `git fetch origin`, `gh pr list --limit 20`. Overlapping edits to one file across two sessions is the most expensive failure mode in this repo.
2. Update `plan_tasks` as you go via `update_plan_task` — `in_progress` when you start, `in_review` + PR number when you open, `done` + PR number when it merges. The preview changelog board updates live for the user; a `pending` row after merged work is a lie.
3. Write `scripts/qc/pr_<n>.mjs` using the shared helpers. Run it against **both** `--preview` and production. Paste real output into the PR and the changelog entry — never paraphrase results.
4. Schema change → `pnpm run migrate:remote` and verify the column exists on remote before merging.
5. Add a changelog branch row, entry, `PhaseDetail` with Mermaid `diagrams[]`, and a `verification` block. Link it in the PR description as `Changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/<slug>`.
6. Read the AI review bot's comments and engage with each one — fix, or reply why it does not apply. Never blanket-accept, never blanket-ignore.
7. After merging to `main`: run `pnpm run deploy` or the **Deploy (manual)** GitHub Action. Nothing deploys itself. Then `pnpm run preview:delete` from the branch's worktree.

## Ask, do not invent

Product name · pricing and paywall boundaries · tenant/account and partner co-ownership model · contractor auth vs. token links · whether the trade-ready vendor package belongs in v1. If a decision is not in the plan, surface it. Do not guess and write.
