import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The kinds of thing that can disrupt a project (0041 Phase 0).
 *
 * A ticketing model, deliberately. A ripple from a room decision, a tariff, a
 * lost subcontractor, a code change before the permit is filed, asbestos found
 * in demo, PG&E refusing to schedule, a week of weather — these are all the same
 * kind of object, and modelling them as one lets them block each other and
 * propagate risk through a single graph.
 *
 * `riskInputs` is what makes this a definition table rather than an enum: it
 * declares WHICH FIELDS on an impact feed its risk score, as a JSON array of
 * column names. A new impact type is therefore configuration — a row — and not a
 * migration. Hardcoding an impact enum is explicitly rejected; the list below is
 * a seed, not a closed set.
 *
 * Seeded kinds, by family:
 *
 *   RIPPLE          ripple
 *   PARTY           homeowner_change_of_mind, contractor_terminated,
 *                   contractor_abandonment, bad_faith, contract_breach, fraud,
 *                   sub_loss, vendor_failure
 *   SCHEDULE        permit_delay, shipping_delay, utility_dependency, weather
 *   MONEY           cost_overrun
 *   FIELD           demo_discovery
 *   EXTERNAL        code_change, macro
 *
 * PEOPLE ARE A FIRST-CLASS SOURCE, not an edge case. A homeowner changing their
 * mind is the most common impact in any real project and it is legitimate — see
 * `impacts.actorPartyKind`.
 */
export const impactDefinitions = sqliteTable("impact_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "contractor_abandonment". */
  key: text("key").notNull().unique(),

  /** Display name, in plain language. */
  name: text("name").notNull(),

  /** ripple | party | schedule | money | field | external */
  family: text("family").notNull(),

  description: text("description"),

  /**
   * JSON array of impact column names that feed the risk score for this kind,
   * e.g. ["costExposureCents","daysExposure","confidence"]. Read by the scoring
   * layer so a new kind can declare its own inputs without code changes.
   */
  riskInputs: text("risk_inputs"),

  /** 0–100 starting severity before per-instance inputs are applied. */
  defaultSeverity: integer("default_severity").notNull().default(50),

  /**
   * True when this kind names a counterparty — a contractor, sub, vendor, or
   * showroom. Drives whether the UI demands an actor and whether 0042's dispute
   * flow can open from it.
   */
  requiresActorParty: integer("requires_actor_party", { mode: "boolean" })
    .notNull()
    .default(false),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
