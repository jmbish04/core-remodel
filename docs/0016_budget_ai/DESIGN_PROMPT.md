# Budget AI Design Prompt

Design a production-quality frontend starting point for the Budget AI workbench in the `core-remodel` app.

This is not a loose concept exercise. Design a UI that could be implemented directly against the backend contract described below and shipped with only polish/refinement afterward.

## Product Context

This app is a remodel mission-control system used by a homeowner managing:

- room-by-room remodel scope
- contractor estimates
- material and product sourcing
- showroom research
- budget planning and actual spend
- contractor-facing bid packages

The new surface is an internal-only budget operations center for the homeowner and internal collaborators.

## Route

Design the page for:

- `/admin/budget/workbench`

## Existing Product Language

Use the repo’s existing visual world:

- dark UI
- Shadcn-style surfaces
- Monolith-like premium admin aesthetic
- editorial, high-contrast data presentation
- no generic SaaS purple gradients
- no consumer-fintech pastiche

This should feel like a serious remodel operating console, not a bank app and not a generic PM dashboard.

## Primary User

The user is a homeowner acting like an owner-operator. They need fast answers to:

- Are we over budget?
- How much contingency have we already burned?
- Which rooms are the most dangerous?
- Which contractor estimates still need reconciliation?
- Which materials/products are still undecided?
- What will a contractor see if I publish a bid package right now?

## Design Objective

Create a page that makes complex financial and scope relationships legible without collapsing into a spreadsheet.

The UI should feel:

- authoritative
- high-signal
- decision-oriented
- calm under complexity

## Information Architecture

The page should include these sections.

### 1. Executive Strip

A high-priority top band with:

- planned low / planned high
- committed amount
- spent amount
- remaining funds
- contingency consumed / contingency remaining
- over/under status
- high-risk unresolved count

This should read in seconds.

### 2. Decision Inbox

A prominent queue of action cards for things like:

- unmapped contractor estimate lines
- over-target product choices
- rooms drifting over range
- questionnaire-generated budget lines still unreviewed
- bid-package visibility risks

Each card should clearly state:

- the issue
- severity
- impacted room/trade/entity
- the next action

### 3. Room Budget Board

A set of room cards or rows showing:

- room name
- budget range
- linked estimate count
- open materials count
- blocker state
- risk posture

This should help the user instantly see where the remodel is financially unstable.

### 4. Estimate Reconciliation Board

A section for contractor proposals showing:

- contractor/company
- revision status
- total quoted amount
- mapped vs unmapped line count
- top variance signal
- room coverage

This area should include a clear sub-surface for low-confidence or unresolved estimate lines that need manual mapping, not just a summary metric.

This should feel like an operations queue, not a filing cabinet.

### 5. Materials / Products Decision Board

A sourcing and purchase section showing:

- material name
- room
- selected product state
- purchased state
- price posture
- open decision state

The point is to connect sourcing decisions to budget impact.

Important semantic rule:

- selected means the homeowner’s current final product decision
- purchased means the transaction is complete
- a selected product can still change before purchase if supply or vendor issues appear
- a purchased product should visually read as selected plus completed

### 6. Contractor Visibility Preview

An internal preview that helps the homeowner understand:

- what budget data stays private
- what appears only when `showBudgetRanges` is enabled
- whether a contractor-facing package feels complete enough to send

This internal preview should be comprehensive. The homeowner should be able to inspect the full budget/shareability picture before anything is publicly exposed.

### 7. Sync History

Include a dedicated sync-history state or tab for the first release.

Show:

- source of budget edit
- timestamp
- affected entity
- direction or channel where relevant
- success/conflict state

This should feel like an operator audit surface, not a raw log dump.

## Interaction Requirements

- Clicking a room should feel like a drilldown into a room-centered financial story.
- Clicking an estimate should feel like entering reconciliation mode.
- Unresolved estimate lines should feel easy to triage manually.
- The estimate area should make both whole-revision context and line-item mapping legible.
- Clicking a material should reveal sourcing/product decision context.
- Clicking an inbox card should jump to the fixing surface.
- The page should support desktop-first density but remain coherent on mobile.

## Layout Direction

Do not design this as one long table.

Suggested rhythm:

- compact executive strip
- left-heavy decision and room operations area
- right-side contextual panels or modular secondary boards
- clear sectional hierarchy with different densities

Use varied surface scales so everything does not look like identical cards.

## Tone And Copy

Use concise, operational copy.

Good tone:

- “3 estimate lines still lack a budget mapping”
- “Primary bath is tracking above approved range”
- “Kitchen appliance package not yet locked”
- “Contingency reserve is down to 7.4%”

Avoid:

- marketing phrases
- cheerful finance-app language
- vague AI copy

## Visual Style

- strong typography hierarchy
- dark surfaces with disciplined contrast
- amber/red reserved for risk and blockers
- green reserved for committed wins and resolved items
- muted blue or steel tones for neutral informational context
- minimal decorative motion, but deliberate reveal/stagger is fine

Avoid:

- neon overload
- flat one-tone card grids
- endless pills and badges with no hierarchy

## Backend Contract To Design Against

Assume the frontend will receive:

- `GET /api/budget-workbench/summary`
- `GET /api/budget-workbench/rooms`
- `GET /api/budget-workbench/estimates`
- `GET /api/budget-workbench/materials`
- `GET /api/budget-workbench/decision-inbox`

Also assume room pages, estimate pages, product pages, and bid-portfolio flows already exist elsewhere in the product.

Assume the product may also expose MCP tools for these same workflows. Your design should therefore make action semantics explicit: when a user takes an action in the UI, that action is expected to have a durable backend contract that an MCP tool could invoke with the same outcome.

## Deliverable Expectations

Produce a design-ready starting point that could be handed to an implementation agent without rethinking the product journey.

The design must show:

- a clear default state
- a believable high-density populated state
- thoughtful treatment of alerts, partial data, and unresolved items
- obvious paths from overview to action
- action language that is precise enough to map cleanly to shared frontend/MCP backend mutations

The result should look like a premium internal operating system for a complex remodel, not a generic dashboard template.
