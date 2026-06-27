# Project Vision & Constitution

> **AGENT INSTRUCTION:** Read this file before every iteration. It serves as the project's "Long-Term Memory."

## 1. Core Identity
* **Project Name:** Showroom & Materials Sourcing
* **Stitch Project ID:** 4bcb6df7-7ba2-4e1e-9d9d-adfe8faf5479
* **Mission:** Empower homeowner Marcus Vance to build, schedule, research, and purchase architectural materials for his SF home remodel while mapping and optimizing showroom visits across clustered Bay Area hubs.
* **Target Audience:** Marcus Vance (technical systems architect, detail-oriented modernist renovator).
* **Voice:** Confident, editorial, clinical, technical, and moody.

## 2. Visual Language
*Reference these descriptors when prompting Stitch.*

* **The "Vibe" (Adjectives):**
    * *Primary:* Monolith (dark-mode, ring/divider layout, high-contrast text)
    * *Secondary:* Editorial (Inter typography, asymmetrical heroes, wide spacing)
    * *Tertiary:* Technical (JetBrains Mono elements, tabular numbers, clear alert states)

## 3. Architecture & File Structure
* **Root:** `src/frontend/pages/` (Astro routes)
* **Rebuild Target:** React components in `src/frontend/components/` and Astro wrappers in `src/frontend/pages/`
* **Navigation Strategy:** Integrated sidebar navigator under a dedicated "Shopping Research" group, cross-linking materials and showroom viewports.

## 4. Live Sitemap (Current State)
*Update this when a new page is successfully merged.*

* [x] `materials.html` - Materials Schedule & Budget Dashboard (Visualizing allocated vs spent, listing materials grouped by room with active alert flags).
* [ ] `showrooms.html` - Showrooms Hub Directory & Sourcing Map (Filtering showrooms by price, hub, or specialty, displaying map markers, and linking to details).
* [ ] `showroom-viewport.html` - Showroom Profile & Notes (Address, contacts, rating selectors, wishlist quick-add, and timeline journals).
* [ ] `material-viewport.html` - Material Specs & AI Concierge (Qty, budget fields, uploaded specs, and research logs for compatibility/pricing).
* [ ] `scan-log.html` - Barcode Sync & Upload Audit (Recent barcode scans list, upload logs, VLM AI rationale, and offline storage queues).
* [x] `rooms/closets` - Closet Sourcing & Layout Explorer (Pre-seeded vendor comparison and interactive layout models).

## 5. The Roadmap (Backlog)
*Pick the next task from here if available.*

### High Priority
- [ ] Build `showrooms.html` (Showroom Directory & Sourcing Hub Map)
- [ ] Build `material-viewport.html` (Material detail view with AI research, warnings, and clearances)
- [ ] Build `showroom-viewport.html` (Showroom detail profile, notes, ratings)
- [ ] Build `scan-log.html` (Scan History & Sync panel)

### Medium Priority
- [ ] Connect materials lists to existing `BudgetAgent` DO for real-time cost updates.
- [ ] Connect showroom research trigger to `ShowroomResearchAgent` DO via `/api/showroom-stores` hono route.

## 6. Creative Freedom Guidelines
1. **Stay On-Brand:** Always design with the HSL(240 10% 4%) near-black background and HSL(0 0% 98%) near-white foreground. Never use pure `#000000` or standard borders.
2. **Tabular Numerals:** Always apply monospaced text to prices, quantities, and numeric ratings.
3. **No Placeholders:** If a page needs image mockups, use real architectural photography references or clean vector drafts.

## 7. Rules of Engagement
1. Do not recreate pages in Section 4.
2. Always update `next-prompt.md` before completing.
3. Consume roadmap items in Section 5 when you build them.
