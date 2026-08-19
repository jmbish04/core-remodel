# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three real audiences, confirmed 2026-07-29. Today the product serves exactly one
homeowner (the owner-operator); it is being taken public, so every audience below is
a design target, not a hypothetical.

- **Homeowner — primary.** Running their own renovation while living the rest of their
  life. Spans a wide maturity range that the product must serve at both ends:
  - *First-time remodeler* — has never done this, does not know the sequence, does not
    know what they are allowed to decide later versus must decide now. Needs structure
    handed to them.
  - *Repeat / flipper* — a temporary owner balancing several projects at once. Knows the
    sequence, wants throughput and comparison, not tutoring.
  - Emotional state is part of the job, not a nicety: this is a long, expensive,
    high-variance process with real marriage-and-savings stakes. The homeowner arrives
    unsettled and the product's job is to leave them rooted.
  - Frequently **two partner homeowners** who must reach agreement on style, layout,
    and spend before either can act.
- **Contractor / vendor / "the trade" — narrow, outside-facing.** Submits bids, updates
  status, and receives specifications. Has zero product context and no patience for the
  homeowner's internal mess. Their scope in the product is deliberately limited.
- **AI agents via MCP — first-class.** Claude (and other agents) research, scrape,
  enrich, propose, and stage work through the MCP connector. Every surface therefore has
  two readers: the agent that writes into it and the homeowner who confirms it. Human
  confirmation is the design center, not a checkbox.

## Product Purpose

**Coordination is the product.** No single feature is the point — budget, field capture,
purchasing, design artifacts, permits, contractors are all critical and none of them is
the core. The core is holding them together so the homeowner has one north star through a
process that keeps moving.

- A renovation is an evolving, living thing that takes many turns: layout, finishes,
  materials, color, style, lighting, the electrical consequences of those choices,
  possible structural changes, permits, hiring, and the budget realizations that reset
  all of the above.
- Success is a homeowner who stays **rooted and balanced** across that: knows where they
  are, what is decided, what is still parked, what it costs, and what happens next.
- Failure is not a missing feature. Failure is the homeowner losing the thread — a
  decision made twice, a receipt they cannot find when a shipment goes wrong, a
  contractor conversation they walk into unprepared.

## Positioning

The product's defensible mechanism is that it makes the homeowner **credible to the
trade** while keeping them honest with themselves. Three things reinforce each other and
are hard to copy separately:

- **The budget is simultaneously a control and a communication instrument.** It exists to
  show where money is actually going and to let ideas be *parked before they are
  committed*, so the homeowner can see every option through and rebalance as reality
  lands. It is also what the trade asks for: it signals seriousness and readiness.
- **Field reality captured fast becomes a map, not a memory.** Showroom visits, drives,
  photos, measurements, prices, lead times, receipts — captured while standing there —
  produce what is out there, what was liked, what things actually cost, and how long they
  take. That record drives partner agreement and tells a contractor how ready the project
  is. Contractors do not want to wait on a homeowner making up their mind.
- **Design artifacts are alignment tools, not decoration.** Renders, moodboards, layout
  studies, and the decision room let ideas develop over many iterations and let the
  homeowner rule an idea out privately the moment they see it and hate it. That saves burn
  rate with the trade, who will not game ideas out for you and who take a homeowner
  seriously only when they arrive with the thing already sketched. It is a visual "let's
  get on the same page" toolset for homeowner ↔ partner ↔ contractor ↔ designer ↔
  architect.

## Operating Context

- **Desktop, primary.** Dense multi-pane work at a real monitor: budget, comparison,
  review queues, planning.
- **Phone in the field.** Standing in a showroom or on the job site — photo capture,
  visit logs, measurements, receipts. One-handed, often mid-conversation.
- **Tesla in-car browser.** Drive lists, park-finds, and navigation handoff on a
  landscape touchscreen in a vehicle. Large targets, glanceable, sometimes in motion.
- **Real-world rituals the product wraps:** showroom drives; standing in front of a
  material with a partner on the phone; a contractor walkthrough; a permit lookup; a
  shipment arriving damaged and needing the receipt and order details for recourse; a
  bid arriving and needing comparison.
- **Recourse trail matters.** Something going wrong with a shipment is expected, not
  exceptional; the product is where the paper for it lives.

## Capabilities and Constraints

Confirmed today:

- Single Cloudflare Worker: Hono + `@hono/zod-openapi` API, Astro SSR frontend with
  React islands and shadcn/Base UI components, Drizzle ORM on D1, R2, KV, Vectorize,
  Workers AI + Gemini, Durable Objects, Workflows.
