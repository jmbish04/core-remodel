Yes — Claude design (artifacts) is great for this. Best output format from it is **one React artifact = one surface** with all states stacked vertically. So plan on 4 separate paste-ins (one per pillar), or one mega-prompt if you want it all in one scroll.

Here's a paste-ready master prompt — drop this in first, then send one surface prompt per follow-up turn.

---

````markdown
# Context: The Monolith — design system briefing

You are designing a high-fidelity React mockup for **The Monolith**, a renovation-management app for a whole-home remodel in San Francisco. Use this briefing as the standing context for every screen you generate in this conversation.

## Tech assumptions for the artifact
- React + Tailwind + shadcn/ui primitives (already available in the artifact runtime).
- Recharts wrapped in a shadcn ChartContainer pattern.
- Lucide icons.
- Inter font (already loaded).
- No external API calls. Use inline mock data shaped exactly like the JSON I provide.
- Default export is the page component. Stack ALL UI states inside it as labeled sections (DATA / EMPTY / LOADING / ERROR / MOBILE) so I can review them in one scroll.

## Design system — "Monolith" / Moody Modern (NON-NEGOTIABLE)

**Theme**: dark always. Wrap the artifact root in a `min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased`.

**Palette (OKLCH preferred, HSL fallback)**:
- background: `bg-zinc-950` (#09090b)
- surface: `bg-zinc-900/60`
- elevated: `bg-zinc-900`
- foreground: `text-zinc-100`
- muted-foreground: `text-zinc-400`
- ring: `ring-zinc-700/60`
- accent (success/positive): `emerald-400`
- accent (warning): `amber-400`
- accent (danger / overpriced): `rose-400`
- accent (info / aligned): `sky-400`

**Chart palette** (override `--chart-1..5`, force `tick={{ fill: '#fafafa' }}` and high-opacity grid):
- chart-1: `oklch(0.72 0.18 145)` (emerald)
- chart-2: `oklch(0.70 0.18 50)` (amber)
- chart-3: `oklch(0.68 0.20 25)` (rose)
- chart-4: `oklch(0.70 0.16 230)` (sky)
- chart-5: `oklch(0.75 0.14 290)` (violet — sparingly)

**Typography**:
- Display headers: `text-3xl font-semibold tracking-tight` — sometimes `font-serif` if you want editorial drama (use sparingly, max once per screen).
- Section titles: `text-sm font-medium uppercase tracking-[0.18em] text-zinc-400`.
- Body: `text-sm` default, `text-base` for primary content.
- Numbers: `font-mono tabular-nums` for any dollar/percent/quantity readout.

**THE NO-BORDERS RULE** (this is the brutalist signature — strictly enforced):
- ❌ Never use `border` / `border-b` / `border-zinc-800` for separation.
- ✅ Use `ring-1 ring-border/40` (which resolves to `ring-zinc-800/40`) on cards.
- ✅ Use `divide-y divide-zinc-800/60` on lists/tables.
- ✅ Use background contrast (`bg-zinc-900/60` on `bg-zinc-950`) to create surfaces.
- ✅ Exactly one sanctioned border allowed: the navbar bottom edge (`border-b border-zinc-800`).

**Motion** (perpetual micro-motion, never gratuitous):
- All numeric readouts animate digit-by-digit when they change (framer-motion `<AnimatePresence mode="popLayout">`).
- Card hover: `transition-all duration-300 hover:ring-zinc-600` — NO translate, NO shadow puff.
- DnD chips: tight `ring-2 ring-emerald-400/70` glow on valid drop target. No scale bounce.
- Tab switches: `layoutId` shared element on the active indicator.

**Anti-patterns — BANNED** (zero tolerance):
- ❌ Purple gradients, glass morphism, pastel cards.
- ❌ Round-everything (use `rounded-xl` for cards, `rounded-md` for inputs, `rounded-full` only for badges/avatars).
- ❌ Center-aligned hero text with a single CTA below.
- ❌ Generic "stat tile with up-arrow and percentage" — instead, use a sparkline + sober number.
- ❌ Drop shadows on cards. Use rings.
- ❌ Lighten-on-hover. Use ring color change.
- ❌ Emojis in UI copy.

## Layout primitives I'll reuse across surfaces

- **Navbar**: black `bg-zinc-950 border-b border-zinc-800` with project name "The Monolith" in `font-mono tracking-tighter`, nav links right-aligned, no logo image.
- **Page header pattern**: small uppercase eyebrow → large display title → muted one-line description → action buttons right-aligned. Followed by a thin `divide-y` separator.
- **Card pattern**: `rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-6`.
- **Data tables**: `divide-y divide-zinc-800/60`, header row `text-xs uppercase tracking-wider text-zinc-500`, hover row `bg-zinc-900/40`. Sortable column indicators are tiny chevrons in `text-zinc-600`.

## States you must produce for every surface

1. **DATA** — fully populated with realistic mock data.
2. **EMPTY** — zero-state with a quiet illustration (use a lucide icon at 48px in `text-zinc-700`, never an SVG drawing) and one primary action.
3. **LOADING** — shadcn `<Skeleton />` shapes that match the data layout (not centered spinners).
4. **ERROR** — inline banner `rounded-xl bg-rose-950/40 ring-1 ring-rose-500/30 text-rose-200 p-4` with retry CTA.
5. **MOBILE** — a 375px-wide variant of the DATA state. Sidebar collapses into a sheet, tables become stacked cards.

When I send each surface prompt, stack all five states top-to-bottom in one artifact, each preceded by a `<h2 className="text-xs uppercase tracking-[0.18em] text-zinc-500 mt-16 mb-4">STATE: DATA</h2>` separator.

Acknowledge with "Monolith briefing locked." and wait for the first surface prompt.
````

---

Then send these one at a time as follow-ups in that same Claude session:

**Surface 1 — Truth Table Editor**

````markdown
Generate **Surface 1: Truth Table Editor**.

This is the granular per-SF baseline cost catalog for construction activities. The user edits inline.

Data shape (mock 12-18 rows across trades demo/framing/plumbing/electrical/flooring/finish):
```ts
type TruthTableActivity = {
  id: string; scopeKey: string; displayName: string; description: string;
  trade: 'demo'|'framing'|'plumbing'|'electrical'|'hvac'|'flooring'|'finish_carpentry'|'tile'|'paint';
  phase: 'pre_construction'|'rough'|'finish'|'punch';
  unit: 'sf'|'lf'|'ea'|'hr'|'ls';
  baselineLaborCentsPerUnit: number;
  baselineMaterialCentsPerUnit: number;
  baselineEquipmentCentsPerUnit: number;
  insuranceBaselineCentsPerUnit: number | null; // the "low-ball" reference
  marketAdjustmentPct: number; // 0.18 = +18% SF Bay premium
  sourceType: 'manual'|'insurance'|'rsmeans'|'ai_inferred'|'bid_observed';
  confidenceScore: number; // 0..1
};
```

Layout:
- Page header: eyebrow "CATALOG" / title "Truth Table" / desc "Baseline labor + material costs per granular activity. SF Bay-adjusted."
- Filter bar: trade multiselect, phase multiselect, search input, source-type filter. Right side: "Re-embed all" + "Add activity" buttons.
- Density toggle (compact/comfortable).
- KPI strip (4 cards): Total activities · Activities embedded · Avg confidence · Activities flagged as ai_inferred.
- The table:
  - Columns: Activity (scopeKey + displayName + description on hover), Trade (chip), Unit, Labor $/u (mono), Material $/u (mono), Equip $/u (mono), Adjusted $/u (computed, highlighted), Insurance baseline $/u (mono, with delta indicator if our value is higher), Confidence bar, Source.
  - One row in "editing" state: show inline number inputs replacing the cents columns. Save/cancel buttons inline.
  - Variance vs insurance: small inline chip "+34% vs ins." in amber if our adjusted is >20% above insurance baseline.

Now stack all 5 states (DATA, EMPTY, LOADING, ERROR, MOBILE).
````

**Surface 2 — Bid Analyzer (variance dashboard)**

````markdown
Generate **Surface 2: Bid Analyzer detail view** (one bid, post-analysis).

Data shape:
```ts
type BidAnalysis = {
  bid: { id: string; contractorName: string; receivedAt: string; totalBidCents: number; totalTruthTableCents: number; variancePct: number; verdict: 'investigate'|'negotiate'|'accept'; aiSummary: string; };
  mappings: Array<{
    id: string;
    bidLine: { rawLabel: string; rawCostCents: number; parsedQuantity: number|null; parsedUnit: string|null; };
    activity: { scopeKey: string; displayName: string; trade: string; unit: string; };
    allocationPct: number;
    allocatedCostCents: number;
    baselineCostCents: number;
    varianceCents: number;
    variancePct: number;
    flag: 'overpriced'|'aligned'|'underpriced'|'missing_scope';
    semanticScore: number; // 0..1, AI mapping confidence
  }>;
  missingScope: Array<{ scopeKey: string; displayName: string; estimatedCostCents: number; reason: string }>;
  negotiationLevers: Array<{ title: string; description: string; estimatedSavingsCents: number }>;
};
```

Layout:
- Top banner: verdict pill ("INVESTIGATE" in amber), contractor name, total bid (mono, large), variance ±%, AI summary paragraph.
- Two-column hero charts:
  - Left: stacked horizontal bars per trade — bid vs baseline. Use Recharts.
  - Right: variance distribution — histogram showing how many line items fall in each variance bucket (-20%, -10%, aligned, +10%, +20%, +50%+).
- Tabs: Overpriced (default, sorted desc by varianceCents) · Aligned · Underpriced · Missing Scope.
- Each tab renders a mapping table:
  - Bid line column (raw label + raw cost mono) | allocation slider (visual % bar) | mapped activity column (scopeKey + display name) | baseline (mono) | variance cell (±$ and ±% in color tier) | semantic score (mini progress) | actions (override / confirm).
  - Overpriced rows have a left edge accent in rose (no border — use a thin pseudo-element via `before:`).
- Right rail: "Negotiation Levers" card — list of 3-5 AI suggestions with estimated savings.

Stack all 5 states.
````

**Surface 3 — Material Cart + Compare**

````markdown
Generate **Surface 3: Material Cart (grid view) AND a Compare drawer state**.

Data shape:
```ts
type Material = {
  id: string; category: 'cabinetry'|'countertop'|'flooring'|'lighting'|'plumbing_fixture'|'tile'|'hardware'|'appliance';
  productName: string; brand: string; sku: string|null;
  sourceUrl: string|null; sourceVendor: string|null;
  primaryImageUrl: string;
  unit: string; unitPriceCents: number; leadTimeDays: number|null;
  status: 'considering'|'shortlist'|'selected'|'rejected'|'purchased';
  scoreAesthetic: 1|2|3|4|5; scoreDurability: 1|2|3|4|5; scoreValue: 1|2|3|4|5;
  roomAssignments: Array<{ roomName: string; quantity: number }>;
  aiSummary: string;
};
```

Layout — page:
- Header: eyebrow "PROCUREMENT" / title "Material Cart" / desc "Tracking finishes, fixtures, and appliances under consideration."
- Intake bar (sticky top): "Snap photo" button + "Paste URL" input + "Quick add" drawer trigger.
- Category filter pills row.
- Card grid: 4 across desktop, 1 on mobile.
  - Card: 1:1 image at top with status chip overlay top-right (`shortlist` = sky, `selected` = emerald, `rejected` = zinc/50% opacity grayscale image).
  - Below image: product name, brand muted, unit price (mono large), lead time chip, room assignment chips.
  - Hover: card ring lightens, action buttons fade in (compare-add, edit, archive).
- Sticky bottom compare tray (shown when ≥2 items checked): "Compare 3 selected →" CTA.

Layout — compare drawer (separate section in the same artifact):
- Full-screen overlay `bg-zinc-950/95 backdrop-blur-sm`.
- Header with the 3 product names + close button.
- Side-by-side columns (one per material) on desktop, accordion stacked on mobile:
  - Hero image at top of column.
  - Spec rows: brand, sku, unit price, lead time, aesthetic score (5-dot row), durability score, value score.
  - Each spec row is `divide-y divide-zinc-800/60` between rows; columns separated by `divide-x`.
- Bottom row: "Decide on this one" button per column.

Stack all 5 states for both the grid AND the compare drawer.
````

**Surface 4 — Scenario Builder (puzzle pieces)** — *this is the centerpiece, give it the most detail*

````markdown
Generate **Surface 4: Scenario Builder** — the visual drag-and-drop puzzle interface.

This is the centerpiece. The user drags "puzzle pieces" (toggles) onto/off the canvas and watches the budget recompute live.

Data shape:
```ts
type ToggleCategory = 'structural'|'finish'|'systems'|'layout';
type Toggle = {
  id: string; toggleKey: string; label: string; description: string;
  category: ToggleCategory;
  kind: 'binary'|'exclusive';
  optionGroup: string|null;
  options?: Array<{ optionKey: string; label: string; estimatedCostCents: number }>; // for exclusive
  estimatedCostCents: number; // for binary
};
type LiveBudget = {
  totalExpectedCents: number; totalLowCents: number; totalHighCents: number;
  fundingAvailableCents: number;
  byTrade: Array<{ trade: string; cents: number }>;
  byCategory: Array<{ category: ToggleCategory; cents: number }>;
  warnings: Array<{ code: 'exceeds_funding'|'missing_required'; message: string }>;
};
```

Mock 12-15 toggles across categories. Example puzzle pieces:
- structural / exclusive `kitchen_path`: { downstairs_slab_cut: $62,400 | upstairs_in_kind: $18,200 }
- structural / binary "Convert hall bath to laundry" $14,800
- finish / exclusive `flooring_main`: { hardwood: $42k | engineered_wood: $28k | luxury_vinyl: $14k }
- finish / binary "Custom cabinetry millwork" $38,000
- systems / binary "Mini-split HVAC instead of ducted" -$8,500 (negative!)
- layout / binary "Skip primary bath gut" -$32,000

3-column page layout (desktop) → stacked (mobile):

**LEFT RAIL — TogglePanel (320px)**
- Search input top.
- Accordion sections per category (Structural · Finish · Systems · Layout) with badge count.
- Each toggle = draggable puzzle-piece chip:
  - `rounded-lg bg-zinc-900 ring-1 ring-zinc-800/60 p-3 cursor-grab`
  - Top row: small category dot color + label.
  - Cost preview right-aligned in mono — green if negative (savings), zinc otherwise.
  - For exclusive groups: small "3 options" chip indicating it's a radio choice.
- Pieces already-placed on canvas are grayed out + show "PLACED" label.

**CENTER — ScenarioCanvas (flex-1)**
- Header: scenario name "Kitchen Downstairs, Family Up" + status pill + save-snapshot button.
- Three drop zones stacked vertically:
  - `MUST-NOW` (emerald accent eyebrow) — committed items.
  - `OPTIONAL` (amber accent) — under consideration.
  - `PARKED` (zinc accent, muted) — set aside.
- Each drop zone:
  - Eyebrow + count + zone subtotal in mono.
  - Empty zone shows dashed-ring placeholder (`ring-2 ring-dashed ring-zinc-800` — this is the ONLY exception to the no-borders rule and we use ring-dashed not border-dashed).
  - Populated zone shows placed toggle chips with a radio-group sub-control for exclusive toggles (the 3 kitchen options as inline pills, active one in emerald-bg).
  - When dragging over a zone: ring shifts to `ring-emerald-400/70` glow.

**RIGHT RAIL — LiveBudgetSidebar (380px)**
- Sticky.
- BudgetGauge: large radial gauge (Recharts) showing expected vs funding-available. Big mono dollar readout center, "±$X vs funding" below. Number animates digit-by-digit on changes.
- Range readout: "Low $X · Expected $Y · High $Z" in mono with thin bar visualization.
- BreakdownByTrade: stacked horizontal bar with trades labeled, OKLCH chart palette.
- BreakdownByCategory: 4-slice donut.
- Warnings list at bottom: each warning is a small inline banner.

Mobile (375px):
- Tabs at top: Pieces | Canvas | Budget. One pane at a time.
- Sticky bottom bar shows compressed "$447,200 · +$11,200 over" with a tap-to-expand budget sheet.

Stack all 5 states. For the LOADING state, skeleton the entire 3-column layout. For the DATA state, show one toggle mid-drag (a `<DragOverlay>` floating chip with `rotate-1` and an emerald ring glow over a target drop zone).
````

**Surface 5 — Contractor Portal (read-only, redacted)**

````markdown
Generate **Surface 5: Contractor Portal** — public read-only view via share token.

Critical constraint: **ZERO pricing must appear anywhere**. No cents, no dollars, no percent variance, no baseline numbers, no budget bar, no funding info. Contractors see scope only.

Data shape (redacted DTO — note the absence of any cents fields):
```ts
type PortalSnapshot = {
  scenarioName: string; scenarioDescription: string;
  rooms: Array<{ name: string; floor: string; proposedUse: string; notes: string|null }>;
  togglesEnabled: Array<{ label: string; description: string; category: 'structural'|'finish'|'systems'|'layout' }>;
  materialsSelected: Array<{ category: string; productName: string; brand: string|null; imageUrl: string|null }>;
};
```

Layout:
- Header strip: "The Monolith · Scope Preview" left, "Shared by [Owner Name] · expires [date]" right. No logo, monospace project name.
- Section 1 — Scenario summary: name as display heading, description as one-paragraph subhead.
- Section 2 — Rooms grid: cards per room showing floor, proposed use, notes. No costs.
- Section 3 — Active toggles: grouped by category, each as a chip with description on hover/tap.
- Section 4 — Material selections: image grid grouped by category. Product name + brand only, no prices, no SKUs unless useful for sourcing.
- Footer: "Questions? Reply to the owner via email."

Make this feel deliberately quieter than the admin surfaces — slightly more whitespace, slightly muted accent colors. Same dark theme, same no-borders rule.

Stack all 5 states.
````

---

That's the full set. The master briefing locks the design system; each surface prompt is self-contained with its data shape, so Claude Design can produce an artifact per turn without re-establishing context. Want me to also draft the Stitch MCP variants of these in case you want both designs in parallel?
