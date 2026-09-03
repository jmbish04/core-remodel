import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { contracts } from "./contracts";

export const contractComplianceGates = sqliteTable(
  "contract_compliance_gates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    gateType: text("gate_type").notNull(),
    state: text("state").notNull(),
    evidenceMarkdown: text("evidence_markdown"),
    evidenceHtml: text("evidence_html"),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    sourceRef: text("source_ref"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    contractGateTypeUnique: uniqueIndex("uidx_contract_compliance_gates_contract_type").on(
      t.contractId,
      t.gateType,
    ),
    contractStateIdx: index("idx_contract_compliance_gates_contract_state").on(
      t.contractId,
      t.state,
    ),
  }),
);
