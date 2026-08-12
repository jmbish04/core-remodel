import { driveDocuments } from "@backend/db";
import { suggestDispositions } from "@backend/services/email/disposition";
import { getInstructions } from "@backend/services/email/instructions";
import { resolveRecipient } from "@backend/services/email/resolve-recipient";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** D1 caps a statement at 100 bound params; keep well under it. */
const ID_CHUNK = 20;

export const composeVendorEmailTool = defineTool({
  name: "compose_vendor_email",
  category: "email",
  title: "Compose a vendor email payload",
  description:
    "Assemble a send-ready vendor-email payload: resolves the recipient (via resolve_recipient's logic), pulls the reusable instructions doc, loads the chosen Drive files with their share state, and suggests attach-vs-link per file against Gmail's ~18 MiB usable budget. THIS TOOL ASSEMBLES CONTEXT ONLY — it sends nothing and changes no Drive sharing. Hand the returned payload to the google-workspace-mcp worker's gmail_send / schedule_email to actually send. If the recipient can't be resolved uniquely, this returns the same ok:false/candidates shape as resolve_recipient — ask the user rather than guessing.",
  inputShape: {
    email: z.string().optional().describe("Explicit recipient email address"),
    store: z.string().optional().describe("Showroom store id or name substring"),
    contact: z.string().optional().describe("Contact name or role substring at that store"),
    subject: z.string().describe("Email subject line"),
    intent: z
      .string()
      .optional()
      .describe(
        "Short note on why this email is being sent, for the composing agent's own context",
      ),
    driveDocumentIds: z
      .array(z.number().int())
      .optional()
      .describe("Drive document ids to include as attachments/links"),
  },
  annotations: READ_ONLY,
  outputShape: {
    ok: z.boolean().optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    candidates: z.array(looseObject({})).optional(),
    to: z.array(z.string()).optional(),
    subject: z.string().optional(),
    instructionsMarkdown: z.string().optional(),
    attachments: z
      .array(
        looseObject({
          driveDocumentId: z.number().int(),
          name: z.string(),
          mimeType: z.string(),
          sizeBytes: z.number().int().nullable(),
          webViewUrl: z.string(),
          sharing: z.string(),
          suggestedDisposition: z.enum(["attach", "link"]),
        }),
      )
      .optional(),
  },
  examples: [
    {
      title: "Compose to a named store contact with two Drive files",
      args: {
        store: "Pietra Fina",
        contact: "Nancy",
        subject: "Quote request — primary bath countertop",
        driveDocumentIds: [12, 34],
      },
    },
  ],
  handler: async ({ db }, input) => {
    const resolved = await resolveRecipient(db, {
      email: input.email,
      store: input.store,
      contact: input.contact,
    });
    if (!resolved.ok) {
      // Never guess — hand the ambiguity/failure back to the agent verbatim.
      return {
        ok: false,
        reason: resolved.reason,
        message: resolved.message,
        candidates: resolved.candidates,
      };
    }

    const instructions = await getInstructions(db);

    type DriveFileRow = {
      id: number;
      name: string;
      mimeType: string;
      sizeBytes: number | null;
      webViewUrl: string;
      sharing: string;
    };
    const ids = input.driveDocumentIds ?? [];
    const files: DriveFileRow[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = await db
        .select({
          id: driveDocuments.id,
          name: driveDocuments.name,
          mimeType: driveDocuments.mimeType,
          sizeBytes: driveDocuments.sizeBytes,
          webViewUrl: driveDocuments.webViewUrl,
          sharing: driveDocuments.sharing,
        })
        .from(driveDocuments)
        .where(
          and(
            inArray(driveDocuments.id, chunk),
            eq(driveDocuments.isActive, true),
            eq(driveDocuments.isDeleted, false),
          ),
        );
      files.push(...rows);
    }

    const dispositions = suggestDispositions(
      files.map((f) => ({ driveDocumentId: f.id, sizeBytes: f.sizeBytes })),
    );
    const dispositionById = new Map(
      dispositions.map((d) => [d.driveDocumentId, d.suggestedDisposition]),
    );

    return {
      to: resolved.recipients.map((r) => r.email),
      subject: input.subject,
      instructionsMarkdown: instructions.markdown,
      attachments: files.map((f) => ({
        driveDocumentId: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        webViewUrl: f.webViewUrl,
        sharing: f.sharing,
        suggestedDisposition: dispositionById.get(f.id) ?? "link",
      })),
    };
  },
});
