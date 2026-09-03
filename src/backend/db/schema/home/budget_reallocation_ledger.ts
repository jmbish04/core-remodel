import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { budgetFundingAccounts } from "./budget_tracker_items";
import { rooms } from "./rooms";

export const budgetReallocationLedger = sqliteTable(
  "budget_reallocation_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    eventTitle: text("event_title").notNull(),
    eventDetail: text("event_detail"),
    fromAccountId: integer("from_account_id").references(() => budgetFundingAccounts.id, {
      onDelete: "set null",
    }),
    toAccountId: integer("to_account_id").references(() => budgetFundingAccounts.id, {
      onDelete: "set null",
    }),
    fromRoomId: integer("from_room_id").references(() => rooms.id, { onDelete: "set null" }),
    toRoomId: integer("to_room_id").references(() => rooms.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    amountText: text("amount_text"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    createdBy: text("created_by"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    occurredAtIdx: index("idx_budget_reallocation_ledger_occurred_at").on(t.occurredAt),
    fromAccountIdx: index("idx_budget_reallocation_ledger_from_account").on(t.fromAccountId),
    toAccountIdx: index("idx_budget_reallocation_ledger_to_account").on(t.toAccountId),
    // Composite, tie-broken by id: GET /api/budget/reallocations keyset-
    // paginates on `ORDER BY occurred_at DESC, id DESC` with a matching
    // `WHERE occurred_at < ? OR (occurred_at = ? AND id < ?)` predicate. The
    // single-column occurredAtIdx above doesn't cover the id tiebreak, so
    // this is what keeps that query an index scan instead of a table scan.
    occurredAtIdIdx: index("idx_budget_reallocation_ledger_occurred_at_id").on(t.occurredAt, t.id),
  }),
);
