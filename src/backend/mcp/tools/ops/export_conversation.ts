import { mcpConversations } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { conversationUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

/** Inline-vs-R2 threshold (chars) for an exported transcript's content. */
const CONVERSATION_INLINE_CAP = 96_000;

export const exportConversation = defineTool({
    name: "export_conversation",
    category: "ops",
    title: "Export the current conversation",
    description:
      "Persist the current chat onto the Worker so it survives after the session ends (the 'save our conversation' " +
      "tool). Pass the transcript you hold as `messages` (Markdown by default, or a JSON string with format='json'), " +
      "a short `title`, and an optional `summary`. If you pass a `sessionId` and re-export in the same session, the " +
      "existing record is updated rather than duplicated. Large transcripts are offloaded to R2 automatically. " +
      "Returns the stored id + a viewable URL.",
    inputShape: {
      title: z.string().min(1).describe("Short title for the saved conversation (required)"),
      messages: z
        .string()
        .min(1)
        .describe("The full transcript — Markdown, or a JSON string when format='json' (required)"),
      summary: z.string().optional().describe("Optional 1-2 sentence summary of the chat"),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .describe("Transcript format (default 'markdown')"),
      messageCount: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of messages in the transcript (best-effort)"),
      sessionId: z
        .string()
        .optional()
        .describe("Session id to dedupe against for same-session re-exports"),
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean().optional().describe("True when a new record was inserted"),
      updated: z.boolean().optional().describe("True when an existing same-session record was updated"),
      id: z.number().int().describe("The saved conversation id"),
      url: urlField,
    },
    examples: [
      {
        title: "Save a chat",
        args: {
          title: "Kitchen slab sourcing session",
          summary: "Shortlisted 3 slab showrooms and a faucet.",
          messages: "## User\nfind slab showrooms…\n\n## Assistant\n…",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const messages = input.messages?.trim();
      const title = input.title?.trim();
      if (!messages) toolError("`messages` is required and cannot be empty.");
      if (!title) toolError("`title` is required and cannot be empty.");
      const format = input.format ?? "markdown";
      const messageCount = input.messageCount ?? 0;

      // Offload large transcripts to R2; keep the D1 row lean with a key.
      let storage: "inline" | "r2" = "inline";
      let content = messages;
      if (messages.length > CONVERSATION_INLINE_CAP) {
        const key = `mcp-conversations/${crypto.randomUUID()}.${format === "json" ? "json" : "md"}`;
        await env.ARTIFACTS_BUCKET.put(key, messages, {
          httpMetadata: {
            contentType: format === "json" ? "application/json" : "text/markdown",
          },
        });
        storage = "r2";
        content = key;
      }

      // Same-session re-export → update the existing row instead of duplicating.
      if (input.sessionId) {
        const [existing] = await db
          .select({ id: mcpConversations.id })
          .from(mcpConversations)
          .where(
            and(
              eq(mcpConversations.sessionId, input.sessionId),
              eq(mcpConversations.title, title),
            ),
          )
          .limit(1);
        if (existing) {
          await db
            .update(mcpConversations)
            .set({
              summary: input.summary,
              format,
              storage,
              content,
              messageCount,
              updatedAt: new Date(),
            })
            .where(eq(mcpConversations.id, existing.id))
            .run();
          return {
            updated: true,
            id: existing.id,
            url: conversationUrl(env, existing.id),
          };
        }
      }

      const [created] = await db
        .insert(mcpConversations)
        .values({
          sessionId: input.sessionId,
          title,
          summary: input.summary,
          format,
          storage,
          content,
          messageCount,
        })
        .returning({ id: mcpConversations.id });
      return { created: true, id: created.id, url: conversationUrl(env, created.id) };
    },
  });
