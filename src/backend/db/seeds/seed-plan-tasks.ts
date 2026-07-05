/**
 * @fileoverview Canonical seed for the `/admin/plans` roadmap tracker.
 *
 * This is the SINGLE SOURCE OF TRUTH for the plans + tasks shown at `/admin/plans`.
 * It is mirrored (by hand) into each initiative's docs folder TASKS.json.
 *
 * Seeding is idempotent: plans upsert by `slug`, tasks insert by the unique
 * `(planSlug, taskKey)` index with `onConflictDoNothing`, so re-running never
 * duplicates and never clobbers a task's live `status`/`notes` (those are owned
 * by future sessions via `PATCH /api/admin/plans/tasks/:id`). To force-refresh a
 * task's static fields, bump its content and delete the row first, or add a new key.
 *
 * Roadmap detail lives in `docs/0013_link_cleanup/` (ROADMAP/SITEMAP/OPEN_QUESTIONS
 * + specs/). The other initiatives (0009–0014) are seeded as their own plans with
 * high-level tasks that point back to their source docs.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";

import { plans, planTasks } from "@backend/db/schema/plans/index";
import type { PlanInsert, PlanTaskInsert } from "@backend/db/schema/plans/index";

type SeedTask = Omit<PlanTaskInsert, "createdAt" | "updatedAt">;

// ─── Plans (one per docs/00NN_* initiative) ──────────────────────────────────

const PLANS: PlanInsert[] = [
  { slug: "0013_link_cleanup", title: "Site/URL cleanup + two-viewport IA", description: "Full information-architecture redesign: public/admin viewport split, admin namespace reorg, documents system, design suite, companies CRM, brands/products, bids/budget, floor/room routing.", docPath: "docs/0013_link_cleanup", status: "active", sortOrder: 0 },
  { slug: "0009_clickup_taskmanagement", title: "ClickUp Integration + AI Orchestrator", description: "ClickUp-backed PMO mirrored into our own D1 (ClickUp as fallback) + AI orchestrator agent.", docPath: "docs/0009_clickup_taskmanagement", status: "planning", sortOrder: 9 },
  { slug: "0010_gallery_search", title: "Gallery Search + Saved Searches + Canvas Editor", description: "Gallery search, saved searches, and Gemini canvas-editor refinements.", docPath: "docs/0010_gallery_search", status: "planning", sortOrder: 10 },
  { slug: "0011_photo_editing", title: "Photo Edit Sessions — UX Overhaul", description: "Complete UX overhaul of the photo edit sessions surface.", docPath: "docs/0011_photo_editing", status: "planning", sortOrder: 11 },
  { slug: "0012_contractor_activity_map", title: "Contractor Activity Map", description: "Contractor activity map spec + tasks.", docPath: "docs/0012_contractor-activity-map", status: "planning", sortOrder: 12 },
  { slug: "0014_ai_photo_workshop", title: "Design Workshop (Nano-Banana Spatial Design)", description: "Bring every nano-banana spatial-design use case into core-remodel as /admin/designs/workshop.", docPath: "docs/0014_ai_photo_workshop", status: "planning", sortOrder: 14 },
];

// ─── Tasks ───────────────────────────────────────────────────────────────────
// changeType: new | move | update | delete | keep | investigate | recover
// status defaults to "pending"; Phase-0 rows are flipped to "done" post-build.

const P = "0013_link_cleanup";

const TASKS_0013: SeedTask[] = [
  // Phase 0 — tracker infra (this session)
  t(P, "P0-01", "tracker", 0, "new", "D1 plans + plan_tasks schema", "Drizzle schema + migration for the roadmap tracker.", "/admin/plans"),
  t(P, "P0-02", "tracker", 0, "new", "/api/admin/plans/* endpoints", "list, get, patch-status, seed.", "/api/admin/plans"),
  t(P, "P0-03", "tracker", 0, "new", "/admin/plans overview + board UI", "PlansOverviewApp + PlanBoardApp with polling + progress bars.", "/admin/plans"),
  t(P, "P0-04", "tracker", 0, "new", "Seed + sidebar link", "Seed all 0009–0014 plans; add Plans to admin sidebar.", "/admin/plans"),
  t(P, "P0-05", "tracker", 0, "new", "Author docs/0013 package", "ROADMAP, SITEMAP, OPEN_QUESTIONS (answered), RECOVERY, PROMPT, specs/*.", "docs/0013_link_cleanup"),

  // W0 — rescue uncommitted work (high priority follow-up)
  t(P, "W0-01", "recovery", 0, "recover", "Recover blank-canvas suite", "From room-floorplan checkout: BlankCanvasAdminApp + blank-canvas-generator + inline-editor + InlineMaskEditor + pages/admin/blank-canvas/ (upload/generate/exclusions/floor/room).", "/admin/prepare/blank-canvas", ["W0-06"]),
  t(P, "W0-02", "recovery", 0, "recover", "Rescue ClickUp integration", "routes/clickup.ts, services/clickup-client.ts, components/clickup/, schema/scrum/, pages/admin/tasks.astro. See plan 0009.", null),
  t(P, "W0-03", "recovery", 0, "recover", "Rescue Admin Chat + Orchestrator", "AdminChatAgent/, RemodelOrchestrator/, AdminChatPanel.tsx.", null),
  t(P, "W0-04", "recovery", 0, "recover", "Rescue saved image searches", "schema/images/saved_image_searches.ts. See plan 0010.", null),
  t(P, "W0-05", "recovery", 0, "investigate", "Reconcile migrations 0055–0058", "Uncommitted; main is already at 0065 → likely renumbered/superseded. Do NOT blind-apply; diff against applied schema.", null),
  t(P, "W0-06", "recovery", 0, "recover", "3-way merge overlapping files", "_worker.ts, AppSidebar.tsx, showroom-stores.ts, api/index.ts, ShowroomsDirectoryApp.tsx were rewritten+deployed on serene-pike; rescue is a per-file 3-way merge, not a cherry-pick.", null),

  // Phase 1 — IA & viewport split
  t(P, "P1-01", "navigation", 1, "new", "Two sidebars (Public/Admin)", "Split AppSidebar → PublicSidebar + AdminSidebar; BaseLayout picks by path.", null),
  t(P, "P1-02", "navigation", 1, "new", "Enter Admin Portal button", "Public sidebar button → /admin; reuse existing remodel_access cookie auth (/access).", "/admin"),
  t(P, "P1-03", "navigation", 1, "move", "Admin namespace reorg", "/admin/{budget,designs,prepare,bids,planning,config,pmo}/* (plural collections).", "/admin/*"),
  t(P, "P1-04", "navigation", 1, "move", "Public route moves", "/photos/{listing,inspiration}, /log/{daily,weekly}, /specs/measurements.", null),
  t(P, "P1-05", "navigation", 1, "update", "Redirects for all moves", "Prefix 301s in _worker.ts (Astro _redirects splat is broken — see memory).", null, ["P1-03", "P1-04"]),
  t(P, "P1-06", "navigation", 1, "update", "Fix stale contractor guide", "portal.ts navigationGuide points at now-admin routes; repoint to public pages.", null),
  t(P, "P1-07", "navigation", 1, "delete", "Hard-delete dead routes (keep tally + data)", "/gallery, /supporting-docs, /photo-edits, /docs/[audience]/[slug], /docs/homeowners/permits, old /admin/planning/{decision-room,moodboards}, /admin/showrooms/[id]/brands/[brandId]. Preserve underlying data.", null),
  t(P, "P1-08", "navigation", 1, "move", "Questionnaire move+keep", "→ /admin/planning/questionnaire (+ [section_slug], print).", "/admin/planning/questionnaire"),

  // Phase 2 — Documents
  t(P, "P2-01", "documents", 2, "new", "Documents schema (visibility + views)", "Extend documents: visibility (private default), entity associations, saved views (static/dynamic).", null),
  t(P, "P2-02", "documents", 2, "new", "Reusable upload pipeline", "Dropzone → @llamaindex/liteparse + @cf/meta/llama-3.2-11b-vision-instruct OCR → R2 → D1 keys → Vectorize embeddings.", null, ["P2-01"]),
  t(P, "P2-03", "documents", 2, "new", "Public /docs", "Public-marked docs, saved views, URL-persisted search, viewer (pdf-viewer / image iframe / CAD download).", "/docs", ["P2-01"]),
  t(P, "P2-04", "documents", 2, "new", "/admin/docs", "All docs, upload, permissions, view builder with amber exposure warnings, edit.", "/admin/docs", ["P2-02"]),
  t(P, "P2-05", "documents", 2, "new", "Mount uploader on entities", "Reuse on /admin/companies|shopping/showrooms|products|brands|projects/[id]/documents/upload with auto-association.", null, ["P2-02"]),

  // Phase 3 — Companies CRM
  t(P, "P3-01", "crm", 3, "new", "Company detail (info tabs) + new", "/admin/companies/[id] tabs (contact/company info, website/IG/CSLB license); /admin/companies/new + token gen.", "/admin/companies/[id]"),
  t(P, "P3-02", "crm", 3, "new", "Contacts", "/admin/companies/[id]/contacts (+ /new).", "/admin/companies/[id]/contacts"),
  t(P, "P3-03", "crm", 3, "new", "Notes (PlateJS)", "/admin/companies/[id]/notes (+ new/[id]/view/edit, soft-delete).", "/admin/companies/[id]/notes"),
  t(P, "P3-04", "crm", 3, "new", "Todos (PlateJS)", "/admin/companies/[id]/todos (+ new/[id]/view/edit, due/status/owner/tags).", "/admin/companies/[id]/todos"),
  t(P, "P3-05", "crm", 3, "new", "Company documents", "Reuse Phase 2 uploader; ENUM type CONTRACT/CHANGE_ORDER/INVOICE/LIEN_WAIVER; status active/expired.", "/admin/companies/[id]/documents", ["P2-05"]),
  t(P, "P3-06", "crm", 3, "new", "Company permits", "Surface SF SODA permits for the company; link to /admin/permits/[id].", "/admin/companies/[id]/permits"),
  t(P, "P3-07", "crm", 3, "new", "Gmail Comms hub", "Full spec in specs/GMAIL_COMMS.md: SA domain-wide delegation, poll justin@126colby.com, per-contractor-domain search, gmail_threads/gmail_messages D1 + Vectorize, reply-all UI (sidebar-09), Workers-AI drafts, Agent-SDK reader.", "/admin/companies/[id]/emails"),

  // Phase 4 — Design
  t(P, "P4-01", "design", 4, "new", "Moodboards suite", "/admin/designs/moodboards: list + floors/[id] + room/[id] + new (Gemini reference-image flow, ≤10 refs, masking+prompt) + upload + [id] + revisions.", "/admin/designs/moodboards"),
  t(P, "P4-02", "design", 4, "new", "Design Workshop", "/admin/designs/workshop — nano-banana-spatial-design. See plan 0014.", "/admin/designs/workshop"),
  t(P, "P4-03", "design", 4, "new", "Decision Room", "/admin/designs/decision-room: per-room final moodboard + material→product/description todos.", "/admin/designs/decision-room"),
  t(P, "P4-04", "design", 4, "new", "Blank-canvas rebuild", "Extend recovered W0-01 suite: upload/generate/exclusions/floor/room.", "/admin/prepare/blank-canvas", ["W0-01"]),
  t(P, "P4-05", "design", 4, "move", "Builder → angles", "builder → /admin/prepare/blank-canvas/angles (camera-on-floorplan positioning).", "/admin/prepare/blank-canvas/angles"),
  t(P, "P4-06", "design", 4, "new", "Public design-master-plan", "/planning/design-master-plan — public read-only render of decision-room + contractor comments.", "/planning/design-master-plan", ["P4-03"]),
  t(P, "P4-07", "design", 4, "move", "Kitchen layout", "kitchen-layout → /admin/designs/layouts/[id] (admin).", "/admin/designs/layouts/[id]"),

  // Phase 5 — Brands / Products / Showroom sourcing
  t(P, "P5-01", "sourcing", 5, "update", "Consolidate + reintegrate shopping", "Keep ALL showroom sub-pages (sourcing/progress/scan/intake/schedule/compare/gaps/research); reintegrate into flow.", "/admin/shopping"),
  t(P, "P5-02", "sourcing", 5, "new", "Showroom sub-pages", "/admin/shopping/showrooms/[id]/{products,brands,research,shopping-journal}.", "/admin/shopping/showrooms/[id]"),
  t(P, "P5-03", "sourcing", 5, "new", "Brand e-commerce pages", "/admin/shopping/brands/[id] + edit/new/products/research/shopping-journal; showrooms carrying brand.", "/admin/shopping/brands/[id]"),
  t(P, "P5-04", "sourcing", 5, "new", "Product e-commerce pages", "/admin/shopping/products/[id] (pics, pricing, showrooms, ratings/reviews summary) + shopping-journal.", "/admin/shopping/products/[id]"),
  t(P, "P5-05", "sourcing", 5, "new", "Showroom hero hours + cards", "Professional hero hours (beste.co BusinessHero/ShowroomContact); clickable → full M–Sun modal + contact; apply tightened card to List + Directory.", null),
  t(P, "P5-06", "sourcing", 5, "new", "Showroom enrichment pipeline", "Full spec in specs/SHOWROOM_ENRICHMENT.md: crawl→triage→screenshot→CF Images→extract contact/hours/socials/brands+favicon→D1 (showroom_store_brands, page-screenshot).", null),
  t(P, "P5-07", "sourcing", 5, "new", "RAG journal viewer", "/admin/shopping/journal — filters + keyword + RAG across showroom/product/brand/contractor notes.", "/admin/shopping/journal"),
  t(P, "P5-08", "sourcing", 5, "update", "Fix broken showroom routes", "scan = business-card OCR (Workers AI); intake = dedicated page (not modal); schedule/sourcing/progress clarified.", null),

  // Phase 6 — Bids & Budget
  t(P, "P6-01", "bids-budget", 6, "move", "Bids portal", "/admin/bids (from bid-portfolios); per-contractor phone PIN; /bid + /bid/[token].", "/admin/bids"),
  t(P, "P6-02", "bids-budget", 6, "delete", "Delete estimates list", "Fold into bids; manual-estimate intake survives as /admin/bids/new.", "/admin/bids/new"),
  t(P, "P6-03", "bids-budget", 6, "move", "Budget namespace", "/admin/budget/{tracker,dashboard,truth-table,reconciliation}.", "/admin/budget"),
  t(P, "P6-04", "bids-budget", 6, "keep", "Budget reconciliation", "= existing CSV/Sheets reconcile (BudgetReconciliationApp + /api/budget-tracker/csv-ingestion); same as Seed Homeowner Plan.", "/admin/budget/reconciliation"),

  // Phase 7 — Floorplan / rooms
  t(P, "P7-01", "floorplan", 7, "new", "Floor/room routing", "/floor-plan/floors/[id]/rooms/[id] via the floorplan visual (floor PK + room PK; forces user intent).", "/floor-plan/floors/[id]/rooms/[id]"),
  t(P, "P7-02", "floorplan", 7, "new", "Closets view", "All closets on a floor (for hardware-flooring takeoffs).", "/floor-plan/floors/[id]/rooms/closets"),
];

// Other initiatives — high-level tasks pointing back to their source docs.
const TASKS_OTHER: SeedTask[] = [
  t("0009_clickup_taskmanagement", "CU-01", "clickup", 1, "recover", "ClickUp-backed PMO mirrored in D1", "ClickUp integration (clickup-client.ts) + our own D1 mirror + PMO; ClickUp is fallback. See implementation_plan.md.", "/admin/tasks"),
  t("0009_clickup_taskmanagement", "CU-02", "clickup", 1, "recover", "AI Orchestrator Agent", "RemodelOrchestrator + AdminChat. See walkthrough.md.", null),
  t("0010_gallery_search", "GS-01", "gallery", 1, "recover", "Gallery search + saved searches", "saved_image_searches schema + search UI. See implementation_plan.md.", "/admin/gallery"),
  t("0010_gallery_search", "GS-02", "gallery", 1, "recover", "Gemini canvas-editor refinements", "InlineMaskEditor + canvas editor. See implementation_plan.md.", null),
  t("0011_photo_editing", "PE-01", "photos", 1, "recover", "Photo edit sessions UX overhaul", "Complete overhaul. See implementation_plan.md.", "/admin/photo-edits"),
  t("0012_contractor_activity_map", "CM-01", "map", 1, "new", "Contractor activity map", "See SPEC.md + TASKS.md.", null),
  t("0014_ai_photo_workshop", "WS-01", "design", 1, "new", "Design workshop (nano-banana)", "Bring every nano-banana spatial-design use case in. See IMPLEMENTATION_PLAN.md → /admin/designs/workshop.", "/admin/designs/workshop"),
];

/** Compact task-row builder with sane defaults. */
function t(
  planSlug: string,
  taskKey: string,
  workstream: string,
  phase: number,
  changeType: SeedTask["changeType"],
  title: string,
  description: string,
  targetRoute: string | null = null,
  dependsOn: string[] | null = null,
): SeedTask {
  return { planSlug, taskKey, workstream, phase, changeType, title, description, targetRoute, dependsOn, status: "pending", sortOrder: 0, notes: null };
}

/**
 * Idempotently seed the plans + tasks. Safe to run repeatedly. Assigns
 * `sortOrder` from array position within each plan so board ordering is stable.
 */
export async function seedPlanTasks(db: DrizzleD1Database): Promise<{ plans: number; tasks: number }> {
  // Upsert plans (update title/description/status on slug conflict).
  for (const p of PLANS) {
    await db
      .insert(plans)
      .values(p)
      .onConflictDoUpdate({
        target: plans.slug,
        set: { title: p.title, description: p.description, docPath: p.docPath, status: p.status, sortOrder: p.sortOrder, updatedAt: new Date() },
      });
  }

  const all = [...TASKS_0013, ...TASKS_OTHER].map((task, i) => ({ ...task, sortOrder: i }));
  // Insert tasks in D1-safe chunks; never overwrite a live status/notes.
  const CHUNK = 20;
  for (let i = 0; i < all.length; i += CHUNK) {
    const stmts = all
      .slice(i, i + CHUNK)
      .map((task) => db.insert(planTasks).values(task).onConflictDoNothing());
    if (stmts.length === 0) continue;
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  return { plans: PLANS.length, tasks: all.length };
}
