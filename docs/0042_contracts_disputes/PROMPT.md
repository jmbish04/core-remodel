# 0042 · PROMPT — Contract Intelligence & Disputes

Read first, in order:

1. `CLAUDE.md` — project law.
2. `PRODUCT.md` — product truth. **Principle 7 governs this entire feature.**
3. `docs/0041_homeowner_experience/IMPLEMENTATION_PLAN.md` — this builds on its impact graph.
4. `docs/0042_contracts_disputes/IMPLEMENTATION_PLAN.md`

Run `pnpm run worktree:check` and confirm 0 behind `origin/main` before reading any source file.

**Do not start this before 0041 Phase 6 lands.** Disputes are impacts with a sub-graph; without `impacts`, `impact_targets`, `impact_blocks`, and `nodeHealth()` there is nothing to build on.

---

## The thesis

Drift is the adversary. This is drift inside a conflict.

A bad-faith actor's winning strategy is **induced amnesia** — stall, deflect, argue an adjacent point, until the homeowner cannot reconstruct the original grievance and the paper trail reads as a homeowner moving the goalposts. The product's answer is the same as everywhere else: **the homeowner never loses the thread.**

## The rule that governs everything here

**Never hand a user a citation you cannot back.** Every statute, regulation, deadline, and contract clause is cited to its source and verifiable, or it is phrased as the question to ask rather than the claim to make. A fabricated citation in a complaint, in front of a licensing board, or quoted at a contractor destroys the homeowner in the exact moment they need standing.

Enforced structurally, not by discipline:

- `violation_definitions.citation` is **NOT NULL**.
- Clause extraction stores a citation to page and line, or the clause is not stored as found.
- **"No clause found — confirm" is a distinct state from "no clause exists."** Never collapse them. Silence read as absence is the dangerous failure in this feature.

## Information, not legal advice

Assemble facts, cite sources, point at the board's own process and at licensed professionals. Never predict an outcome. Never tell a homeowner they will win or that they should sue. This boundary is separate from accuracy and matters on its own.

## Build order

| Phase | Deliverable |
|---|---|
| **0** | Document ingestion; clause extraction with required source citation; `contract_clauses`, `vendor_terms`; explicit not-found state |
| **1** | Pre-signature review — risks as written, gaps versus the scope already registered in the system |
| **2** | Payment-schedule QC — contract phase conditions mapped to verifiable system state |
| **3** | Change-order awareness — feeds 0041's Change Impact Assessment |
| **4** | Vendor T&C recourse — late orders, swaps, restocking fees, return windows |
| **5** | Dispute model — `disputes`, `contested_items`, append-only `item_events`, `dispute_branches` |
| **6** | Violations & citations across contract / regulation / law / permit / license |
| **7** | Complaint drafting from recorded facts, in the board's own structure |
| **8** | Replacement handoff package |

**Phase 2 first among the user-visible ones if you need to prove value early.** Payment QC is the cheapest thing to build with the highest immediate return: a contractor says "phase done, pay up," and the system answers with state instead of an argument.

## Non-negotiable behaviors

- **Contested items carry independent status.** A compromise on one never closes another. Bundling is exactly how five grievances become one conceded item and four that evaporated.
- **`item_events` are append-only**, with separate `occurred_at` (when it happened) and immutable `recorded_at` (when it was captured). Contemporaneous beats reconstructed.
- **Branches are `impact_blocks` edges** in 0041's graph, so blast radius and node health work on them for free. Do not build a parallel dependency mechanism.
- **The replacement handoff package leads with scope and current state**, never with the grievance. A package headlined by the dispute filters for the wrong contractors — good ones walk away from apparent conflict, bad ones read an easy mark. The dispute is disclosed completely and factually, but it is not the headline.
- **Payment QC reports state and contract conditions. It never characterizes intent.** It says two of four phase conditions are unmet. It does not say anyone is lying.

## Stack constraints

Same as 0041 — one Cloudflare Worker, Astro SSR + React islands, Hono + zod-openapi, Drizzle on D1. Base UI not Radix. `db.batch()` never `db.transaction()`. Chunk at 20 for the 100-param cap. Currency as `*_text` + `*_cents`. Rich text as `*_markdown` + `*_html`. Definition + mapping tables, never blobs. Migrations via `db:generate` → `migrate:remote`.

**AI extraction uses structured output with an explicit JSON schema**, returns primary keys not display names, validates returned ids against the live set before inserting, and never degrades a failed parse to `{}` silently. On a document this consequential, a silent empty extraction is worse than a loud failure.

## Ask, do not invent

Which licensing boards get structured templates first · whether extracted clauses need human confirmation before being citable in a complaint draft · any statutory deadline you cannot cite · anything about where the dispute record may travel beyond the tenant.
