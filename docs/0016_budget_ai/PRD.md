# 0016 Budget AI PRD

Date: 2026-07-11
Status: Ready for implementation planning
Owner: Codex synthesis pass over `docs/0016_budget_ai/prd_prep`

## 1. Executive Summary

The repo already contains a meaningful budget foundation:

- revisioned planning items in `budget_tracker_items`
- scenario math in `budget_variance_*`
- baseline assumptions and static budget catalogs
- room-level budget joins
- estimate intake with revisions, documents, extracted line items, and room mappings
- material schedule items with required specs
- showroom products with research, pricing intel, and product/media/spec surfaces
- contractor-facing bid portfolios with optional budget visibility
- questionnaire answers that can auto-create budget tracker shadow items

The missing piece is not a brand-new budgeting system. The missing piece is a cohesive budget operating layer that ties these systems together so the homeowner can answer:

1. What are we planning to spend?
2. What have we actually committed to?
3. Which contractor estimates map to which budget lines?
4. Which material/product decisions are still open?
5. Which rooms or trades are most likely to blow the budget?
6. What should be shown to contractors versus kept internal?

This PRD defines a repo-grounded Budget AI workbench that uses the existing Worker, D1, Astro, React, Hono, and AI-agent stack rather than replacing it.

## 2. Review Of The PRD Prep Parts

### 2.1 What was strong

- The prep correctly identified the real user problem: residential remodel budgeting is opaque, scope drifts, and contractor proposals often separate narrative from financial truth.
- The prep correctly emphasized allowance risk, change-order risk, and the need to keep deterministic math separate from qualitative AI reasoning.
- The prep correctly connected budget to materials, sourcing, contractor bids, and room-by-room decision-making.
- `v1` was especially useful in naming the construction-finance semantics that matter here: allowances are placeholders for known selections still in motion, while contingency is protected reserve for unknowns.

### 2.2 What was incomplete or incorrect

- Several prep drafts proposed greenfield schemas and routes that duplicate systems already present in this repo.
- Some drafts referenced path layouts or classes that do not match the actual `src/backend` and `src/frontend` structure here.
- Some drafts over-indexed on new Durable Objects and Workflows where normal Hono + D1 + existing agents already cover the near-term need.
- Some drafts treated “budget” as a single table problem, but this repo already splits budget reality across tracker items, expenses, assumptions, scenarios, estimates, products, materials, and contractor-facing bid packages.

### 2.3 Product correction

This feature should be framed as:

`Budget AI = decision support and reconciliation layer across existing budget, room, estimate, material, showroom, and contractor-brief systems`

not:

`Budget AI = replace the current repo with a new finance platform`

## 3. Product Goals

### 3.1 Primary goals

- Give the homeowner one internal workspace to track planned, quoted, selected, purchased, and spent budget state.
- Make room-level and trade-level budget exposure visible.
- Reconcile contractor estimates against internal budget items and internal cost truth surfaces.
- Connect material and product decisions to budget consequences.
- Generate contractor-facing budget context only when explicitly enabled.
- Use AI to summarize, flag, and suggest, but not to own the core ledger math.

### 3.2 Secondary goals

- Make budget context available inside room detail, estimate review, materials, and bid portfolio flows.
- Persist enough evidence links that a user can explain why a number exists.
- Create a high-quality UI foundation that design polishing can improve without rethinking core workflows.

### 3.3 Non-goals

- Replacing the existing room, showroom, estimate, or bid portfolio systems.
- Rewriting the entire Google Sheets sync layer.
- Building a separate finance backend outside the current unified Worker.
- Letting AI directly mutate financial records without explicit user action.

## 4. Finance Principles

### 4.1 Allowances vs contingency

The product must explicitly distinguish:

- allowance-like planning ranges for selections still in motion
- committed values once a contractor quote or product decision is chosen
- contingency as protected reserve, not casually spendable headroom

The UI and services should avoid flattening these into one “budget” number.

### 4.2 D1 is the financial source of truth

This repo already contains sync concepts and mutable financial state. The budgeting feature should preserve one rule:

- D1-backed application state is authoritative
- external spreadsheet mirrors are operational views, not primary truth

### 4.3 Human override is mandatory

Estimate parsing, budget-line mapping, and scope-gap detection may be AI-assisted, but final mapping authority must remain with the user.

### 4.4 MCP parity with frontend actions

