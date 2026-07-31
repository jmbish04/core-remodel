import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The known-ripple rule library (0041 Phase 0).
 *
 * WHY THIS EXISTS: nobody will hand-author a dependency graph. A graph that
 * requires manual curation is a graph that will not exist. This table is what
 * makes the network non-empty on day one, before any conversation has happened
 * and with zero project history — deterministic, explainable, and incapable of
 * hallucinating.
 *
 * It is also what makes the blast-radius lens worth opening. That lens earns its
 * place by naming WHY two rooms connect — "shared wall", "panel capacity" — and
 * those labels come from here. If the rules cannot name a connection honestly,
 * the lens is decoration. That moved this from a nice-to-have seed to the thing
 * the whole living-graph phase depends on.
 *
 * Curated construction knowledge, e.g.:
 *   move a wall  ->  plumbing, electrical, permit, flooring transition, HVAC
 *   change a range fuel  ->  gas line, service capacity, permit, ventilation
 *   relocate a drain  ->  slab, waterproofing, inspection sequence
 *
 * The agent and the conversation ENRICH this; they do not replace it. A rule
 * match produces a proposal with `source = "rule"`, which the homeowner confirms
 * like any other — deterministic does not mean automatic.
 */
export const rippleRules = sqliteTable(
  "ripple_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Stable slug, e.g. "wall_relocation". */
    key: text("key").notNull().unique(),

    /** What the homeowner did, in plain language. */
    triggerName: text("trigger_name").notNull(),

    /**
     * What the trigger matches against, as a JSON object — spec definition keys,
     * decision kinds, or room attributes. Read by the matcher; deliberately data
     * rather than code so the library grows without a deploy.
     */
    triggerMatch: text("trigger_match").notNull(),

    /**
     * What it reaches, as a JSON array of { targetKind, effect, reason }. The
     * `reason` is the label the lens renders — "shared wall" — so it is authored
     * here rather than generated at render time.
     */
    consequences: text("consequences").notNull(),

    /**
     * Why this is true, in construction terms. Shown when a homeowner asks why
     * the system thinks a wall move touches the bath. A rule that cannot explain
     * itself does not ship.
     */
    rationale: text("rationale"),

    /**
     * How reliably the trigger implies the consequence: always | usually |
     * sometimes. Feeds the proposal's confidence, and keeps "sometimes" rules
     * from reading as certainties.
     */
    strength: text("strength").notNull().default("usually"),

    /**
     * Jurisdiction slug when the rule is local (permit and inspection sequencing
     * varies). Null = generally applicable.
     */
    jurisdiction: text("jurisdiction"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    activeIdx: index("ripple_rules_active_idx").on(table.isActive),
  }),
);
