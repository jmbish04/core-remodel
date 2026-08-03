import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { properties } from "../config/properties";

/**
 * The project record (0041 Phase 0).
 *
 * WHAT THIS IS: the row every impact, decision, and room-stop hangs off. Until
 * now the system was single-tenant with ONE implicit project (126 Colby) and no
 * table to name it, which meant `impacts.project_id` had nothing to reference.
 *
 * WHAT THIS DELIBERATELY IS NOT: a tenancy model. There is no `account_id`, no
 * members, no invite, no isolation. Multi-tenancy is an explicitly open product
 * decision (see docs/0041_homeowner_experience §10) and it is NOT being decided
 * here. When it lands it adds a column to this table rather than restructuring
 * around it.
 *
 * `projectType` governs trajectory — what money means, who the actors are, and
 * what "done" is:
 *
 *   lifestyle_change      Expand for a growing family, make the layout practical,
 *                         open the plan. Focal rooms carry the homeowner's highest
 *                         confidence AND the highest ripple risk, because the
 *                         consequences are not yet visible to them. v1.
 *
 *   flip                  Money means margin; "done" means marketable to a broad
 *                         audience rather than to one style profile; the unit of
 *                         work is a portfolio, not a house. Deferred.
 *
 *   catastrophic_rebuild  Nature or accident destroyed part or all of the home.
 *                         An entirely different flow arrives first — claim
 *                         reporting, pre-loss inventory, public adjuster, and
 *                         defending against underpayment that starves the rebuild
 *                         of capital — and only then the rebuild itself. Deferred,
 *                         with its scope specified in the plan.
 *
 * The column exists from day one because retrofitting it after rooms, impacts,
 * and money have accumulated is expensive, and because a catastrophic-rebuild
 * user must never be silently treated as a lifestyle-change user.
 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /**
   * The physical property this remodel is happening to.
   *
   * `properties` (config/properties.ts) already owns the real estate — address,
   * geocode, assessor block and lot. A project is the EFFORT, not the building,
   * and the two are genuinely different: one property accumulates several
   * projects over the years, and a flipper runs one project per property across
   * many properties.
   *
   * The property's display name is JOINED from `properties.label`, never copied
   * here. A `projects.name` column holding "126 Colby" would be exactly the
   * denormalised-name antipattern this codebase bans — it drifts the moment the
   * property is renamed and nothing reconciles it.
   */
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "restrict" }),

  /**
   * The project's OWN name — "2026 whole-house remodel", "kitchen + primary
   * bath". This is the effort's title, not the building's, so it is this table's
   * data and not a copy of anything.
   */
  title: text("title").notNull(),

  /** Stable slug for routing and cross-references. */
  slug: text("slug").notNull().unique(),

  /** lifestyle_change | flip | catastrophic_rebuild */
  projectType: text("project_type").notNull().default("lifestyle_change"),

  /**
   * Soft-delete, matching the `rooms` convention. A project is never hard-deleted
   * — its impacts, decisions, and evidence outlive the remodel.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
