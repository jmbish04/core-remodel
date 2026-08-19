import { resolveRecipient } from "@backend/services/email/resolve-recipient";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const resolveRecipientTool = defineTool({
  name: "resolve_recipient",
  category: "email",
  title: "Resolve an email recipient",
  description:
    "Turn a recipient reference into an email address. Pass `email` for an explicit address (validated, passed through), or `store` (id or name substring) plus optional `contact` (name/role substring) to look up a showroom store's contact. Returns the resolved recipient(s), or — when nothing matches or several do — `ok:false` with the reason and candidates. NEVER guesses; if it returns ok:false, ask the user rather than picking one.",
  inputShape: {
    email: z.string().optional().describe("Explicit recipient email address"),
    store: z.string().optional().describe("Showroom store id or name substring"),
    contact: z.string().optional().describe("Contact name or role substring at that store"),
  },
  annotations: READ_ONLY,
  outputShape: {
    ok: z.boolean(),
    reason: z.string().optional(),
    message: z.string().optional(),
    recipients: z
      .array(
        looseObject({
          email: z.string(),
          name: z.string().nullable(),
          storeId: z.number().int().nullable(),
          storeName: z.string().nullable(),
          contactType: z.string().nullable(),
        }),
      )
      .optional(),
    candidates: z.array(looseObject({})).optional(),
  },
  examples: [
    { title: "Resolve a named contact", args: { store: "Pietra Fina", contact: "Nancy" } },
    { title: "Pass through an explicit address", args: { email: "nancy@pietrafina.com" } },
  ],
  handler: async ({ db }, input) => {
    const result = await resolveRecipient(db, input);
    return result.ok
      ? { ok: true, recipients: result.recipients }
      : {
          ok: false,
          reason: result.reason,
          message: result.message,
          candidates: result.candidates,
        };
  },
});