Any MCP tool that can perform a budgeting action must have parity with the equivalent frontend action.

That means:

- if a frontend action writes data points A through D, the MCP action must also write A through D
- if a frontend action triggers downstream processes, derived records, alerts, links, sync events, or AI jobs, the MCP action must trigger the same processes or an equivalent server-side path that produces the same end state
- MCP must not create a second-class write path that bypasses revisioning, linking, audit, alert, or follow-up behavior

The implementation should prefer shared backend mutation services so frontend and MCP writes use the same business logic.

## 5. Users And Jobs

### 4.1 Homeowner / operator

Needs to:

- allocate budget by room, trade, and option path
- compare internal assumptions vs external estimates
- connect desired products/materials to actual spend risk
- decide what is internal-only vs contractor-visible

### 4.2 Contractor / vendor

Needs to:

- receive clear room scope and selected supporting artifacts
- optionally see budget ranges when allowed
- provide estimates without seeing unnecessary internal analysis

### 4.3 Internal AI assistant

Needs to:

- summarize deltas, blockers, and open decisions
- propose mappings and flags
- never become the source of truth for top-line arithmetic

## 6. Current Repo Ground Truth

### 5.1 Budget planning ledger

- `budget_tracker_items` is the mutable planning ledger with revision chaining, status, owner, bottleneck state, low/high estimate range, optional scenario linkage, and room joins through `budget_tracker_item_rooms`.
- `budget_expense_entries` is the actual spend ledger, also revisioned.
- `budget_project_info` and `budget_funding_accounts` hold project and funding metadata.

### 6.2 Budget scenario and assumption data

- `budget_variance_scenarios` and `budget_variance_line_items` model high-level layout scenario deltas.
- `static_budget_items`, assumption tables, and trade/truth-table data provide baseline internal cost references.
- `loadBudgetSnapshot()` already computes a derived budget snapshot using current project variables.
- The existing repo already contains the beginnings of contingency/variant thinking; the workbench should expose this more coherently rather than inventing a second math model.

### 5.3 Room context

- `rooms.ts` and `rooms-extended.ts` already expose room detail, room-level budget items, scenario plans, estimate mappings, and AI summary context.

### 5.4 Materials and showroom products

- `material_schedule_items` is the sourcing intent list.
- `material_required_specs` stores structured requirements per material.
- `showroom_store_products.material_id` links candidate or chosen products to a material.
- `material_schedule_items.purchased_showroom_product_id` marks the winning product when a purchase decision is made.

### 5.5 Contractor estimates

- `estimates` is the top-level estimate record.
- `estimate_revisions` version contractor proposals.
- `estimate_documents`, `estimate_line_items`, `estimate_prop_values`, and `estimate_room_mappings` hold the extracted evidence and structure.
- `estimate_companies` and contacts define the contractor/vendor entity.

### 5.6 Contractor-facing package

- `bid_portfolios` is the public/shareable bid package.
- `bid_portfolio_room_configs` determines room visibility.
- `bid_portfolio_selected_photos` overrides which photos a contractor sees.
- `bid-portfolio-public.ts` already conditionally exposes budget ranges.

### 5.7 Questionnaire-to-budget trigger

- `checklist_questions.default_budget_impact_json` can auto-create shadow budget tracker items when an answer is committed.

## 7. Domain Relationship Model

The required product model is:

- `room` contains scope context, photos, scenario plans, and supporting evidence
- `budget_tracker_item` represents an internal planning line
- `budget_expense_entry` represents actual money spent or committed
- `material_schedule_item` represents a product/material decision that still needs sourcing or selection
- `showroom_store_product` represents a candidate or selected purchasable product
- `estimate_revision` represents a contractor proposal snapshot
- `estimate_line_item` represents a contractor-provided cost component
- `bid_portfolio` represents the sanitized contractor-facing view
- `questionnaire answer` can introduce or justify a budget line

In practice, one budget line may be supported by multiple artifacts:

- one or more rooms
- one questionnaire answer
- one or more estimate line items
- one material schedule item
- zero or more showroom products

That evidence chain is currently implicit and fragmented. This feature makes it explicit.

## 8. Core Problem Statement

The repo has multiple working subsystems but no single internal budget command surface that:

- aggregates planning, estimates, sourcing, and actuals
- preserves evidence for each budget line
- distinguishes internal truth from contractor-visible context
- guides the user through open financial decisions

