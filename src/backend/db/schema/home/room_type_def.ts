import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * What a room physically *is* (0043 Phase 0). Wet, dry, circulation, utility.
 * Admin-managed at `/admin/config/room/types`.
 *
 * WHY IT IS SEPARATE FROM `room_use_def`: use says what happens in the room
 * (kitchen, bath, office); type says what the construction has to cope with.
 * A kitchen and a bathroom are different uses that are both *wet* — and "wet"
 * is the fact a shower valve, a waterproofing assembly and a tile profile
 * actually care about. Keeping type separate is what lets material
 * applicability be stated once against a physical class instead of being
 * re-enumerated for every use anyone ever adds.
 *
 * THIS IS THE AXIS MATERIAL APPLICABILITY MAPS TO.
 * `material_type_room_type_mapping` (see `materials/material_type_def.ts`)
 * limits a material type to the room types where it means something. A shower
 * valve is bathrooms **and** wet rooms — several types, which is exactly why
 * the plan (§5c) replaced the drafted `isRoomTypeUnique` + single
 * `room_type_id` with a mapping table. A single-value column on a genuinely
 * many-valued relationship is the error this plan corrected three times
 * already; do not reintroduce it in the other direction either.
 *
 * A ROOM CAN HOLD SEVERAL TYPES. A kitchen is wet *and* a work space; a
 * laundry is wet *and* utility. Whatever links a room to its types must
 * therefore be a mapping table too — never a `room_type_id` column on `rooms`.
 * That link is not part of Phase 0; this file supplies only the vocabulary.
 *
 * NOT a scope marker and NOT a floor. Whole-house and whole-floor concerns fan
 * out into per-room rows through `resolveRoomScope()` and are explained by a
 * `room_scope_applications` row (§5b). The retired `all_levels` pseudo-floor is
 * exactly the shortcut that mechanism replaces; do not re-create it as a
 * "whole house" room type.
 */
export const roomTypeDef = sqliteTable("room_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "wet". This is what applicability rules match on. */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Wet Room". */
  name: text("name").notNull(),

  /**
   * What makes a room this type, in plain language — PlateJS markdown. The
   * consequences are invisible to a first-timer: "wet" is not a description of
   * how the room feels, it is the reason the wall behind the tile is cement
   * board and the reason the material list is different.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in pickers and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. Retiring a type must not silently widen every material that
   * was limited to it — deactivating here is a config decision, and the
   * applicability reads that consume the mapping filter on `is_active = 1`.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomTypeDef = typeof roomTypeDef.$inferSelect;
export type RoomTypeDefInsert = typeof roomTypeDef.$inferInsert;
