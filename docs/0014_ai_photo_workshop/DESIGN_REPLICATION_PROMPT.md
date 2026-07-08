# Design-Replication Prompt Generator — AI Photo Design Workshop (0014)

> **How to use:** Run this in a session with access to the repo (ideally with the app running). Its job is **not** to redesign anything itself — it is to **study the workspace as it currently exists and author a paste-ready prompt for the Claude AI design agent** (claude.ai artifacts / Stitch / a visual design conversation). That generated prompt instructs the design agent to first **faithfully replicate the current UI** — so the user starts from an accurate baseline — and then **conversationally improve it**, seeded with the exploration ideas this agent supplies.
>
> Think of it as: *observe reality → write the design agent's brief so it can rebuild reality → hand the user a menu of directions to push it further.*

---

## Mission

Produce a single deliverable: **`docs/0014_ai_photo_workshop/DESIGN_AGENT_PROMPT.md`** — a self-contained prompt for the Claude AI design agent. To write it well, first **evaluate the actual workspace** (running app + source), then translate what you observe into a design brief the design agent can execute without repo access.

**Read for context (intended design language):**
- `docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md` — §7 design brief, §8 component kit, the Ann-Sacks workstation north star.
- `docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md` — the component kit (piles, drawer, inspiration browsing, ambient waits, 3D viewer).
- The `taste-design` skill — the **Monolith** design system (dark, ring/divide, OKLCH charts, anti-slop bans). Load it.

---

## Step 1 — Evaluate the workspace (capture reality, don't guess)

Investigate the **as-built** Workshop and the surrounding app so the replica is accurate:
- **Screens & routes:** the workshop at `/admin/design/workshop` and its neighbors; walk them in a running preview and capture the real layout. Use `/sitemap` for the full route map.
- **Component inventory:** which shadcn + kit components are actually rendered (canvas shell, piles/Layered Stack, Sample Library drawer, inspector, tools palette, recipe menus, ambient waiting states). Note the real DOM structure and where each lives (`src/frontend/components/...`).
- **Design tokens (from source, not eyeballed):** pull the actual colors, typography, radii, spacing, and ring/border treatment from `globals.css` / the Tailwind theme / `taste-design` Monolith values — so the replica matches exactly.
- **States:** empty / loading / error / populated for the key surfaces; the real microcopy/voice in use.
- **Flows:** the true end-to-end path (floor plan → room → canvas → pile → clipping → mix → revision), including what's currently missing or stubbed.
- Prefer **evidence over assumption** — if a screen isn't built yet, note it as "not yet present; describe intended per plan §7" rather than inventing it.

Optionally capture screenshots/inspect output to embed as reference in the generated prompt.

## Step 2 — Author `DESIGN_AGENT_PROMPT.md` (the prompt for the Claude design agent)

Write a **paste-ready, self-contained** prompt (the design agent has **no repo access**, so include everything it needs). It must contain:

1. **What we're building** — one tight paragraph: the Ann-Sacks "sample table" Workshop; the mental model (*the room is the model, the design is the outfit*); who it's for (a single technical homeowner mid-remodel).
2. **Replicate-first instruction** — the design agent's **first task is to reproduce the current UI as an interactive artifact** (React/HTML mockup) at high fidelity: the exact screens, layout, component structure, and states you captured in Step 1. Baseline parity before any change.
3. **The Monolith design system, inlined** — the concrete tokens (near-black canvas `hsl(240 10% 4%)` never `#000`, off-white foreground, `bg-card` elevation, **no 1px borders → ring-1/divide-y**, `Inter font-semibold tracking-tight`, `JetBrains Mono` + tabular numerals, spring motion, `prefers-reduced-motion`) and the **anti-slop bans** (no neon/purple glows, no AI gradients, no gradient headlines, no centered hero, no circular spinners, no fake metrics, no "Elevate/Seamless/Unleash" copy). Paste real values, not "see the skill."
4. **Screen-by-screen spec** — for each surface (workshop canvas, room-scoped viewport, piles rail, Sample Library drawer, recipe menu, compare view, waiting states): layout, key components, copy voice, and all four states.
5. **Component-kit palette** — summarize §8 roles (piles/stacks, drawer, inspiration browsing, ambient waits, 3D viewer) so the design agent knows the vocabulary of moves available, with the Monolith taming rule for the flashy ones.
6. **Interaction contract** — infinite canvas (pan/zoom/nodes), drag-to-pile + hover-to-fan, extract-a-clipping, run-a-recipe→child-node-with-lineage, live status (never a spinner).
7. **Conversation kickoff** — end by inviting the user to iterate: "Here's your workshop as it stands — what should we change?" so it flips straight into a design dialogue.