Today the user must mentally stitch together:

- `/admin/budget/*`
- room pages
- materials schedule
- product pages
- estimates
- bid portfolios

This is the gap the feature closes.

## 9. Proposed Feature: Budget AI Workbench

### 8.1 Primary surface

Add a new internal route:

- `/admin/budget/workbench`

This becomes the budget operations center for the homeowner and internal collaborators.

### 8.2 Workbench sections

#### A. Executive strip

Shows:

- planned low / planned high
- active projected midpoint
- actual committed spend
- remaining funds
- over-cap / under-cap state
- count of high-risk unresolved items

#### B. Decision inbox

Shows budget-impacting unresolved items across:

- open budget tracker items
- materials not yet purchased
- estimates not yet reconciled
- scenario-dependent choices
- questionnaire-triggered shadow items that have not been reviewed

#### C. Room budget board

Shows each room with:

- active budget range
- active estimates
- open materials count
- open blockers
- top budget risks

#### D. Estimate reconciliation board

Shows estimate revisions mapped against:

- budget tracker items
- truth-table or baseline cost references
- room scope coverage
- missing-scope or suspicious-scope flags
- unmapped low-confidence lines staged for manual confirmation

#### E. Materials and products decision board

Shows:

- materials needing sourcing
- linked candidate products
- selected/purchased products
- expected cost swing versus room or budget-line target

#### F. Contractor visibility preview

Shows what a contractor would see if a bid portfolio is generated with budget ranges enabled vs disabled.

## 10. Functional Requirements

### 9.1 Budget aggregation and rollups

The system must provide a single aggregated internal budget summary that combines:

- active `budget_tracker_items`
- active `budget_expense_entries`
- selected scenario values
- linked estimate totals
- linked material/product decisions where relevant

The system must separate:

- planned
- quoted
- selected
- purchased
- spent
- contingency reserve

The system should visually show contingency consumption, not just total-spend deltas.

### 9.2 Evidence-linked budget items

Each budget tracker item must support links to evidence records such as:

- room
- estimate revision
- estimate line item
- questionnaire answer track
- material schedule item
- showroom product

The user must be able to see why an item exists and what source supports it.

### 9.3 Estimate-to-budget reconciliation

The user must be able to:

- view an estimate revision in the context of internal budget lines
- map estimate line items to budget tracker items
- identify unmapped estimate lines
- identify budget lines with no contractor estimate coverage
- flag suspicious variance or missing scope

The system should support a human-in-the-loop staging concept for vague or low-confidence estimate lines so that unresolved mappings are obvious and fixable.

Estimate-to-budget mapping should exist at both levels:

- estimate revision to budget context
- estimate line item to budget item

Revision-level linkage supports whole-proposal context. Line-item linkage supports real reconciliation.

### 9.4 Material/product budget linkage

The user must be able to:

- see which material decisions impact which room and budget line
- compare candidate products against a budget target or allowance
- mark a product as selected without yet marking it purchased
- mark a purchased product as the final choice for the material

Selected and purchased must be separate persisted states at the material layer.

Rules:

- selected means the current final product decision
- selected may still change before purchase if stock, lead time, or vendor issues force a change
- purchased implies selected

The first release must not treat “selected” as UI-only staging.

### 9.5 Room-aware budget operations

Room pages must show budget information that is actionable, not just informational:

- current budget lines
- linked estimates
- linked material decisions
- open blockers
- latest AI summary for the room’s budget risk posture

### 9.6 Internal vs external visibility

The system must distinguish internal-only budget intelligence from contractor-visible content.

Contractor-facing bid portfolio output must never expose:

- internal AI risk labels
- alternative internal product comparisons unless intentionally included
- internal notes about negotiation posture

Budget ranges are only exposed when `showBudgetRanges` is enabled.

Internally, the homeowner should be able to preview all budget-related bid-portfolio context before anything is publicly shared. The internal preview should clearly show what is included, excluded, and conditionally visible.

### 9.7 AI assistance rules

AI may:

- summarize
- classify
- suggest mappings
- identify likely missing scope
- draft explanation text

AI may not:

- silently create committed financial facts
- silently alter committed math
- auto-approve purchases or contractor mappings

### 9.8 Scope-gap and allowance-risk detection

The workbench should provide deterministic or rules-backed warnings for:

- estimate lines that appear to omit expected companion scope
- rooms with finish-heavy scope but weak preparatory coverage
- allowance-heavy proposals that hide too much unresolved cost in placeholders

This should be practical and repo-grounded, not a giant greenfield “construction OS” rewrite.

### 9.9 MCP mutation parity

For any user action that exists in the frontend and is later exposed through MCP, the system must preserve the full mutation contract:

- identical persisted data
- identical revision behavior
- identical evidence-link behavior
- identical alert creation or recomputation behavior
- identical downstream async triggers when those are part of the frontend contract

Examples:

- if a frontend “link estimate line to budget item” action writes a link row and recomputes alerts, the MCP equivalent must do both
- if a frontend “mark product selected” action updates material/product state and triggers budget recomputation, the MCP equivalent must do the same
- if a frontend “commit questionnaire-derived budget item review” creates or updates tracker state, links, and inbox state, the MCP equivalent must preserve that full lifecycle

### 9.10 Sync history in first release

The first release should include a dedicated sync-history view for budget edits.

This view should surface:

- source of change
- affected entity
- timestamp
- direction or channel where relevant
- success, failure, or conflict state

This should extend existing sync and audit patterns rather than inventing a disconnected audit subsystem.

## 11. Data Model Changes

The first implementation should minimize schema churn and reuse current tables. Two additions are justified, plus one explicit persistence enhancement at the material layer.

### 10.1 New table: `budget_tracker_item_links`

Purpose:

- persist evidence links between a budget tracker item revision and related entities

Suggested fields:

- `id`
- `budget_tracker_item_id`
- `link_type`
- `link_id`
- `relationship`
- `metadata_json`
- `datetime_created`

Expected `link_type` values:

- `room`
- `questionnaire_track`
- `estimate_revision`
- `estimate_line_item`
- `material`
- `showroom_product`
- `bid_portfolio`

### 10.2 New table: `budget_alerts`

Purpose:

- persist derived warnings and decision prompts so the workbench has durable inbox items

Suggested fields:

- `id`
- `scope_type`
- `scope_id`
- `alert_type`
- `severity`
- `title`
- `message`
- `status`
- `source`
- `metadata_json`
- `datetime_created`
- `datetime_updated`

Expected use cases:

- estimate unmapped
- product over target
- room over range
- questionnaire shadow item not reviewed
- contractor-facing portfolio missing critical room context

### 10.3 Material selection persistence

The material layer should persist both:

- selected product
- purchased product

The current schema already persists purchased product. The first release should add explicit persisted selected-product state instead of relying on temporary UI state.

## 12. API Requirements

### 11.1 New APIs

- `GET /api/budget-workbench/summary`
  - consolidated rollups for planned, quoted, selected, purchased, spent, and remaining funds
- `GET /api/budget-workbench/rooms`
  - room cards with budget, estimate, materials, and blocker counts
- `GET /api/budget-workbench/decision-inbox`
  - durable budget alerts plus unresolved items
- `GET /api/budget-workbench/estimates`
  - estimate-centric reconciliation dataset
- `GET /api/budget-workbench/materials`
  - material + product + budget-target dataset
- `GET /api/budget-workbench/sync-history`
  - return budget-related sync and mutation history for the dedicated first-release sync-history surface
- `POST /api/budget-workbench/links`
  - create evidence links between budget items and related artifacts
- `POST /api/budget-workbench/alerts/recompute`
  - recompute derived alerts for current state

These APIs should be designed so both frontend and MCP tooling can call the same backend mutation paths rather than duplicating business logic.

### 11.2 Extensions to existing APIs

- `budget-tracker.ts`
  - return linked evidence and derived rollups for list/detail views
- `estimates.ts`
  - expose reconciliation-ready data and unmapped line summaries
- `materials.ts`
  - expose candidate product comparison and selected-vs-purchased distinction
- `bid-portfolios.ts`
  - expose full internal contractor-visibility preview metadata for internal use
- `rooms.ts`
  - enrich room payload with linked material and estimate budget context
- sync and audit routes/services
  - expose budget-edit sync history for the first-release workbench surface

Where a frontend flow already exists and an MCP flow is later added, both should delegate to the same domain service or mutation handler so parity is structural rather than best-effort.

## 13. UX Requirements

### 12.1 Page quality

The workbench must feel production-ready on first implementation:

- not a spreadsheet dump
- not a debugging console
- not a placeholder dashboard

It should feel like a homeowner operating console with strong information hierarchy.

### 12.2 Information architecture

The route should support:

- default overview state
- room-focused drilldown
- estimate-focused drilldown
- material/product-focused drilldown
- decision inbox state
- sync-history state

### 12.3 Key interactions

- click a room card to open a room budget drawer or deep-link to the room page
- click an estimate to open reconciliation detail
- click a material to open linked candidate products
- click an alert to jump directly to the fixing workflow
- preview contractor-visible output before publishing a bid portfolio
- manually resolve low-confidence estimate line mappings from a staging area or focused reconciliation panel

### 12.4 Empty and partial states

The UI must gracefully support:

- no estimate yet
- no product selected yet
- no room mappings yet
- budget item exists but has no evidence links yet
- contractor brief configured but not yet published

## 14. AI Behavior Requirements

### 13.1 Budget agent responsibilities

The existing `BudgetAgent` should evolve from a snapshot/proposal toy into a real assistant over the workbench data.

It should be able to:

- summarize the current overrun/underrun story
- explain major drivers by room/trade
- suggest what to reconcile next
- identify estimate lines that likely belong to existing budget items
- suggest cheaper or safer product alternatives when data exists

### 13.2 Budget agent constraints

The agent must operate on structured service outputs, not raw ad hoc calculations in model text.

The agent should consume:

- workbench summary
- inbox items
- linked evidence
- estimate variance results

and produce:

- summaries
- explanations
- proposed mappings
- proposed next actions

Where confidence is weak, the agent should explicitly emit a “needs human mapping” outcome instead of pretending certainty.

## 15. Phased Delivery

### Phase 1: Internal budget workbench foundation

- add aggregated services and endpoints
- add workbench route and overview UI
- add decision inbox
- add room cards and drilldown navigation
- add dedicated sync-history view

### Phase 2: Reconciliation and linkage

- add budget item evidence links
- add estimate mapping workflows
- add material/product budget comparison
- add persistent alerts
- add low-confidence mapping staging and manual resolution flows
- add shared mutation services so MCP and frontend actions reuse the same side-effect logic

### Phase 3: AI and contractor visibility polish

- deepen BudgetAgent against real workbench services
- add contractor-visibility preview
- add better explanation copy and action recommendations
- add stronger scope-gap and allowance-risk detection rules

## 16. Acceptance Criteria

- A homeowner can open `/admin/budget/workbench` and immediately see planned, committed, and remaining budget state.
- A homeowner can understand how much contingency has already been consumed.
- A homeowner can identify which rooms are most financially risky.
- A homeowner can identify which estimate revisions are not fully reconciled.
- A homeowner can identify which material decisions still lack final product/purchase decisions.
- At least one budget item can persist links to room, estimate, and product evidence.
- At least one estimate review flow supports explicit manual resolution for unmapped or low-confidence lines.
- The UI clearly distinguishes internal-only analysis from contractor-visible content.
- No new parallel budgeting subsystem is introduced outside the existing Worker/D1 architecture.

## 17. Risks

- Existing budget data is heterogeneous and partially historical; aggregation logic must tolerate sparse links.
- Estimate extraction quality may vary, so mapping workflows need explicit human override.
- The current OpenAPI surface is incomplete; implementation should not block on docs perfection.
- AI explanations may appear authoritative even when evidence is weak; confidence and provenance must be surfaced.
- “Allowance” language may be inconsistently represented across estimates, so the first version should rely on heuristics plus human review rather than claiming perfect detection.

## 18. Clarifications Locked For This Pass

- Selected product and purchased product are separate persisted states at the material layer.
- Estimate-to-budget mapping should exist at both revision level and line-item level.
- Internal bid-portfolio preview should show all budget-related context available to the homeowner before public sharing decisions are applied.
- The first release should include a dedicated sync-history view for budget edits.
- Scenario handling should reuse existing scenario state and mutation paths rather than inventing a separate scenario subsystem inside the workbench.

## 19. Delivery Guidance

Implementation should start by reusing existing tables and routes, then add the smallest schema needed to make cross-system budget evidence durable. The frontend should preserve the repo’s established Monolith/Shadcn dark visual language while creating a new budget operations surface that feels intentional, navigable, and contractor-aware.
