import { fieldOutContacts } from "@backend/api/routes/showroom-contacts";
import { SHOWROOM_LINK_TYPES } from "@backend/utils/showroom-links";

import type { ToolDef } from "../types";

export const createShowroomContact: ToolDef = {
  name: "create_showroom_contact",
  description:
    "Add one or more contacts for a showroom. Send people plus any general office number/email/fax and URLs; the worker files it out into person rows + the store's single GENERAL_CONTACT (fill-missing) + the links table. Provide storeId if known, or match hints (placeId, website, phone, name) for a fuzzy lookup; unmatched contacts are saved as drafts. You do NOT need to know the DB layout.",
  inputSchema: {
    type: "object",
    properties: {
      storeId: { type: "number", description: "Showroom store id, if known." },
      match: {
        type: "object",
        description: "Fuzzy-match hints used when storeId is absent.",
        properties: {
          placeId: { type: "string" },
          website: { type: "string" },
          phone: { type: "string" },
          name: { type: "string" },
        },
      },
      people: {
        type: "array",
        description: "Person contacts to create.",
        items: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            fullName: { type: "string", description: "Split into first/last when first/last absent." },
            title: { type: "string", description: "Used to infer the contact type." },
            type: { type: "string", enum: ["GENERAL_CONTACT", "SALES", "ESTIMATOR", "MANAGER", "CUSTOMER_SERVICE", "OTHER"] },
            phone: { type: "string", description: "Raw phone string; a labeled office/general number is routed to the store GENERAL_CONTACT." },
            mobilePhoneNumber: { type: "string" },
            officePhoneNumber: { type: "string" },
            officePhoneExtension: { type: "string" },
            faxPhoneNumber: { type: "string" },
            emailAddress: { type: "string" },
            isTextingOk: { type: "boolean" },
            notes: { type: "string" },
          },
        },
      },
      general: {
        type: "object",
        description: "Store-level general contact (office line / email / fax).",
        properties: {
          officePhoneNumber: { type: "string" },
          officePhoneExtension: { type: "string" },
          faxPhoneNumber: { type: "string" },
          emailAddress: { type: "string" },
        },
      },
      urls: {
        type: "array",
        description: "Store URLs → links table.",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            type: { type: "string", enum: [...SHOWROOM_LINK_TYPES] },
            urlNotes: { type: "string" },
          },
          required: ["url", "type"],
        },
      },
      address: { type: "string", description: "Office address → store row when blank." },
      businessCardFront: { type: "string", description: "Optional base64 data: URL of the card FRONT — uploaded + attached to the created contact." },
      businessCardBack: { type: "string", description: "Optional base64 data: URL of the card BACK." },
    },
  },
  handler: async ({ db, env, args }) => {
    const res = await fieldOutContacts(db, args as any, env);
    return JSON.stringify(res);
  },
};
