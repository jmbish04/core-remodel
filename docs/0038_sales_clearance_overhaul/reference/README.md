# Reference mockups (visual source-of-truth)

Justin provided two production-shaped React prototypes (mock data). They are the
visual + interaction reference for Phase E. Full source is preserved in the
preview-changelog `context` (raw transcript) for this slug.

- **`AISalesTrackerApp`** — stores view. Store logo header (+ `ShoppingBag`
  fallback), 3-up AI metric box (max discount / avg drop vs last week / items),
  status tags (Price Crash / Clearance Drop / Major Sale / Secret Promo), AI
  summary + top-highlights checklist, promo-code badge, external "Shop Store
  Clearance" link. Category filter pills (production replaces with store→drill).

- **`StoreSalesDetailApp`** — store detail. Back-to-stores, store banner + AI
  summary, sidebar filters (production moves these into a **right-side Sheet**),
  grouped/searchable item grid with `-N% OFF` badge, current vs last-week price
  (`tabular-nums`, strikethrough), stock tag, AI item note, favorite (→ Watch),
  buy-direct external link, empty-state with reset.

Production deltas from the mockups:
- Store→items single drill (category pills become facets/badges).
- Filters = right-side shadcn `Sheet`, opened by a filter button, only on the
  item view — NOT a persistent sidebar, NO main sidebar collapse.
- Swap raw Tailwind primitives for repo Base-UI shadcn primitives.
- `favorite` heart → real Watch list; add "Not interested".
- Item card adds brand + model + qty + condition + `deal_score`.
- Product modal (carousel + lightbox + all fields + external link + actions).
- Real data via `/api/showroom-sales/*`; image `onError` → fallback icon.
