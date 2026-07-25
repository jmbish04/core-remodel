// src/backend/db/schema/materials/material_room_proposals.ts
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { subcategories } from "../config/subcategories";
import { workerEmailInvoiceLineItems } from "../emails/worker_email_invoice_line_items";
import { materialScheduleItems } from "./schedule_item";

/**
 * Material → Room deduction proposals (0030).
 *
 * A receipt line item ("2× Kohler Fora Toilet") is promoted to a typed material,
 * but the receipt does not say WHICH of the three bathrooms it belongs to. The
 * deduction engine narrows the candidate rooms by elimination — already-sourced,
 * dormant, previously-confirmed — then, only if more than one survives, an AI
 * model ranks them from the receipt context.
 *
 * This row is the STAGED ARGUMENT, not the answer. `roomId` on the material is
 * set only when a human confirms (or, for the single-survivor case, when the
 * engine auto-confirms an unambiguous mapping). The proposal survives that
 * confirmation so "why is this toilet in the primary?" is always answerable — it
 * is the audit trail for a decision that otherwise looks like a bare FK.
 *
 * NOTE: no denormalized room/material name columns. Display names are joined
 * from `rooms` / `material_schedule_items` at read time (AGENTS.md FK rule). The
 * one snapshot here is `candidatesJson`, which is a deliberate point-in-time
 * record of the reasoning as it stood — named for what it is.
 */
export const materialRoomProposals = sqliteTable(
  "material_room_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * The material this proposal placed — NULL until the room is resolved.
     *
     * `material_schedule_items.roomId` is NOT NULL (a material is always
     * per-room), and inventing a placeholder room just to hold an unplaced
     * material would be exactly the lie the FK rule forbids. So the material is
     * NOT created while the room is ambiguous: the proposal carries the line
     * item + type, and the material is minted into the confirmed room the moment
     * a human resolves it (or, for the single-survivor case, immediately).
     */
    materialId: integer("material_id").references(() => materialScheduleItems.id, {
      onDelete: "cascade",
    }),

    /** The receipt line item it was promoted from — provenance, may be cleared. */
    lineItemId: integer("line_item_id").references(() => workerEmailInvoiceLineItems.id, {
      onDelete: "set null",
    }),

    /** The material type the deduction reasoned over (e.g. "Toilet"). */
    subcategoryId: integer("subcategory_id").references(() => subcategories.id, {
      onDelete: "set null",
    }),

    /**
     * Which unit of a multi-unit line this proposal places (0-based). A qty-2
     * toilet line the allocator SPLITS across two baths stages two proposals
     * sharing a `lineItemId`, distinguished by `unitIndex` 0 and 1. A grouped
     * placement (qty stays in one room) is a single proposal, unitIndex 0.
     */
    unitIndex: integer("unit_index").notNull().default(0),

    /**
     * The inferred use the allocator reasoned the material toward — e.g.
     * "primary bath floor", "island lighting". Free text; the argument, not a FK.
     */
    application: text("application"),

    status: text("status", {
      enum: ["staged", "auto_confirmed", "confirmed", "overridden", "dismissed"],
    })
      .notNull()
      .default("staged"),

    /** Top-ranked candidate — what the engine would pick. */
    proposedRoomId: integer("proposed_room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),

    /** What the human actually chose (may differ from proposed → "overridden"). */
    confirmedRoomId: integer("confirmed_room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),

    /**
     * The full ranked argument: `[{ roomId, kept, score, evidence }]`. A snapshot
     * of the reasoning at proposal time — deliberately frozen, so a later room
     * rename or new material does not rewrite history.
     */
    candidatesJson: text("candidates_json"),

    /** 0–100. Higher when elimination left one room; lower when the AI broke a tie. */
    confidence: integer("confidence"),

    /** Human-facing narrative of how the room was chosen. */
    reasoningMarkdown: text("reasoning_markdown"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /** When it left `staged` (confirmed / overridden / dismissed). */
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => ({
    materialIdx: index("material_room_proposals_material_idx").on(table.materialId),
    statusIdx: index("material_room_proposals_status_idx").on(table.status),
    lineItemIdx: index("material_room_proposals_line_item_idx").on(table.lineItemId),
  }),
);

export type MaterialRoomProposal = typeof materialRoomProposals.$inferSelect;
export type MaterialRoomProposalInsert = typeof materialRoomProposals.$inferInsert;

/** One ranked candidate room, as stored in `candidatesJson`. */
export interface RoomCandidate {
  roomId: number;
  roomName: string;
  /** false = eliminated by a deterministic step; the evidence says which. */
  kept: boolean;
  /** 0–100 relative rank among kept rooms; 0 for eliminated. */
  score: number;
  /** Why this room was kept or dropped — the sentence a human reviews. */
  evidence: string;
}
