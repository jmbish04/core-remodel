# Design System: Showroom & Materials Sourcing
**Profile:** Monolith
**Project ID:** 4bcb6df7-7ba2-4e1e-9d9d-adfe8faf5479

## 1. Visual Theme & Atmosphere

A confident, editorial dark interface — moody but not dim. Density 5/10, variance 7/10, motion 5/10. Feels like a well-lit architecture studio at dusk: generous breathing room, asymmetric layouts, perpetual subtle micro-motion. Clinical structure with warm typographic cadence.

## 2. Color Palette & Roles

| Role | HSL | OKLCH | Hex | Use |
|---|---|---|---|---|
| Background | `240 10% 4%` | `oklch(0.13 0.005 264)` | `#0a0a0c` | Page/app canvas |
| Foreground | `0 0% 98%` | `oklch(0.985 0 0)` | `#fafafa` | Primary text, headings |
| Card | `240 8% 7%` | `oklch(0.17 0.005 264)` | `#111114` | Elevated surfaces |
| Muted-foreground | `240 5% 68%` | `oklch(0.71 0.01 264)` | `#aaa9af` | Metadata, secondary text (boosted for AA contrast) |
| Border | `240 6% 18%` | `oklch(0.27 0.01 264)` | `#2b2a2f` | Used only in `ring-border/40` and `divide-border/40` |
| Ring (focus) | `0 0% 98%` | `oklch(0.985 0 0)` | `#fafafa` | Focus outline |
| Accent | `0 0% 98%` | `oklch(0.985 0 0)` | `#fafafa` | Primary CTAs (white-on-dark) |
| Destructive | `0 75% 60%` | `oklch(0.62 0.22 25)` | `#e84545` | Error states, destructive actions |

**Chart palette** (mandatory override of shadcn defaults):
| Var | HSL | OKLCH | Use |
|---|---|---|---|
| `--chart-1` | `217 95% 68%` | `oklch(0.74 0.18 240)` | Electric blue — primary series |
| `--chart-2` | `142 76% 56%` | `oklch(0.78 0.20 145)` | Vivid green — positive/active |
| `--chart-3` | `45 95% 60%` | `oklch(0.79 0.18 75)` | Amber gold — neutral/warning |
| `--chart-4` | `8 90% 65%` | `oklch(0.71 0.21 25)` | Hot coral — accent/alert |
| `--chart-5` | `290 75% 68%` | `oklch(0.69 0.21 320)` | Magenta purple — secondary accent |

**Banned**: pure `#000000`, purple/blue neon glows, AI gradient headlines, oversaturated accents (sat > 80%), warm/cool grey mixing.

## 3. Typography Rules

- **Display**: Inter, `font-semibold tracking-tight`, `text-4xl` to `text-6xl` for headlines
- **Body**: Inter, default weight, `text-foreground` for primary, `text-muted-foreground` for metadata
- **Mono**: JetBrains Mono (or Geist Mono) — IDs, timestamps, code blocks, tabular columns, badge values
- **Tabular numerals**: `font-feature-settings: "tnum"` on every numeric cell, axis tick, tooltip value, badge
- **Line-length**: max ~65ch on body copy
- **Letter-spacing**: `tracking-tight` on display, `tracking-widest` on tiny uppercase labels (`text-xs uppercase`), default elsewhere

**Banned**:
- Generic serifs (`Times New Roman`, `Georgia`, `Garamond`)
- All-caps body or button text
- `font-bold` on display sizes (use `font-semibold tracking-tight`)
- Gradient text on large headlines (the "AI logo" tell)

## 4. Component Stylings

- **Buttons** — Tactile feedback (`-translate-y-px` on `:active`). Primary: white-on-dark fill. Outline: `ring-1 ring-border/40 bg-transparent`. Ghost: `hover:bg-accent/10`. Sizes: `sm` (h-8), default (h-10), `lg` (h-12). No outer glows.
- **Cards** — `bg-card ring-1 ring-border/40 rounded-lg p-6`. No drop shadow on flat surfaces. For high-density (tables, dashboards), drop the card entirely and use `divide-y divide-border/40` instead.
- **Inputs** — `bg-background ring-1 ring-border/40 rounded-md` + focus `ring-2 ring-ring`. Label above, error below. No floating labels.
- **Badges** — Tinted bg at 15% opacity + same-hue ring at 30% opacity. Active: emerald, Pending: amber, Failed: rose, Info: blue. Status-specific text color at 300/400 weight.
- **Tables** — `divide-y divide-border/40`, sticky header (`bg-background/95 backdrop-blur`), row-hover icon buttons for actions, tabular-nums on numeric columns, sort + filter mandatory.
- **Empty states** — Centered Lucide line icon + headline (`text-foreground font-semibold`) + supporting line (`text-muted-foreground`) + CTA button. Never an empty container.
- **Loading states** — `<Skeleton>` matching final layout dimensions. Never circular spinners. Never blank areas.
- **Charts** — Recharts via shadcn `<ChartContainer>`. Force `tick={{ fill: 'hsl(var(--foreground))' }}` on axes. `[&_.recharts-pie-label-text]:fill-foreground` on pies. `<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.25} />`. Library lock: Recharts only — Chart.js / Plotly / Visx / Nivo / Apex / Highcharts / ECharts are banned.

