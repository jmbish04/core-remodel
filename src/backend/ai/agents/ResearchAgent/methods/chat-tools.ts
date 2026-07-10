/**
 * @fileoverview Data-grounding chat tools for the ResearchAgent's RAG chat.
 *
 * These are AI SDK `tool()` definitions exposed to `streamText` inside
 * `onChatMessage`. They let the assistant pull live D1 records (Materials
 * Schedule, Showrooms, Products) and run global Vectorize RAG over the
 * `RESEARCH_INDEX`, so the Deep Research portal chat can have deep,
 * data-grounded conversations.
 *
 * The tool *names* are the contract with the frontend's assistant-ui
 * generative-UI (`makeAssistantToolUI`) — keep them stable:
 *   - list_materials
 *   - list_showrooms
 *   - list_products
 *   - search_research  (global RAG across every embedded research session)
 *
 * All tools are READ-ONLY. No mutations happen from chat.
 */

import { tool } from "ai";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray, like } from "drizzle-orm";

import { materialScheduleItems } from "@backend/db/schema/materials/index";
import { rooms } from "@backend/db/schema/home/rooms";
import { showroomStores, showroomStoreProducts } from "@backend/db/schema/showroom/index";

const LIMIT = 25;

/**
 * Build the chat data-grounding tool set bound to the agent's `env`.
 * Returned object is spread straight into `streamText({ tools })`.
 */
export function buildChatDataTools(env: Env) {
  return {
    list_materials: tool({
      description:
        "List Materials Schedule items from the renovation D1 database. Use when the homeowner asks about what materials are needed/purchased, by room, or to ground cost/spec advice in their actual schedule.",
      inputSchema: z.object({
        room: z.string().optional().describe("Filter by room name, e.g. 'Kitchen'."),
        purchased: z.boolean().optional().describe("Filter by purchased status."),
        search: z.string().optional().describe("Substring match on the material title."),
      }),
      execute: async ({ room, purchased, search }) => {
        const db = drizzle(env.DB);
        const conditions = [];
        if (room) {
          // Room filter is by name (homeowner UX) → resolve to canonical room ids.
          const rs = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.roomName, room)).all();
          if (rs.length === 0) return { count: 0, items: [] }; // inArray([]) is invalid SQL on D1
          conditions.push(inArray(materialScheduleItems.roomId, rs.map((r) => r.id)));
        }
        if (typeof purchased === "boolean") {
          conditions.push(eq(materialScheduleItems.isPurchased, purchased));
        }
        if (search) conditions.push(like(materialScheduleItems.title, `%${search}%`));

        let q = db
          .select()
          .from(materialScheduleItems)
          .orderBy(desc(materialScheduleItems.dateAdded))
          .limit(LIMIT)
          .$dynamic();
        if (conditions.length > 0) q = q.where(and(...conditions));

        const rows = await q;
        // Derive room names (no stored column) in one query.
        const roomIds = [...new Set(rows.map((r) => r.roomId))];
        const roomName = roomIds.length
          ? new Map(
              (await db.select({ id: rooms.id, roomName: rooms.roomName }).from(rooms).where(inArray(rooms.id, roomIds)).all()).map(
                (r) => [r.id, r.roomName],
              ),
            )
          : new Map<number, string>();
        const items = rows.map((m) => ({
          id: m.id,
          title: m.title,
          room: roomName.get(m.roomId) ?? null,
          brand: m.brand,
          model: m.model,
          purchased: m.isPurchased,
        }));
        return { count: rows.length, items };
      },
    }),

    list_showrooms: tool({
      description:
        "List Bay Area showroom stores tracked for sourcing. Use to recommend where to buy a material or to ground vendor advice in the homeowner's directory.",
      inputSchema: z.object({
        search: z.string().optional().describe("Substring match on the showroom name."),
        pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
      }),
      execute: async ({ search, pricePoint }) => {
        const db = drizzle(env.DB);
        const conditions = [];
        if (search) conditions.push(like(showroomStores.name, `%${search}%`));
        if (pricePoint) conditions.push(eq(showroomStores.pricePoint, pricePoint));

        let q = db
          .select()
          .from(showroomStores)
          .orderBy(desc(showroomStores.createdAt))
          .limit(LIMIT)
          .$dynamic();
        if (conditions.length > 0) q = q.where(and(...conditions));

        const rows = await q;
        const stores = rows.map((s) => ({
          id: s.id,
          name: s.name,
          pricePoint: s.pricePoint,
          websiteUrl: s.websiteUrl,
          scale: s.scale,
        }));
        return { count: rows.length, stores };
      },
    }),

    list_products: tool({
      description:
        "List products captured across showrooms. Optionally scope to one showroom by storeId. Use to compare options or ground product recommendations in real captured items.",
      inputSchema: z.object({
        storeId: z.number().int().optional().describe("Scope to one showroom's products."),
        search: z.string().optional().describe("Substring match on the product item name."),
      }),
      execute: async ({ storeId, search }) => {
        const db = drizzle(env.DB);
        const conditions = [];
        if (typeof storeId === "number") {
          conditions.push(eq(showroomStoreProducts.storeId, storeId));
        }
        if (search) conditions.push(like(showroomStoreProducts.itemName, `%${search}%`));

        let q = db
          .select()
          .from(showroomStoreProducts)
          .orderBy(desc(showroomStoreProducts.createdAt))
          .limit(LIMIT)
          .$dynamic();
        if (conditions.length > 0) q = q.where(and(...conditions));

        const rows = await q;
        const products = rows.map((p) => ({
          id: p.id,
          itemName: p.itemName,
          storeId: p.storeId,
          sku: p.sku,
          price: p.price,
          leadTime: p.leadTime,
        }));
        return { count: rows.length, products };
      },
    }),

    search_research: tool({
      description:
        "Semantic search across ALL embedded deep-research documents (global RAG over the RESEARCH_INDEX). Use to recall findings from any past research session, not just the current one.",
      inputSchema: z.object({
        query: z.string().describe("The natural-language search query."),
        topK: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ query, topK }) => {
        try {
          const embedding = (await env.AI.run(
            "@cf/baai/bge-large-en-v1.5",
            { text: [query] },
            { gateway: { id: env.AI_GATEWAY_ID } },
          )) as { data: number[][] };

          const results = await env.RESEARCH_INDEX.query(embedding.data[0], {
            topK: topK ?? 6,
            returnMetadata: "all",
          });

          const matches = (results.matches ?? [])
            .filter((m) => (m.score ?? 0) > 0.45)
            .map((m) => ({
              score: Number((m.score ?? 0).toFixed(3)),
              namespace: m.namespace ?? null,
              text: ((m.metadata as Record<string, unknown>)?.textPreview as string) ?? "",
            }))
            .filter((m) => m.text);

          return { count: matches.length, matches };
        } catch (err) {
          return {
            count: 0,
            matches: [],
            error: err instanceof Error ? err.message : "search failed",
          };
        }
      },
    }),
  };
}
