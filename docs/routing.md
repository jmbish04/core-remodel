# Routing

[← Back to Index](./README.md)

This project uses Astro's file-based routing. The routes below map the URL path to the corresponding `.astro` component located in `src/frontend/pages/`.

## Route Table

- **`/`** -> rendered by `src/frontend/pages/index.astro`
- **`/access`** -> rendered by `src/frontend/pages/access.astro`
- **`/admin/alerts`** -> rendered by `src/frontend/pages/admin/alerts.astro`
- **`/admin/bids/new`** -> rendered by `src/frontend/pages/admin/bids/new.astro`
- **`/admin/bids`** -> rendered by `src/frontend/pages/admin/bids.astro`
- **`/admin/budget/dashboard`** -> rendered by `src/frontend/pages/admin/budget/dashboard.astro`
- **`/admin/budget/reconciliation`** -> rendered by `src/frontend/pages/admin/budget/reconciliation.astro`
- **`/admin/budget/tracker`** -> rendered by `src/frontend/pages/admin/budget/tracker.astro`
- **`/admin/budget/truth-table`** -> rendered by `src/frontend/pages/admin/budget/truth-table.astro`
- **`/admin/builder`** -> rendered by `src/frontend/pages/admin/builder.astro`
- **`/admin/changelog/[slug]/slides`** -> rendered by `src/frontend/pages/admin/changelog/[slug]/slides.astro`
- **`/admin/changelog/[slug]`** -> rendered by `src/frontend/pages/admin/changelog/[slug].astro`
- **`/admin/changelog/blocks`** -> rendered by `src/frontend/pages/admin/changelog/blocks.astro`
- **`/admin/changelog/preview/[slug]/slides`** -> rendered by `src/frontend/pages/admin/changelog/preview/[slug]/slides.astro`
- **`/admin/changelog/preview/[slug]`** -> rendered by `src/frontend/pages/admin/changelog/preview/[slug].astro`
- **`/admin/changelog/preview`** -> rendered by `src/frontend/pages/admin/changelog/preview/index.astro`
- **`/admin/changelog`** -> rendered by `src/frontend/pages/admin/changelog.astro`
- **`/admin/companies/[id]`** -> rendered by `src/frontend/pages/admin/companies/[id].astro`
- **`/admin/companies`** -> rendered by `src/frontend/pages/admin/companies/index.astro`
- **`/admin/config/address`** -> rendered by `src/frontend/pages/admin/config/address.astro`
- **`/admin/config/brands/types`** -> rendered by `src/frontend/pages/admin/config/brands/types.astro`
- **`/admin/config/device`** -> rendered by `src/frontend/pages/admin/config/device.astro`
- **`/admin/config/integrations/tesla`** -> rendered by `src/frontend/pages/admin/config/integrations/tesla.astro`
- **`/admin/config/photo/categories`** -> rendered by `src/frontend/pages/admin/config/photo/categories.astro`
- **`/admin/config/photo/colors`** -> rendered by `src/frontend/pages/admin/config/photo/colors.astro`
- **`/admin/config/photo/subcategories`** -> rendered by `src/frontend/pages/admin/config/photo/subcategories.astro`
- **`/admin/config/showroom/store-types`** -> rendered by `src/frontend/pages/admin/config/showroom/store-types.astro`
- **`/admin/config/tax`** -> rendered by `src/frontend/pages/admin/config/tax.astro`
- **`/admin/config/tesla`** -> rendered by `src/frontend/pages/admin/config/tesla.astro`
- **`/admin/config/usage`** -> rendered by `src/frontend/pages/admin/config/usage.astro`
- **`/admin/config`** -> rendered by `src/frontend/pages/admin/config.astro`
- **`/admin/contracts`** -> rendered by `src/frontend/pages/admin/contracts.astro`
- **`/admin/designs/decision-room`** -> rendered by `src/frontend/pages/admin/designs/decision-room.astro`
- **`/admin/designs/floorplan-regions`** -> rendered by `src/frontend/pages/admin/designs/floorplan-regions.astro`
- **`/admin/designs/furnishings`** -> rendered by `src/frontend/pages/admin/designs/furnishings.astro`
- **`/admin/designs/moodboards/[slug]`** -> rendered by `src/frontend/pages/admin/designs/moodboards/[slug].astro`
- **`/admin/designs/moodboards`** -> rendered by `src/frontend/pages/admin/designs/moodboards.astro`
- **`/admin/designs/workshop`** -> rendered by `src/frontend/pages/admin/designs/workshop.astro`
- **`/admin/dialer`** -> rendered by `src/frontend/pages/admin/dialer.astro`
- **`/admin/docs/views`** -> rendered by `src/frontend/pages/admin/docs/views.astro`
- **`/admin/docs`** -> rendered by `src/frontend/pages/admin/docs/index.astro`
- **`/admin/estimates/new`** -> rendered by `src/frontend/pages/admin/estimates/new.astro`
- **`/admin/estimates`** -> rendered by `src/frontend/pages/admin/estimates.astro`
- **`/admin/gallery`** -> rendered by `src/frontend/pages/admin/gallery.astro`
- **`/admin/inbox/all`** -> rendered by `src/frontend/pages/admin/inbox/all.astro`
- **`/admin/inbox/gmail`** -> rendered by `src/frontend/pages/admin/inbox/gmail.astro`
- **`/admin/inbox`** -> rendered by `src/frontend/pages/admin/inbox.astro`
- **`/admin/integrations/usage`** -> rendered by `src/frontend/pages/admin/integrations/usage.astro`
- **`/admin/mcp-ops/[...path]`** -> rendered by `src/frontend/pages/admin/mcp-ops/[...path].astro`
- **`/admin/mcp-ops`** -> rendered by `src/frontend/pages/admin/mcp-ops.astro`
- **`/admin/measurements`** -> rendered by `src/frontend/pages/admin/measurements.astro`
- **`/admin/notes/edit`** -> rendered by `src/frontend/pages/admin/notes/edit.astro`
- **`/admin/pascal/[projectId]`** -> rendered by `src/frontend/pages/admin/pascal/[projectId].astro`
- **`/admin/pascal`** -> rendered by `src/frontend/pages/admin/pascal/index.astro`
- **`/admin/permits/[permitIdentifier]`** -> rendered by `src/frontend/pages/admin/permits/[permitIdentifier].astro`
- **`/admin/permits/contacts`** -> rendered by `src/frontend/pages/admin/permits/contacts.astro`
- **`/admin/permits`** -> rendered by `src/frontend/pages/admin/permits.astro`
- **`/admin/photo-edits`** -> rendered by `src/frontend/pages/admin/photo-edits.astro`
- **`/admin/plan/3d`** -> rendered by `src/frontend/pages/admin/plan/3d.astro`
- **`/admin/planning/measure`** -> rendered by `src/frontend/pages/admin/planning/measure.astro`
- **`/admin/planning/research/[id]`** -> rendered by `src/frontend/pages/admin/planning/research/[id].astro`
- **`/admin/planning/research`** -> rendered by `src/frontend/pages/admin/planning/research.astro`
- **`/admin/plans/[slug]`** -> rendered by `src/frontend/pages/admin/plans/[slug].astro`
- **`/admin/plans`** -> rendered by `src/frontend/pages/admin/plans/index.astro`
- **`/admin/pmo/components`** -> rendered by `src/frontend/pages/admin/pmo/components.astro`
- **`/admin/pmo/operations`** -> rendered by `src/frontend/pages/admin/pmo/operations.astro`
- **`/admin/pmo/schedule/contractor`** -> rendered by `src/frontend/pages/admin/pmo/schedule/contractor.astro`
- **`/admin/prepare/blank-canvas/[...tab]`** -> rendered by `src/frontend/pages/admin/prepare/blank-canvas/[...tab].astro`
- **`/admin/prepare/review`** -> rendered by `src/frontend/pages/admin/prepare/review.astro`
- **`/admin/prepare/uploads`** -> rendered by `src/frontend/pages/admin/prepare/uploads.astro`
- **`/admin/products/[id]`** -> rendered by `src/frontend/pages/admin/products/[id].astro`
- **`/admin/products`** -> rendered by `src/frontend/pages/admin/products/index.astro`
- **`/admin/services`** -> rendered by `src/frontend/pages/admin/services.astro`
- **`/admin/shopping/brands/[brandId]`** -> rendered by `src/frontend/pages/admin/shopping/brands/[brandId].astro`
- **`/admin/shopping/brands`** -> rendered by `src/frontend/pages/admin/shopping/brands/index.astro`
- **`/admin/shopping/closets`** -> rendered by `src/frontend/pages/admin/shopping/closets.astro`
- **`/admin/shopping/compare`** -> rendered by `src/frontend/pages/admin/shopping/compare.astro`
- **`/admin/shopping/contacts`** -> rendered by `src/frontend/pages/admin/shopping/contacts.astro`
- **`/admin/shopping/drives/[slug]`** -> rendered by `src/frontend/pages/admin/shopping/drives/[slug].astro`
- **`/admin/shopping/drives`** -> rendered by `src/frontend/pages/admin/shopping/drives/index.astro`
- **`/admin/shopping/gaps`** -> rendered by `src/frontend/pages/admin/shopping/gaps.astro`
- **`/admin/shopping/intake`** -> rendered by `src/frontend/pages/admin/shopping/intake.astro`
- **`/admin/shopping/journal`** -> rendered by `src/frontend/pages/admin/shopping/journal.astro`
- **`/admin/shopping/material/[id]`** -> rendered by `src/frontend/pages/admin/shopping/material/[id].astro`
- **`/admin/shopping/photo-intake`** -> rendered by `src/frontend/pages/admin/shopping/photo-intake.astro`
- **`/admin/shopping/photo-review`** -> rendered by `src/frontend/pages/admin/shopping/photo-review.astro`
- **`/admin/shopping/product-photo-hitl`** -> rendered by `src/frontend/pages/admin/shopping/product-photo-hitl.astro`
- **`/admin/shopping/product/[id]`** -> rendered by `src/frontend/pages/admin/shopping/product/[id].astro`
- **`/admin/shopping/products`** -> rendered by `src/frontend/pages/admin/shopping/products.astro`
- **`/admin/shopping/progress`** -> rendered by `src/frontend/pages/admin/shopping/progress.astro`
- **`/admin/shopping/receipt-review`** -> rendered by `src/frontend/pages/admin/shopping/receipt-review.astro`
- **`/admin/shopping/research/[id]`** -> rendered by `src/frontend/pages/admin/shopping/research/[id].astro`
- **`/admin/shopping/research`** -> rendered by `src/frontend/pages/admin/shopping/research.astro`
- **`/admin/shopping/sales`** -> rendered by `src/frontend/pages/admin/shopping/sales.astro`
- **`/admin/shopping/scan`** -> rendered by `src/frontend/pages/admin/shopping/scan.astro`
- **`/admin/shopping/schedule`** -> rendered by `src/frontend/pages/admin/shopping/schedule.astro`
- **`/admin/shopping/showrooms/[tab]`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/[tab].astro`
- **`/admin/shopping/showrooms/exclusions`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/exclusions.astro`
- **`/admin/shopping/showrooms/finder/[slug]`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/finder/[slug].astro`
- **`/admin/shopping/showrooms/finder`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/finder.astro`
- **`/admin/shopping/showrooms/hitl`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/hitl.astro`
- **`/admin/shopping/showrooms/visitlogs/[id]`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/visitlogs/[id].astro`
- **`/admin/shopping/showrooms/visitlogs/new`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/visitlogs/new.astro`
- **`/admin/shopping/showrooms/visitlogs`** -> rendered by `src/frontend/pages/admin/shopping/showrooms/visitlogs.astro`
- **`/admin/shopping/showrooms`** -> rendered by `src/frontend/pages/admin/shopping/showrooms.astro`
- **`/admin/shopping/sourcing`** -> rendered by `src/frontend/pages/admin/shopping/sourcing.astro`
- **`/admin/shopping/store/[id]/[section]`** -> rendered by `src/frontend/pages/admin/shopping/store/[id]/[section].astro`
- **`/admin/shopping/store/[id]/inbox`** -> rendered by `src/frontend/pages/admin/shopping/store/[id]/inbox.astro`
- **`/admin/shopping/store/[id]`** -> rendered by `src/frontend/pages/admin/shopping/store/[id].astro`
- **`/admin/shopping/wishlist`** -> rendered by `src/frontend/pages/admin/shopping/wishlist.astro`
- **`/admin/shopping`** -> rendered by `src/frontend/pages/admin/shopping.astro`
- **`/admin/showrooms/[id]/brands/[brandId]`** -> rendered by `src/frontend/pages/admin/showrooms/[id]/brands/[brandId].astro`
- **`/admin/studio/[slug]`** -> rendered by `src/frontend/pages/admin/studio/[slug].astro`
- **`/admin/studio`** -> rendered by `src/frontend/pages/admin/studio.astro`
- **`/admin/supporting-docs`** -> rendered by `src/frontend/pages/admin/supporting-docs.astro`
- **`/admin/system/agents/failed`** -> rendered by `src/frontend/pages/admin/system/agents/failed.astro`
- **`/admin/system/agents/queue/[id]`** -> rendered by `src/frontend/pages/admin/system/agents/queue/[id].astro`
- **`/admin/system/agents/queue`** -> rendered by `src/frontend/pages/admin/system/agents/queue.astro`
- **`/admin/system/agents/usage`** -> rendered by `src/frontend/pages/admin/system/agents/usage.astro`
- **`/admin/system/audit/[serviceSlug]`** -> rendered by `src/frontend/pages/admin/system/audit/[serviceSlug].astro`
- **`/admin/system/audit`** -> rendered by `src/frontend/pages/admin/system/audit/index.astro`
- **`/admin/system/health`** -> rendered by `src/frontend/pages/admin/system/health.astro`
- **`/admin/system/integration/usage`** -> rendered by `src/frontend/pages/admin/system/integration/usage.astro`
- **`/admin/system/logs/[serviceSlug]`** -> rendered by `src/frontend/pages/admin/system/logs/[serviceSlug].astro`
- **`/admin/system/logs`** -> rendered by `src/frontend/pages/admin/system/logs/index.astro`
- **`/admin/tasks`** -> rendered by `src/frontend/pages/admin/tasks.astro`
- **`/admin`** -> rendered by `src/frontend/pages/admin.astro`
- **`/bid/[token]`** -> rendered by `src/frontend/pages/bid/[token].astro`
- **`/connect/tools`** -> rendered by `src/frontend/pages/connect/tools.astro`
- **`/connect`** -> rendered by `src/frontend/pages/connect/index.astro`
- **`/docs/[id]`** -> rendered by `src/frontend/pages/docs/[id].astro`
- **`/docs/view/[slug]`** -> rendered by `src/frontend/pages/docs/view/[slug].astro`
- **`/docs`** -> rendered by `src/frontend/pages/docs/index.astro`
- **`/floor-plan`** -> rendered by `src/frontend/pages/floor-plan.astro`
- **`/kitchen-layout`** -> rendered by `src/frontend/pages/kitchen-layout.astro`
- **`/log/daily`** -> rendered by `src/frontend/pages/log/daily.astro`
- **`/log/weekly`** -> rendered by `src/frontend/pages/log/weekly.astro`
- **`/moodboards`** -> rendered by `src/frontend/pages/moodboards.astro`
- **`/photos/inspiration`** -> rendered by `src/frontend/pages/photos/inspiration.astro`
- **`/photos/listing`** -> rendered by `src/frontend/pages/photos/listing.astro`
- **`/questionnaire/[section_slug]`** -> rendered by `src/frontend/pages/questionnaire/[section_slug].astro`
- **`/questionnaire/print`** -> rendered by `src/frontend/pages/questionnaire/print.astro`
- **`/questionnaire`** -> rendered by `src/frontend/pages/questionnaire/index.astro`
- **`/rooms/[slug]`** -> rendered by `src/frontend/pages/rooms/[slug].astro`
- **`/rooms/beta/[slug]`** -> rendered by `src/frontend/pages/rooms/beta/[slug].astro`
- **`/sitemap`** -> rendered by `src/frontend/pages/sitemap.astro`
- **`/studio-runtime`** -> rendered by `src/frontend/pages/studio-runtime.astro`
- **`/supporting-docs`** -> rendered by `src/frontend/pages/supporting-docs.astro`
[Return to Index](README.md)

This project uses **Astro file-based routing**. Pages are defined in the `src/frontend/pages` directory. The file path dictates the URL route.

## Route Table

| Route Path | Component File | Guards/Loaders |
| --- | --- | --- |
| / | src/frontend/pages/index.astro | None (Astro Frontmatter) |
| /access | src/frontend/pages/access.astro | None (Astro Frontmatter) |
| /admin | src/frontend/pages/admin.astro | None (Astro Frontmatter) |
| /admin/alerts | src/frontend/pages/admin/alerts.astro | None (Astro Frontmatter) |
| /admin/bids | src/frontend/pages/admin/bids.astro | None (Astro Frontmatter) |
| /admin/bids/new | src/frontend/pages/admin/bids/new.astro | None (Astro Frontmatter) |
| /admin/budget/dashboard | src/frontend/pages/admin/budget/dashboard.astro | None (Astro Frontmatter) |
| /admin/budget/reconciliation | src/frontend/pages/admin/budget/reconciliation.astro | None (Astro Frontmatter) |
| /admin/budget/tracker | src/frontend/pages/admin/budget/tracker.astro | None (Astro Frontmatter) |
| /admin/budget/truth-table | src/frontend/pages/admin/budget/truth-table.astro | None (Astro Frontmatter) |
| /admin/builder | src/frontend/pages/admin/builder.astro | None (Astro Frontmatter) |
| /admin/changelog | src/frontend/pages/admin/changelog.astro | None (Astro Frontmatter) |
| /admin/changelog/[slug] | src/frontend/pages/admin/changelog/[slug].astro | None (Astro Frontmatter) |
| /admin/changelog/[slug]/slides | src/frontend/pages/admin/changelog/[slug]/slides.astro | None (Astro Frontmatter) |
| /admin/changelog/blocks | src/frontend/pages/admin/changelog/blocks.astro | None (Astro Frontmatter) |
| /admin/changelog/preview | src/frontend/pages/admin/changelog/preview/index.astro | None (Astro Frontmatter) |
| /admin/changelog/preview/[slug] | src/frontend/pages/admin/changelog/preview/[slug].astro | None (Astro Frontmatter) |
| /admin/changelog/preview/[slug]/slides | src/frontend/pages/admin/changelog/preview/[slug]/slides.astro | None (Astro Frontmatter) |
| /admin/companies | src/frontend/pages/admin/companies/index.astro | None (Astro Frontmatter) |
| /admin/companies/[id] | src/frontend/pages/admin/companies/[id].astro | None (Astro Frontmatter) |
| /admin/config | src/frontend/pages/admin/config.astro | None (Astro Frontmatter) |
| /admin/config/address | src/frontend/pages/admin/config/address.astro | None (Astro Frontmatter) |
| /admin/config/brands/types | src/frontend/pages/admin/config/brands/types.astro | None (Astro Frontmatter) |
| /admin/config/device | src/frontend/pages/admin/config/device.astro | None (Astro Frontmatter) |
| /admin/config/integrations/tesla | src/frontend/pages/admin/config/integrations/tesla.astro | None (Astro Frontmatter) |
| /admin/config/photo/categories | src/frontend/pages/admin/config/photo/categories.astro | None (Astro Frontmatter) |
| /admin/config/photo/colors | src/frontend/pages/admin/config/photo/colors.astro | None (Astro Frontmatter) |
| /admin/config/photo/subcategories | src/frontend/pages/admin/config/photo/subcategories.astro | None (Astro Frontmatter) |
| /admin/config/showroom/store-types | src/frontend/pages/admin/config/showroom/store-types.astro | None (Astro Frontmatter) |
| /admin/config/tax | src/frontend/pages/admin/config/tax.astro | None (Astro Frontmatter) |
| /admin/config/tesla | src/frontend/pages/admin/config/tesla.astro | None (Astro Frontmatter) |
| /admin/config/usage | src/frontend/pages/admin/config/usage.astro | None (Astro Frontmatter) |
| /admin/contracts | src/frontend/pages/admin/contracts.astro | None (Astro Frontmatter) |
| /admin/designs/decision-room | src/frontend/pages/admin/designs/decision-room.astro | None (Astro Frontmatter) |
| /admin/designs/floorplan-regions | src/frontend/pages/admin/designs/floorplan-regions.astro | None (Astro Frontmatter) |
| /admin/designs/furnishings | src/frontend/pages/admin/designs/furnishings.astro | None (Astro Frontmatter) |
| /admin/designs/moodboards | src/frontend/pages/admin/designs/moodboards.astro | None (Astro Frontmatter) |
| /admin/designs/moodboards/[slug] | src/frontend/pages/admin/designs/moodboards/[slug].astro | None (Astro Frontmatter) |
| /admin/designs/workshop | src/frontend/pages/admin/designs/workshop.astro | None (Astro Frontmatter) |
| /admin/dialer | src/frontend/pages/admin/dialer.astro | None (Astro Frontmatter) |
| /admin/docs | src/frontend/pages/admin/docs/index.astro | None (Astro Frontmatter) |
| /admin/docs/views | src/frontend/pages/admin/docs/views.astro | None (Astro Frontmatter) |
| /admin/estimates | src/frontend/pages/admin/estimates.astro | None (Astro Frontmatter) |
| /admin/estimates/new | src/frontend/pages/admin/estimates/new.astro | None (Astro Frontmatter) |
| /admin/gallery | src/frontend/pages/admin/gallery.astro | None (Astro Frontmatter) |
| /admin/inbox | src/frontend/pages/admin/inbox.astro | None (Astro Frontmatter) |
| /admin/inbox/all | src/frontend/pages/admin/inbox/all.astro | None (Astro Frontmatter) |
| /admin/inbox/gmail | src/frontend/pages/admin/inbox/gmail.astro | None (Astro Frontmatter) |
| /admin/integrations/usage | src/frontend/pages/admin/integrations/usage.astro | None (Astro Frontmatter) |
| /admin/mcp-ops | src/frontend/pages/admin/mcp-ops.astro | None (Astro Frontmatter) |
| /admin/mcp-ops/[...path] | src/frontend/pages/admin/mcp-ops/[...path].astro | None (Astro Frontmatter) |
| /admin/measurements | src/frontend/pages/admin/measurements.astro | None (Astro Frontmatter) |
| /admin/notes/edit | src/frontend/pages/admin/notes/edit.astro | None (Astro Frontmatter) |
| /admin/pascal | src/frontend/pages/admin/pascal/index.astro | None (Astro Frontmatter) |
| /admin/pascal/[projectId] | src/frontend/pages/admin/pascal/[projectId].astro | None (Astro Frontmatter) |
| /admin/permits | src/frontend/pages/admin/permits.astro | None (Astro Frontmatter) |
| /admin/permits/[permitIdentifier] | src/frontend/pages/admin/permits/[permitIdentifier].astro | None (Astro Frontmatter) |
| /admin/permits/contacts | src/frontend/pages/admin/permits/contacts.astro | None (Astro Frontmatter) |
| /admin/photo-edits | src/frontend/pages/admin/photo-edits.astro | None (Astro Frontmatter) |
| /admin/plan/3d | src/frontend/pages/admin/plan/3d.astro | None (Astro Frontmatter) |
| /admin/planning/measure | src/frontend/pages/admin/planning/measure.astro | None (Astro Frontmatter) |
| /admin/planning/research | src/frontend/pages/admin/planning/research.astro | None (Astro Frontmatter) |
| /admin/planning/research/[id] | src/frontend/pages/admin/planning/research/[id].astro | None (Astro Frontmatter) |
| /admin/plans | src/frontend/pages/admin/plans/index.astro | None (Astro Frontmatter) |
| /admin/plans/[slug] | src/frontend/pages/admin/plans/[slug].astro | None (Astro Frontmatter) |
| /admin/pmo/components | src/frontend/pages/admin/pmo/components.astro | None (Astro Frontmatter) |
| /admin/pmo/operations | src/frontend/pages/admin/pmo/operations.astro | None (Astro Frontmatter) |
| /admin/pmo/schedule/contractor | src/frontend/pages/admin/pmo/schedule/contractor.astro | None (Astro Frontmatter) |
| /admin/prepare/blank-canvas/[...tab] | src/frontend/pages/admin/prepare/blank-canvas/[...tab].astro | None (Astro Frontmatter) |
| /admin/prepare/review | src/frontend/pages/admin/prepare/review.astro | None (Astro Frontmatter) |
| /admin/prepare/uploads | src/frontend/pages/admin/prepare/uploads.astro | None (Astro Frontmatter) |
| /admin/products | src/frontend/pages/admin/products/index.astro | None (Astro Frontmatter) |
| /admin/products/[id] | src/frontend/pages/admin/products/[id].astro | None (Astro Frontmatter) |
| /admin/services | src/frontend/pages/admin/services.astro | None (Astro Frontmatter) |
| /admin/shopping | src/frontend/pages/admin/shopping.astro | None (Astro Frontmatter) |
| /admin/shopping/brands | src/frontend/pages/admin/shopping/brands/index.astro | None (Astro Frontmatter) |
| /admin/shopping/brands/[brandId] | src/frontend/pages/admin/shopping/brands/[brandId].astro | None (Astro Frontmatter) |
| /admin/shopping/closets | src/frontend/pages/admin/shopping/closets.astro | None (Astro Frontmatter) |
| /admin/shopping/compare | src/frontend/pages/admin/shopping/compare.astro | None (Astro Frontmatter) |
| /admin/shopping/contacts | src/frontend/pages/admin/shopping/contacts.astro | None (Astro Frontmatter) |
| /admin/shopping/drives | src/frontend/pages/admin/shopping/drives/index.astro | None (Astro Frontmatter) |
| /admin/shopping/drives/[slug] | src/frontend/pages/admin/shopping/drives/[slug].astro | None (Astro Frontmatter) |
| /admin/shopping/gaps | src/frontend/pages/admin/shopping/gaps.astro | None (Astro Frontmatter) |
| /admin/shopping/intake | src/frontend/pages/admin/shopping/intake.astro | None (Astro Frontmatter) |
| /admin/shopping/journal | src/frontend/pages/admin/shopping/journal.astro | None (Astro Frontmatter) |
| /admin/shopping/material/[id] | src/frontend/pages/admin/shopping/material/[id].astro | None (Astro Frontmatter) |
| /admin/shopping/photo-intake | src/frontend/pages/admin/shopping/photo-intake.astro | None (Astro Frontmatter) |
| /admin/shopping/photo-review | src/frontend/pages/admin/shopping/photo-review.astro | None (Astro Frontmatter) |
| /admin/shopping/product-photo-hitl | src/frontend/pages/admin/shopping/product-photo-hitl.astro | None (Astro Frontmatter) |
| /admin/shopping/product/[id] | src/frontend/pages/admin/shopping/product/[id].astro | None (Astro Frontmatter) |
| /admin/shopping/products | src/frontend/pages/admin/shopping/products.astro | None (Astro Frontmatter) |
| /admin/shopping/progress | src/frontend/pages/admin/shopping/progress.astro | None (Astro Frontmatter) |
| /admin/shopping/receipt-review | src/frontend/pages/admin/shopping/receipt-review.astro | None (Astro Frontmatter) |
| /admin/shopping/research | src/frontend/pages/admin/shopping/research.astro | None (Astro Frontmatter) |
| /admin/shopping/research/[id] | src/frontend/pages/admin/shopping/research/[id].astro | None (Astro Frontmatter) |
| /admin/shopping/sales | src/frontend/pages/admin/shopping/sales.astro | None (Astro Frontmatter) |
| /admin/shopping/scan | src/frontend/pages/admin/shopping/scan.astro | None (Astro Frontmatter) |
| /admin/shopping/schedule | src/frontend/pages/admin/shopping/schedule.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms | src/frontend/pages/admin/shopping/showrooms.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/[tab] | src/frontend/pages/admin/shopping/showrooms/[tab].astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/exclusions | src/frontend/pages/admin/shopping/showrooms/exclusions.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/finder | src/frontend/pages/admin/shopping/showrooms/finder.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/finder/[slug] | src/frontend/pages/admin/shopping/showrooms/finder/[slug].astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/hitl | src/frontend/pages/admin/shopping/showrooms/hitl.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/visitlogs | src/frontend/pages/admin/shopping/showrooms/visitlogs.astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/visitlogs/[id] | src/frontend/pages/admin/shopping/showrooms/visitlogs/[id].astro | None (Astro Frontmatter) |
| /admin/shopping/showrooms/visitlogs/new | src/frontend/pages/admin/shopping/showrooms/visitlogs/new.astro | None (Astro Frontmatter) |
| /admin/shopping/sourcing | src/frontend/pages/admin/shopping/sourcing.astro | None (Astro Frontmatter) |
| /admin/shopping/store/[id] | src/frontend/pages/admin/shopping/store/[id].astro | None (Astro Frontmatter) |
| /admin/shopping/store/[id]/[section] | src/frontend/pages/admin/shopping/store/[id]/[section].astro | None (Astro Frontmatter) |
| /admin/shopping/store/[id]/inbox | src/frontend/pages/admin/shopping/store/[id]/inbox.astro | None (Astro Frontmatter) |
| /admin/shopping/wishlist | src/frontend/pages/admin/shopping/wishlist.astro | None (Astro Frontmatter) |
| /admin/showrooms/[id]/brands/[brandId] | src/frontend/pages/admin/showrooms/[id]/brands/[brandId].astro | None (Astro Frontmatter) |
| /admin/studio | src/frontend/pages/admin/studio.astro | None (Astro Frontmatter) |
| /admin/studio/[slug] | src/frontend/pages/admin/studio/[slug].astro | None (Astro Frontmatter) |
| /admin/supporting-docs | src/frontend/pages/admin/supporting-docs.astro | None (Astro Frontmatter) |
| /admin/system/agents/failed | src/frontend/pages/admin/system/agents/failed.astro | None (Astro Frontmatter) |
| /admin/system/agents/queue | src/frontend/pages/admin/system/agents/queue.astro | None (Astro Frontmatter) |
| /admin/system/agents/queue/[id] | src/frontend/pages/admin/system/agents/queue/[id].astro | None (Astro Frontmatter) |
| /admin/system/agents/usage | src/frontend/pages/admin/system/agents/usage.astro | None (Astro Frontmatter) |
| /admin/system/audit | src/frontend/pages/admin/system/audit/index.astro | None (Astro Frontmatter) |
| /admin/system/audit/[serviceSlug] | src/frontend/pages/admin/system/audit/[serviceSlug].astro | None (Astro Frontmatter) |
| /admin/system/health | src/frontend/pages/admin/system/health.astro | None (Astro Frontmatter) |
| /admin/system/integration/usage | src/frontend/pages/admin/system/integration/usage.astro | None (Astro Frontmatter) |
| /admin/system/logs | src/frontend/pages/admin/system/logs/index.astro | None (Astro Frontmatter) |
| /admin/system/logs/[serviceSlug] | src/frontend/pages/admin/system/logs/[serviceSlug].astro | None (Astro Frontmatter) |
| /admin/tasks | src/frontend/pages/admin/tasks.astro | None (Astro Frontmatter) |
| /bid/[token] | src/frontend/pages/bid/[token].astro | None (Astro Frontmatter) |
| /connect | src/frontend/pages/connect/index.astro | None (Astro Frontmatter) |
| /connect/tools | src/frontend/pages/connect/tools.astro | None (Astro Frontmatter) |
| /docs | src/frontend/pages/docs/index.astro | None (Astro Frontmatter) |
| /docs/[id] | src/frontend/pages/docs/[id].astro | None (Astro Frontmatter) |
| /docs/view/[slug] | src/frontend/pages/docs/view/[slug].astro | None (Astro Frontmatter) |
| /floor-plan | src/frontend/pages/floor-plan.astro | None (Astro Frontmatter) |
| /kitchen-layout | src/frontend/pages/kitchen-layout.astro | None (Astro Frontmatter) |
| /log/daily | src/frontend/pages/log/daily.astro | None (Astro Frontmatter) |
| /log/weekly | src/frontend/pages/log/weekly.astro | None (Astro Frontmatter) |
| /moodboards | src/frontend/pages/moodboards.astro | None (Astro Frontmatter) |
| /photos/inspiration | src/frontend/pages/photos/inspiration.astro | None (Astro Frontmatter) |
| /photos/listing | src/frontend/pages/photos/listing.astro | None (Astro Frontmatter) |
| /questionnaire | src/frontend/pages/questionnaire/index.astro | None (Astro Frontmatter) |
| /questionnaire/[section_slug] | src/frontend/pages/questionnaire/[section_slug].astro | None (Astro Frontmatter) |
| /questionnaire/print | src/frontend/pages/questionnaire/print.astro | None (Astro Frontmatter) |
| /rooms/[slug] | src/frontend/pages/rooms/[slug].astro | None (Astro Frontmatter) |
| /rooms/beta/[slug] | src/frontend/pages/rooms/beta/[slug].astro | None (Astro Frontmatter) |
| /sitemap | src/frontend/pages/sitemap.astro | None (Astro Frontmatter) |
| /studio-runtime | src/frontend/pages/studio-runtime.astro | None (Astro Frontmatter) |
| /supporting-docs | src/frontend/pages/supporting-docs.astro | None (Astro Frontmatter) |