- ~140 Astro pages exist, nearly all under `/admin/*`, behind one shared access gate.
- An OAuth-gated MCP server (`/mcp`, docs at `/connect`) with a registry-driven tool set
  is a shipped, load-bearing surface.
- Outside-facing surfaces already exist in prototype form: `/bid/[token]` and the
  vendor-facing build-vision brief.
- Money is stored as verbatim text plus integer cents. Rich text is stored as markdown
  plus rendered HTML. Multi-selects are definition + mapping tables, never delimited
  strings. These are product-visible constraints, not just storage rules: prices can be
  "call for pricing", and notes are authored, not typed into a bare box.

Explicitly undecided — future work must not assume an answer:

- **Product name / brand.** None. `core-remodel` is the Cloudflare worker name, not a
  brand.
- **Pricing strategy**, and therefore which capabilities sit behind an upgrade. Some
  will.
- **Multi-tenancy is committed; its boundaries are not** — account model, partner
  co-ownership, invite flow, and per-tenant data isolation are unwritten.
- **The public information architecture.** The current page count is an artifact of fast
  iterative building, not a considered structure. Going public means a much smaller,
  softer set of navigation and tasks. Two distinct interfaces are committed:
  - a **narrow contractor interface** (bid submission, status updates, specifications);
  - a **broad but far friendlier homeowner interface**.
  How the existing dense operator views survive that consolidation — folded in, tiered
  by user maturity, or kept as a separate back office — is open.

## Brand Commitments

- No name, wordmark, or identity is binding. Nothing in the current implementation should
  be treated as an approved brand.
- Existing dark UI, Tailwind tokens, and component set are incumbent implementation
  evidence, not approved brand commitments.

## Evidence on Hand

Real, in-repo:

- A live production Worker at `https://core-remodel.hacolby.workers.dev` with real data
  behind it — real showroom stores, brands, products, price observations, visit logs,
  drives, budget items, measurements, permits, and receipts for one actual renovation
  (126 Colby).
- Real project photography and documents in `r2_resources/` — roof annotations, layout
  studies, bathroom and kitchen references.
- Real planning corpus in `docs/####_*/` bundles, plus `plans` / `plan_tasks` in D1 and a
  changelog with verification records.
- A vendor-facing prototype in `build-vision/` treated as design spec.

Absences future work must not fabricate:

- No customers other than the owner. No testimonials, case studies, press, logos,
  benchmarks, adoption numbers, or pricing.
- No second tenant has ever used the system.
- No published brand, domain, or app-store presence.

## Product Principles

1. **Coordination over any single feature.** When a choice is between deepening one
   capability and connecting two, connect them. The homeowner's thread is the asset.
2. **Keep the homeowner rooted.** Every surface should answer "where am I, what is
   settled, what is still parked, what is next" without the user reconstructing it.
   Volatility is the domain's; steadiness is the product's contribution.
3. **Park before you commit.** Ideas, prices, and options must be capturable without
   being decided. Premature commitment is the expensive failure, in money and in trust.
4. **Make the homeowner credible to the trade.** Anything that lets them arrive prepared,
   specific, and ready is core value; anything that wastes the trade's patience is a
   defect.
5. **Serve both ends of the maturity range.** Structure for the first-timer must not
   become friction for the flipper; density for the flipper must not become fog for the
   first-timer.
6. **Agents propose, the human confirms.** AI staging plus explicit human confirmation is
   the working model. Never let an agent's guess enter the record indistinguishable from
   a decision.
7. **Never hand a user a citation you cannot back.** Every building-code section, statute,
   regulation, deadline, policy clause, or price the product puts in a homeowner's mouth
   must be verifiable and sourced — or phrased as the question to ask rather than the
   claim to make. A hallucinated citation quoted to a contractor, an adjuster, or an
   inspector destroys the homeowner's standing in the exact moment they need it, which is
   the precise opposite of what this product exists to do. Unverifiable does not ship.

## Accessibility & Inclusion

- No formal standard has been established as a product requirement yet — record it as
  open rather than assumed.
- Two product-specific needs are confirmed by the operating context:
  - **In-vehicle and in-field use** demand large touch targets, high contrast, and
    glanceable state — not as accommodation, but because the usage scene is a
    touchscreen in a car and a phone in a showroom.
  - **Non-expert comprehension** is a requirement, not a nicety: a first-time remodeler
    must not need domain vocabulary to act, and the trade-facing surface must be legible
    to someone with zero product context.
