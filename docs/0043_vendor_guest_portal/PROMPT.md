# 0043 — Vendor Guest Portal · Build Prompt

Build the Vendor Guest Portal for the `core-remodel` Worker. Read `IMPLEMENTATION_PLAN.md` and `DESIGN_SPEC.md` in this folder first. Ship one PR per phase, in order, each with a `scripts/qc/pr_<n>.mjs` and a changelog entry. Deploy previews and QC against both preview and prod per the repo rules.

## Ground rules (repo-specific)

- **Guest cookie ≠ homeowner cookie.** Create a `remodel_guest` identity cookie mapped to a `guest_contacts` row. It must grant NO access to any `/admin/*` page or homeowner-gated API. The gate only unlocks the portal + the already-public `/api/rooms/catalog` and `/api/rooms/code/:code/public`.
- D1 has no transactions → `db.batch()`; chunk unbounded inserts at 20 rows.
- Rich text (boilerplate, house summary) → store markdown + html (PlateJS). No currency, no multi-selects in this feature.
- FKs, never denormalized `*_name`. `resolved_showroom_id` is a nullable FK to `showroom_stores`.
- MCP tool: one file `tools/outreach/send_guest_invite.ts`, `WRITE`, Zod v4 inputShape, ≥1 example; barrel into the registry; verify the `/connect/tools` card.
- Email sends as **justin@126colby.com** via the existing `POST /api/gmail/compose` path; worker email is the fallback. Never send from an unverified identity.
- Custom domain `remodel.hacolby.app` in `wrangler.jsonc`; keep it OFF preview workers.

## Phase order

1. **P0** custom domain → 2. **P1** `GuestLayout` chrome-less shell → 3. **P2** `guest_contacts` + registration gate + cookie → 4. **P3** `guest_page_views` silent tracking → 5. **P4** boilerplate config → 6. **P5** `POST /api/guest/invite` + MCP `send_guest_invite` + `/welcome?t=` prefill + admin button → 7. **P6** `/admin/guests` → 8. **P7 (stretch)** glean showroom from website.

## Definition of done (per phase)

- Migration applied to remote + verified; QC green on preview AND prod; changelog entry + detail page with Mermaid; preview worker torn down after merge; D1 `plan_tasks` advanced (`in_progress` → `in_review` w/ PR → `done`).
- Security regression guard in every QC: a `remodel_guest` cookie must still get 401 on a homeowner/admin endpoint.
