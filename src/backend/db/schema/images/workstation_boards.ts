import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";

/**
 * workstation_boards — the infinite-canvas "table" for a room's Workshop
 * (see docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md §"Front door").
 *
 * One board is the free-floating canvas surface a room's photos, blank canvases,
 * inspiration, clippings, and renders get dragged onto as `board_nodes`. The board
 * itself only tracks canvas-level identity/naming; node positions/lineage live in
 * `board_nodes`.
 *
 * Slice 1 policy: exactly one board per room (see `roomIdUnique` below). This is a
 * deliberate simplification, NOT a schema ceiling — multi-board-per-room (e.g. for
 * A/B exploration decks) is a plausible Slice 2 feature. Drop the unique index and
 * this becomes a normal one-to-many without any other shape change.
 */
export const workstationBoards = sqliteTable(
  "workstation_boards",
  {
    id: text("id").primaryKey(), // UUID
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    // Optional — boards are frictionless; the room name is a sufficient default label.
    name: text("name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // Slice 1 one-board-per-room policy. Safe to drop later without touching the
    // rest of the shape (see docstring above).
    roomIdUnique: uniqueIndex("workstation_boards_room_id_unique").on(table.roomId),
  }),
);
