import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "../materials/schedule_item";
import { showroomStoreProducts } from "../showroom/store_products";
import { rooms } from "./rooms";
import { specDefinitions } from "./spec_definitions";

/**
 * A room's answer to one spec question (0041 Phase 0).
 *
 * FOREIGN KEYS, NOT BLOBS. A fixture is `productId` pointing at a real
 * purchasable row; a stone is `materialId`. The original sketch for this feature
 * proposed `plumbing_fixtures JSON` and `stone_choices JSON`, which was rejected:
 * a blob orphans the selection from budget, receipts, comparison, and lead
 * times, which are the only reasons to record it at all.
 *
 * CURRENCY IS TEXT + CENTS. `valueText` holds the verbatim string the homeowner
 * or vendor gave ("$1,299.00", or "call for pricing"), and `valueCents` holds the
 * integer for sorting and summing. Never one without the other — "call for
 * pricing" is a real answer and a bare number cannot hold it.
 *
 * CONFIDENCE IS FIRST-CLASS:
 *
 *   known    verified against a real source
 *   assumed  a working answer nobody has confirmed
 *   range    a band, not a point — the honest state for most early estimates
 *   unknown  explicitly not known
 *
 * `unknown` is a valid, recorded state and it renders as itself. False precision
 * is the failure mode this product is built against: an assumed number that
 * looks like a measured one is worse than a blank, because it gets quoted to a
 * contractor.
 *
 * A definition flagged `isRequiredForThreshold` blocks the trade handoff unless
 * it holds a value at `known` — OR carries an explicit waiver, so a deliberate
 * unknown ("we are choosing the pull later, on purpose") is not a wall the
 * homeowner cannot pass.
 */
export const roomSpecFields = sqliteTable(
  "room_spec_fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    specDefinitionId: integer("spec_definition_id")
      .notNull()
      .references(() => specDefinitions.id, { onDelete: "cascade" }),

    /** FK to the real product, when this spec resolves to a purchasable thing. */
    productId: integer("product_id").references(() => showroomStoreProducts.id, {
      onDelete: "set null",
    }),

    /** FK to the material schedule item, when it resolves to a material. */
    materialId: integer("material_id").references(() => materialScheduleItems.id, {
      onDelete: "set null",
    }),

    /** Verbatim value as given. Also carries the currency string. */
    valueText: text("value_text"),

    /** Integer cents. Paired with valueText — never stored alone. */
    valueCents: integer("value_cents"),

    /** known | assumed | range | unknown */
    confidence: text("confidence").notNull().default("unknown"),

    /**
     * A deliberate unknown, waived past the threshold with a stated reason.
     * Null = not waived. Non-null = the homeowner chose to proceed knowing this
     * is open, and said why. `roomReadiness()` honours a waiver; it does not
     * ignore the gap.
     */
    waivedReason: text("waived_reason"),

    /** Who supplied this value — homeowner, agent, contractor, vendor, import. */
    provenanceActor: text("provenance_actor"),

    provenanceAt: integer("provenance_at", { mode: "timestamp" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // One answer per question per room.
    roomSpecUnique: unique("room_spec_fields_room_definition_unique").on(
      table.roomId,
      table.specDefinitionId,
    ),
    // roomReadiness() scans a room's fields; this is its index.
    roomIdx: index("room_spec_fields_room_idx").on(table.roomId),
  }),
);