## Step 3 — Seed the design agent with exploration ideas

Inside the generated prompt, add a **"Directions to explore with the user"** section — a menu of concrete, opinionated ideas the design agent can offer (each as *why it helps + a light sketch*), grounded in the workshop vision. Draw from and expand on these; add your own from what you observed:
- **The "table feel"** — make the canvas read as a physical worktable (surface texture, subtle depth, samples that cast a soft shadow when lifted) without breaking Monolith calm.
- **Piles as physical stacks** — spring/fan physics, an "unsorted" catch-pile, quick-rename on hover, drag-between-piles affordances (`Stack` vs `Layered Stack` vs `Orbit Card Stack` trade-offs from §8).
- **The drawer** — how the Sample Library opens (slide-out vs. bento wall), clipping cards with provenance ("cut from inspo #12"), and reuse-across-rooms.
- **Waiting states as delight** — which ambient §8 animation fits which recipe, kept dark/subtle; progress narrated as *promises kept* ("keeping your windows exactly where they are…").
- **Before/after & lineage** — reveal-slider ergonomics, the revision tree as a visible "family tree" of a design, encouraging cheap branching.
- **Recipe discoverability** — verbs-not-jargon naming, gating cards to what a node supports, real before/after previews on hover.
- **Momentum & focus** — reducing chrome so the room's image is the hero; asymmetric editorial framing over dashboards.
- **Onboarding a blank room** — the empty-state that invites the first artifact without feeling empty.

Frame these as **options to discuss, not decisions** — the point is to give the user rich starting points for the conversation.

---

## Output

- Write **`docs/0014_ai_photo_workshop/DESIGN_AGENT_PROMPT.md`** (the deliverable) and print, in your final message, both a short summary of what you observed in Step 1 and the location of the generated prompt.
- Keep the generated prompt fully self-contained (design agent has no repo access) and Monolith-accurate.

---

## STARTER PROMPT (paste this into the new session to begin)

```
Study the current core-remodel Design Workshop and write a prompt for the Claude AI design agent that
(a) replicates the app exactly as it exists today, then (b) invites the user to improve it in conversation.

Read, for context:
1. docs/0014_ai_photo_workshop/DESIGN_REPLICATION_PROMPT.md   (your brief — follow it exactly)
2. docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md       (§7 design brief, §8 component kit)
3. docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md         (the component kit)
Load the taste-design skill for the Monolith design system, and inline its real token values.

Step 1: Evaluate the as-built workspace — walk the running app (use /sitemap), inventory the real screens,
components, design tokens (from globals.css / theme, not eyeballed), states, copy, and flows. Capture reality;
mark anything not-yet-built as intended-per-plan rather than inventing it.

Step 2: Author docs/0014_ai_photo_workshop/DESIGN_AGENT_PROMPT.md — a paste-ready, fully self-contained prompt
(the design agent has NO repo access) that instructs the Claude design agent to first reproduce the current UI as a
high-fidelity interactive artifact, using the inlined Monolith system, with a screen-by-screen spec and all states.

Step 3: Inside that prompt, add a "Directions to explore with the user" section — concrete, opinionated ideas
(table feel, piles physics, the drawer, waiting-state delight, lineage/branching, recipe discoverability, momentum)
framed as options to discuss, not decisions.

Do not redesign anything yourself. Output the generated prompt file + a summary of what you observed.
```
