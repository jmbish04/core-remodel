# PROMPT — 0034 Identity, Auth (Clerk) & RBAC

Implement `docs/0034_identity_auth_rbac/IMPLEMENTATION_PLAN.md`. Fresh worktree from `origin/main`.
**Load the Clerk skills first** (`clerk-setup`, `clerk-astro-patterns`, `clerk-backend-api`, `clerk-webhooks`) —
the Cloudflare-Workers-edge integration is the main risk.

## Non-negotiables
- **Clerk = authentication; D1 = authorization.** Clerk owns credentials/sessions; D1 holds a thin `users`
  mirror (`clerk_user_id`) + the RBAC graph so the domain can FK to a real `users.id`.
- **Extend the existing `auth/users` table, never rebuild it.** Add `clerk_user_id` + `user_type_id`; make
  `password_hash` nullable (deprecate).
- **RBAC = definition tables + mapping** (`user_types`, `permissions`, `user_type_permissions`) with
  admin-gated config pages + `is_active` soft-delete.
- **Never break the running admin gate.** Phase D dual-gates (legacy `remodel_access` cookie OR Clerk admin
  session) until every surface is migrated; do NOT rotate `WORKER_API_KEY` mid-migration.
- **No fabricated users.** D1 `db.batch` not `db.transaction`; migrations `db:generate` + `migrate:remote`;
  FK-adds = rebuild → back up + validate + read SQL.
- **Deploy is yours**; state deploy/migration/QC each turn.

## Phase A — Clerk foundation (PR-A)
1. `A1` Install `@clerk/astro` + `@clerk/backend`; **verify they run under the @astrojs/cloudflare (Workers
   edge) adapter** — a spike. If Clerk middleware assumes Node, fall back to `@clerk/backend` token
   verification + custom Astro middleware. Consult the Clerk skills.
2. `A2` Env/secrets: `CLERK_PUBLISHABLE_KEY` (public var), `CLERK_SECRET_KEY` + `CLERK_WEBHOOK_SIGNING_SECRET`
   (Worker secrets).
3. `A3` Sign-in / sign-up pages + session middleware; protected routes reject anonymous.
4. `A4` Extend `users` (`clerk_user_id` UNIQUE, `user_type_id`, `password_hash` nullable); `db:generate` +
   `migrate:remote`.
5. `A5` Svix-verified `POST /api/webhooks/clerk` upserting the `users` mirror on `user.created/updated/deleted`;
   session middleware lazily upserts on first authed request (webhook-lag fallback).
6. `A6` QC pr-A (sign-in works on the deployed Worker; user appears in mirror; anon rejected) + changelog.

## Phase B — RBAC (PR-B)
1. `B1` Schema: `user_types`, `permissions`, `user_type_permissions` (definition + mapping); `users.user_type_id` FK.
2. `B2` Seed roles (`homeowner`,`contractor`,`designer`,`admin`,`viewer`) + permission keys per protected surface.
3. `B3` `hasPermission(user, key)` helper (users→user_type→permissions join) + admin config pages
   `/admin/config/user-types` + `/permissions`.
4. `B4` QC pr-B + changelog.

## Phase C — device identity (PR-C)
1. `C1` `devices` table (`device_cookie_id` UNIQUE, `user_id` FK nullable, first/last seen, label).
2. `C2` Migrate `device_preferences.device_id` → FK `devices`; add `device_location.device_id` FK (forward-only).
3. `C3` On sign-in, bind the `remodel_device` cookie to the user's device row.
4. `C4` QC pr-C + changelog.

## Phase D — authz cutover (PR-D, the risky one)
1. `D1` Replace `SHA-256(WORKER_API_KEY)` `remodel_access` gate (`api/middleware/auth.ts`) with Clerk session +
   `admin` permission — **dual-gate** (accept either) transitionally.
2. `D2` Migrate every `remodel_access`-gated route; reconcile MCP OAuth principal → user; then retire the shared
   secret + drop the hand-rolled `sessions` table.
3. `D3` QC pr-D (every gated route accepts a Clerk admin session; legacy cookie still works until retirement;
   MCP unaffected) + changelog.

## Do NOT
- Rebuild the `users` table, store roles only in Clerk metadata (D1 is the authz source), rotate
  `WORKER_API_KEY` mid-migration, or drop the legacy gate before every surface is migrated. Multi-tenant/Orgs
  is deferred.
