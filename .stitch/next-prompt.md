---
page: showrooms
orchestration: current-agent
---
A high-end, responsive Showrooms Directory and Sourcing Hub Map page for a premium SF residential home remodel.

**DESIGN SYSTEM (REQUIRED — render every element to match this):**

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

**Page Structure:**
1. **Header & Navigation**: Logo wordmark, link to Materials Schedule (`/admin/materials`), and profile button.
2. **Asymmetric Filter Bar**: Filter options (City Hubs A-E, Specialty, Price Point $, $$, $$$, $$$$). Use a custom multi-select combobox (simulated as custom React islands) for filters.
3. **Sourcing Map Canvas**: A dark-themed layout block simulating an interactive map of the Bay Area. Show markers color-coded by Hub (A: SF, B: South Bay, C: Peninsula, D: East Bay, E: North Bay). Selecting a marker displays a high-contrast floating popover with a photo placeholder, showroom description, and a link to the Showroom Viewport.
4. **Showroom Directory Table**: Listed under the map in a clean tabular format using "divide-y divide-border/40". Show columns: Showroom Name (clickable link to `/admin/showroom-viewport?id=${id}`), Specialty Hub, Price Point, Hours (Open Saturdays/Sundays indicators), and Active Wishlist Count.
5. **Wishlist Quick-Add Panel**: A slide-over panel that allows users to quickly map products they saw in-store to their materials schedule.

**States to render in HTML:**
- **DATA State**: The default view rendering the filled showrooms directory, filtered markers on the map canvas, and active ratings.
- **EMPTY State**: An alternate viewport showing "No Showrooms Found. Try broadening your specialty filters or checking another geographic hub."
- **LOADING State**: Skeleton blocks matching the map canvas and showroom directory rows.
- **ERROR State**: A high-contrast warning panel indicating "Database Connection Error. Try reloading or check D1 status."