## 5. Layout Principles

- **Card padding**: `p-6` minimum on content
- **Section gaps**: `gap-6` minimum between major sections
- **Page padding**: `p-4 md:p-6 lg:p-8`
- **App shell max-width**: `max-w-7xl mx-auto`. Forms: `max-w-2xl mx-auto` on desktop.
- **Asymmetric heroes**: left-aligned or split-screen. Centered hero is **banned** for variance ≥ 5.
- **Grid over flexbox math**: CSS Grid for 2D layout, Flexbox only for component-internal alignment. Never `calc(width: ...)` percentage hacks.
- **Full-height**: `min-h-[100dvh]` — never `h-screen` (iOS Safari catastrophic jump).
- **Mobile-first collapse**: every multi-column layout collapses to single column below `md` (768px). Sidebar → `Sheet` via bottom-right FAB. Tables → `overflow-x-auto`. No horizontal scroll on mobile.

## 6. Design System Notes for Stitch Generation

> **Copy this entire section verbatim into every Stitch prompt and every `next-prompt.md` baton. Stitch can't read your repo — it has to be told the design system inline every time.**

**MONOLITH DESIGN SYSTEM (REQUIRED — render every element to match this):**

- **Theme**: Default dark, near-black background `#0a0a0c`, near-white text `#fafafa`. High contrast.
- **Font**: Inter — `font-semibold tracking-tight` for headlines (`text-4xl`/`text-5xl`), default weight for body. Never `font-bold`. Never all-caps body. JetBrains Mono for IDs/timestamps/code/tabular numbers.
- **Borders**: NO traditional 1px borders. Use rings (`ring-1 ring-border/40`), dividers (`divide-y divide-border/40`), or elevated dark surfaces (cards on slightly lighter background `#111114`). Only sanctioned border: navbar bottom edge for sticky-scroll affordance.
- **Spacing**: Generous whitespace. `p-6` minimum on cards, `gap-6` between sections. Asymmetric layouts — left-aligned heroes, split-screen layouts. No centered heroes.
- **Shadows**: Minimal. No drop shadows on flat surfaces. No outer glows ever. Elevation is communicated via background tone.
- **Charts**: Vivid high-luminance palette — electric blue (`#5cb8ff`), vivid green (`#3edd8b`), amber (`#fac234`), hot coral (`#f57158`), magenta (`#c977de`). White axis labels (`fill: #fafafa`). Subtle grid lines at 25% opacity. Recharts only (banned: Chart.js, Plotly, Visx, Nivo, Apex, Highcharts, ECharts).
- **Badges**: Tinted backgrounds at 15% opacity with same-hue rings at 30% opacity. Emerald for active, amber for pending, rose for failed, blue for info.
- **Empty states**: Centered Lucide line icon + headline + supporting line + CTA button. Never an empty container.
- **Loading states**: Skeleton blocks matching the final layout dimensions. Never circular spinners.
- **Iconography**: Line icons (Lucide style), 1.5px stroke, `text-muted-foreground` default, `text-foreground` for primary actions.
- **Mobile**: Sidebar collapses to `Sheet` via bottom-right FAB. Tables become `overflow-x-auto`. Cards stack to single column.

**Banned**: pure `#000000`, purple/neon glows, generic serifs, `font-bold` on display, gradient text on headlines, centered heroes, custom mouse cursors, "Scroll to explore" filler, fake metrics (`99.99% UPTIME`, `124ms AVG`), copywriting clichés (Elevate / Seamless / Unleash / Next-Gen).

## 7. Anti-Patterns (Banned)

**Color**: pure `#000000` (use `#0a0a0c`); purple/blue neon glows; AI gradient headlines; saturated > 80%; warm/cool grey mixing.

**Typography**: serifs in dashboards; all-caps body; `font-bold` on display; gradient headlines; Inter outside Monolith profile.

**Layout**: centered heroes for variance ≥ 5; "3 equal cards horizontally" feature row; overlapping elements; custom mouse cursors; `h-screen` (use `min-h-[100dvh]`).

**Borders & elevation**: traditional 1px borders on cards/inputs/panels; heavy drop shadows on flat surfaces; outer glows.

**Content**: emojis in UI chrome; generic placeholder names (John Doe / Acme / Nexus / Lorem ipsum past prototype); fake round numbers (99.99% / 99.98% UPTIME SLA / 124ms AVG); fabricated metrics (use `[metric]` placeholders); "BY THE NUMBERS" filler dashboards; `LABEL // 2024` formatting; copywriting clichés (Elevate / Seamless / Unleash / Next-Gen / Reimagine); filler UI ("Scroll to explore", bouncing chevrons).

**Charts**: shadcn default `--chart-*` on dark backgrounds; grey-on-grey labels; invisible grids (use `strokeOpacity={0.25}` minimum); chart libraries other than Recharts via shadcn.
