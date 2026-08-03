import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { companies } from "../directory/companies";
import { projects } from "../home/projects";
import { impactDefinitions } from "./impact_definitions";

/**
 * Something that happened to the project (0041 Phase 0).
 *
 * One impact reaches any number of heterogeneous targets through
 * `impact_targets`, and can block other impacts through `impact_blocks`, giving
 * bug-tracker semantics: this cannot be resolved until that one is.
 *
 * NODE HEALTH IS DERIVED FROM THIS TABLE AND NEVER STORED. A room, a budget
 * line, a permit, or a delivery is "unhealthy" as a function of its open impacts
 * and everything blocking them — computed by one server-side `nodeHealth()`
 * resolver. A cached health column would drift, and a drifting health signal is
 * worse than none.
 *
 * PROVENANCE IS NOT OPTIONAL HERE. `source` records how this impact came to
 * exist, because a rule-library inference and a contractor's field report carry
 * very different weight and the homeowner is entitled to see which is which:
 *
 *   rule          the known-ripple library matched a pattern deterministically
 *   agent         an AI proposed it from decision content
 *   conversation  someone explained it and the agent structured it
 *   contractor    the trade flagged it in the field
 *   homeowner     entered directly
 *   integration   a permit feed, a delivery webhook, a receipt
 *
 * ACTOR PARTY. Party impacts name a counterparty by FK, never by a name string.
 * `actorPartyKind` discriminates which table `actorPartyId` points into; only
 * `company` is a hard FK today because household members do not exist yet
 * (see 0041 §10, tenancy is open).
 *
 * CONFIDENCE MAY BE NULL, and null means unknown rather than zero. An impact
 * nobody has quantified is still real.
 */
export const impacts = sqliteTable(
  "impacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    definitionId: integer("definition_id")
      .notNull()
      .references(() => impactDefinitions.id, { onDelete: "restrict" }),

    title: text("title").notNull(),

    detailMarkdown: text("detail_markdown"),
    detailHtml: text("detail_html"),

    /**
     * forecast    predicted, not yet real — must carry evidence to render as an alarm
     * active      happening now
     * mitigating  a response is under way
     * resolved    closed
     * dismissed   judged not to apply, with a reason
     */
    status: text("status").notNull().default("active"),

    /** rule | agent | conversation | contractor | homeowner | integration */
    source: text("source").notNull(),

    /** company | household_member | vendor | showroom. Null for non-party impacts. */
    actorPartyKind: text("actor_party_kind"),

    /**
     * Hard FK to companies — the only party table that exists today. Household
     * members and vendor records get their own columns when those tables land;
     * a single polymorphic id column would lose referential integrity for the
     * one case that currently has it.
     */
    actorCompanyId: integer("actor_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    /** Id within actorPartyKind, for party kinds that have no table yet. */
    actorPartyId: integer("actor_party_id"),

    /** 0–100. Null = genuinely unknown, which is a valid recorded state. */
    confidence: integer("confidence"),

    /** Money at risk, in integer cents. Paired with the text form for display. */
    costExposureCents: integer("cost_exposure_cents"),
    costExposureText: text("cost_exposure_text"),

    /** Schedule at risk, in days. */
    daysExposure: integer("days_exposure"),

    provenanceActor: text("provenance_actor"),
    provenanceAt: integer("provenance_at", { mode: "timestamp" }),

    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolutionNote: text("resolution_note"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // nodeHealth() walks open impacts for a project constantly.
    projectStatusIdx: index("impacts_project_status_idx").on(table.projectId, table.status),
    definitionIdx: index("impacts_definition_idx").on(table.definitionId),
    actorCompanyIdx: index("impacts_actor_company_idx").on(table.actorCompanyId),
  }),
);
