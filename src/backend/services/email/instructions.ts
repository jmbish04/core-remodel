import type { drizzle } from "drizzle-orm/d1";

/**
 * @fileoverview Read/write the single email_instructions row. HTML is
 * sanitized with the repo's existing sanitizeNoteHtml on every write — never
 * store raw html. Both the MCP tools and the API route go through here so the
 * two surfaces cannot diverge.
 */
import { emailInstructions } from "@backend/db";
import { sanitizeNoteHtml } from "@backend/services/notes/markdown";
import { eq } from "drizzle-orm";

const ROW_ID = 1;

export async function getInstructions(
  db: ReturnType<typeof drizzle>,
): Promise<{ markdown: string; html: string; updatedAt: Date | null }> {
  const [row] = await db
    .select()
    .from(emailInstructions)
    .where(eq(emailInstructions.id, ROW_ID))
    .limit(1);
  return {
    markdown: row?.instructionsMarkdown ?? "",
    html: row?.instructionsHtml ?? "",
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function upsertInstructions(
  db: ReturnType<typeof drizzle>,
  input: { markdown: string; html: string },
): Promise<{ markdown: string; html: string }> {
  const html = sanitizeNoteHtml(input.html);
  const markdown = input.markdown;
  await db
    .insert(emailInstructions)
    .values({
      id: ROW_ID,
      instructionsMarkdown: markdown,
      instructionsHtml: html,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailInstructions.id,
      set: { instructionsMarkdown: markdown, instructionsHtml: html, updatedAt: new Date() },
    });
  return { markdown, html };
}
