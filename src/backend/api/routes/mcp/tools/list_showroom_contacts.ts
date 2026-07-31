import { showroomStoreContacts, showroomStores } from "@backend/db/schema/showroom/index";
import { and, eq, isNull, like, or } from "drizzle-orm";

import type { ToolDef } from "../types";

export const listShowroomContacts: ToolDef = {
  name: "list_showroom_contacts",
  description:
    "List showroom contacts (the phonebook). Filter by storeId, contact type, or a name/email query. Returns each contact with its store name and all phone numbers.",
  inputSchema: {
    type: "object",
    properties: {
      storeId: { type: "number" },
      type: { type: "string", enum: ["GENERAL_CONTACT", "SALES", "ESTIMATOR", "MANAGER", "CUSTOMER_SERVICE", "OTHER"] },
      q: { type: "string", description: "Search name / email." },
      includeDrafts: { type: "boolean" },
    },
  },
  handler: async ({ db, args }) => {
    const conds = [] as any[];
    if (args.storeId != null) conds.push(eq(showroomStoreContacts.storeId, Number(args.storeId)));
    if (typeof args.type === "string") conds.push(eq(showroomStoreContacts.type, args.type as any));
    if (!args.includeDrafts) conds.push(eq(showroomStoreContacts.isDraft, false));
    // Mirrors GET /api/showroom-contacts: hide contacts of a soft-deleted
    // store, keep unattached ones (storeId is nullable).
    conds.push(or(isNull(showroomStoreContacts.storeId), eq(showroomStores.isActive, true)));
    if (typeof args.q === "string" && args.q.trim()) {
      const q = `%${args.q.trim()}%`;
      conds.push(or(like(showroomStoreContacts.firstName, q), like(showroomStoreContacts.lastName, q), like(showroomStoreContacts.emailAddress, q)));
    }
    const rows = await db
      .select({ contact: showroomStoreContacts, storeName: showroomStores.name })
      .from(showroomStoreContacts)
      .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(showroomStoreContacts.lastName, showroomStoreContacts.firstName);
    return JSON.stringify(rows.map((r) => ({ ...r.contact, storeName: r.storeName })));
  },
};
