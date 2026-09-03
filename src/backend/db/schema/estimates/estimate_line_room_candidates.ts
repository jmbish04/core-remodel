import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { estimateLineItems } from "./estimates";

export const estimateLineRoomCandidates = sqliteTable(
  "estimate_line_room_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    estimateLineItemId: integer("estimate_line_item_id")
      .notNull()
      .references(() => estimateLineItems.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    verdict: text("verdict").notNull(),
    reasoningMarkdown: text("reasoning_markdown"),
    reasoningHtml: text("reasoning_html"),
    evidenceJson: text("evidence_json"),
    confidence: real("confidence"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    lineItemRoomUnique: uniqueIndex("uidx_estimate_line_room_candidates_line_room").on(
      t.estimateLineItemId,
      t.roomId,
    ),
    lineItemRankIdx: index("idx_estimate_line_room_candidates_line_rank").on(
      t.estimateLineItemId,
      t.rank,
    ),
  }),
);
