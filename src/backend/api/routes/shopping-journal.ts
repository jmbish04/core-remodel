import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getAgentByName } from "agents";

import {
  shoppingJournalEntries,
  journalAttachments,
} from "@backend/db/schema/home/shopping_journal";
import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import { GoogleMapsService } from "../../services/google/maps";
import { getGoogleMapsApiKey } from "@/backend/utils/secrets";
import { generateStructuredOutput } from "../../ai/providers";
import type { ResearchAgent } from "../../ai/agents/ResearchAgent";
import type { BudgetAgent } from "../../ai/agents/BudgetAgent";

export const shoppingJournalRouter = new Hono<{ Bindings: Env }>();

// Zod validation schemas
const createJournalSchema = z.object({
  companyName: z.string().min(1),
  phoneNumber: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(), // PlateJS slate stringified JSON
});

const AI_EXTRACTION_SCHEMA = z.object({
  extractedProducts: z.array(z.string()).describe("List of products/materials mentioned in showroom trip notes (e.g. tile, flooring, granite, oak cabinets)."),
  estimatedCostCents: z.number().int().nullable().describe("Total estimated cost or price in cents, if mentioned in notes (use null if not explicitly mentioned)."),
  deepResearchTopic: z.string().nullable().describe("A clean topic for a Deep Research task, e.g. 'Marble flooring pricing in San Francisco Bay Area'. Should only be generated if products or companies are named."),
  hasPricing: z.boolean().describe("Whether any explicit pricing/quotes details were found in the notes."),
});

// Helper: Convert File to Base64 data-URL for Workers AI Vision
async function fileToDataUrl(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return `data:${file.type || "image/png"};base64,${base64}`;
}

// ---------------------------------------------------------------------------
// POST /enrich — Auto-enrich company details via Google Places API
// ---------------------------------------------------------------------------
shoppingJournalRouter.post("/enrich", async (c) => {
  try {
    const body = await c.req.json<{ query?: string }>();
    const query = body.query?.trim();
    if (!query) {
      return c.json({ error: "Search query is required" }, 400);
    }

    const mapsService = new GoogleMapsService(c.env);
    const hasQuota = await mapsService.canUseGoogleMaps();
    if (!hasQuota) {
      return c.json({ error: "Google Maps service is rate limited for this month" }, 429);
    }

    const gmapKey = await getGoogleMapsApiKey(c.env);
    const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.id",
      },
      body: JSON.stringify({ textQuery: query }),
      signal: AbortSignal.timeout(5000),
    });

    if (!placesRes.ok) {
      const errorText = await placesRes.text();
      console.error("Google Places API error:", errorText);
      return c.json({ error: "Google Places API failed to return data" }, 500);
    }

    const placesData = (await placesRes.json()) as any;
    const place = placesData.places?.[0];

    // Log the Maps usage to stay within budget limit tracker
    await mapsService.logUsage("places:searchText", { textQuery: query }, placesData);

    if (!place) {
      return c.json({ success: false, message: "No company found for this query" });
    }

    return c.json({
      success: true,
      data: {
        companyName: place.displayName?.text || "",
        address: place.formattedAddress || "",
        phoneNumber: place.nationalPhoneNumber || "",
        website: place.websiteUri || "",
      },
    });
  } catch (error) {
    console.error("Failed to enrich company details:", error);
    return c.json({ error: "Enrichment failed", detail: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET / — List all journal entries
// ---------------------------------------------------------------------------
shoppingJournalRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const entries = await db
      .select()
      .from(shoppingJournalEntries)
      .orderBy(desc(shoppingJournalEntries.createdAt))
      .all();

    const result = await Promise.all(
      entries.map(async (entry) => {
        const attachments = await db
          .select()
          .from(journalAttachments)
          .where(eq(journalAttachments.journalEntryId, entry.id))
          .all();

        const researchSession = entry.researchSessionId
          ? await db.select().from(researchSessions).where(eq(researchSessions.id, entry.researchSessionId)).get()
          : null;

        return {
          ...entry,
          attachmentsCount: attachments.length,
          attachments: attachments.map((a) => ({ id: a.id, type: a.type, url: a.url, aiDescription: a.aiDescription })),
          researchSession: researchSession ? { id: researchSession.id, status: researchSession.status, topic: researchSession.topic } : null,
        };
      })
    );

    return c.json({ success: true, entries: result });
  } catch (error) {
    console.error("List shopping journal error:", error);
    return c.json({ error: "Failed to load journal entries", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id — Get single journal entry detail
// ---------------------------------------------------------------------------
shoppingJournalRouter.get("/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const db = drizzle(c.env.DB);
    const entry = await db
      .select()
      .from(shoppingJournalEntries)
      .where(eq(shoppingJournalEntries.id, id))
      .get();

    if (!entry) return c.json({ error: "Journal entry not found" }, 404);

    const attachments = await db
      .select()
      .from(journalAttachments)
      .where(eq(journalAttachments.journalEntryId, id))
      .all();

    const researchSession = entry.researchSessionId
      ? await db.select().from(researchSessions).where(eq(researchSessions.id, entry.researchSessionId)).get()
      : null;

    return c.json({
      success: true,
      entry: {
        ...entry,
        attachments,
        researchSession,
      },
    });
  } catch (error) {
    console.error("Get journal entry error:", error);
    return c.json({ error: "Failed to load journal entry", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST / — Create new journal entry & run async AI extraction + research pipeline
// ---------------------------------------------------------------------------
shoppingJournalRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createJournalSchema.parse(body);

    const db = drizzle(c.env.DB);

    // Save entry to D1
    const [entry] = await db
      .insert(shoppingJournalEntries)
      .values({
        companyName: parsed.companyName,
        phoneNumber: parsed.phoneNumber,
        email: parsed.email,
        website: parsed.website,
        contactPerson: parsed.contactPerson,
        address: parsed.address,
        notes: parsed.notes,
      })
      .returning();

    // Async AI processing: extract products, costs, and trigger deep research in background
    if (parsed.notes && parsed.notes.length > 10) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            // Extract using Workers AI generateStructuredOutput
            const extraction = await generateStructuredOutput(c.env, {
              messages: [
                {
                  role: "system",
                  content: "You are an AI cost-reconciliation agent studying shopping visit notes to extract showroom products, cost metrics, and deep-research topics.",
                },
                {
                  role: "user",
                  content: `Here are notes from our showroom visit to "${parsed.companyName}":\n\n${parsed.notes}`,
                },
              ],
              schema: AI_EXTRACTION_SCHEMA,
              schemaName: "ShoppingNotesExtraction",
            });

            console.log("Extracted notes details:", extraction);

            // 1. If deep research is recommended, launch Deep Research project
            if (extraction.deepResearchTopic) {
              const researchTopic = extraction.deepResearchTopic;
              const promptText = `Find customer reviews of the showroom "${parsed.companyName}", locate general pricing details on these products: [${extraction.extractedProducts.join(", ")}], search for competitive alternative vendors, and compile an analysis report.`;

              // Insert researchSession record
              const [session] = await db
                .insert(researchSessions)
                .values({
                  topic: researchTopic,
                  prompt: promptText,
                  status: "pending",
                })
                .returning();

              // Link researchSession back to the journal entry
              await db
                .update(shoppingJournalEntries)
                .set({ researchSessionId: session.id })
                .where(eq(shoppingJournalEntries.id, entry.id))
                .run();

              // Launch ResearchAgent DO
              try {
                const agent = await getAgentByName<Env, ResearchAgent>(
                  c.env.RESEARCH_AGENT as any,
                  `research-${session.id}`
                );
                (agent as any).startResearch({
                  topic: researchTopic,
                  sessionId: session.id,
                  prompt: promptText,
                  mode: "standard",
                  visualization: "off",
                  enableMcpBridge: false,
                }).catch((err: unknown) => {
                  console.error(`Automated research dispatch failed for session ${session.id}:`, err);
                });
              } catch (err) {
                console.error("Failed to fetch/connect to ResearchAgent DO:", err);
                await db
                  .update(researchSessions)
                  .set({ status: "failed", errorMessage: "Failed to dispatch ResearchAgent" })
                  .where(eq(researchSessions.id, session.id))
                  .run();
              }
            }

            // 2. If pricing was extracted, trigger the stateful BudgetAgent DO onBudgetChange
            if (extraction.hasPricing && extraction.estimatedCostCents) {
              try {
                const budgetAgent = await getAgentByName<Env, BudgetAgent>(
                  c.env.BUDGET_AGENT as any,
                  "global-budget-agent"
                );
                if (typeof (budgetAgent as any).onBudgetChange === "function") {
                  c.executionCtx.waitUntil(
                    (budgetAgent as any).onBudgetChange({
                      type: "journal_quote_extraction",
                      companyName: parsed.companyName,
                      estimatedCostCents: extraction.estimatedCostCents,
                      products: extraction.extractedProducts,
                      timestamp: Date.now(),
                    })
                  );
                }
              } catch (err) {
                console.error("Failed to notify BudgetAgent DO of quote cost extraction:", err);
              }
            }
          } catch (aiErr) {
            console.error("AI notes processing extraction failed:", aiErr);
          }
        })()
      );
    }

    return c.json({ success: true, entryId: entry.id });
  } catch (error) {
    console.error("Create journal entry failed:", error);
    return c.json({ error: "Failed to create entry", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/attachments — Multi-file attachment uploads with Workers AI Vision descriptions
// ---------------------------------------------------------------------------
shoppingJournalRouter.post("/:id/attachments", async (c) => {
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const db = drizzle(c.env.DB);
    const entry = await db.select().from(shoppingJournalEntries).where(eq(shoppingJournalEntries.id, id)).get();
    if (!entry) return c.json({ error: "Shopping journal entry not found" }, 404);

    const formData = await c.req.formData();
    const files = formData.getAll("files");

    if (files.length === 0) {
      return c.json({ error: "No files uploaded" }, 400);
    }

    const uploadedAttachments: Array<{ id: number; url: string }> = [];

    for (const fileItem of files) {
      if (!(fileItem instanceof File)) continue;

      const file = fileItem as File;
      const isImage = file.type.startsWith("image/");
      let url = "";
      let r2Key: string | null = null;
      let cfImageId: string | null = null;
      let hostingService: "cloudflare_images" | "r2" = "r2";

      if (isImage) {
        // Upload to Cloudflare Images
        const accountId = await c.env.CLOUDFLARE_ACCOUNT_ID.get();
        const cfImagesToken = await c.env.CF_IMAGES_TOKEN.get();

        if (accountId && cfImagesToken) {
          const imgFormData = new FormData();
          imgFormData.append("file", file, file.name);

          const cfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cfImagesToken}`,
              },
              body: imgFormData,
            }
          );

          const cfData = (await cfRes.json()) as any;
          if (cfData.success && cfData.result?.variants?.[0]) {
            url = cfData.result.variants[0];
            cfImageId = cfData.result.id;
            hostingService = "cloudflare_images";
          }
        }
      }

      // Fallback or Non-Image: Upload to R2 Bucket
      if (!url) {
        const uuid = crypto.randomUUID();
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
        r2Key = `journal_attachments/${id}/${timestamp}-${uuid}-${safeName}`;

        await c.env.ARTIFACTS_BUCKET.put(r2Key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
          customMetadata: {
            journalEntryId: String(id),
            filename: file.name,
            uploadedAt: new Date().toISOString(),
          },
        });

        url = `/api/artifacts/${r2Key}`;
        hostingService = "r2";
      }

      // Save attachment meta in D1
      const [attachment] = await db
        .insert(journalAttachments)
        .values({
          journalEntryId: id,
          type: file.type || "application/octet-stream",
          hostingService,
          url,
          r2Key,
          cfImageId,
          aiDescription: "Analyzing file contents...",
        })
        .returning();

      uploadedAttachments.push({ id: attachment.id, url });

      // Background task to trigger Workers AI Vision
      c.executionCtx.waitUntil(
        (async () => {
          try {
            let description = "";

            if (isImage) {
              const dataUrl = await fileToDataUrl(file);
              const aiRes = await c.env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "This is a photo/document from a showroom shopping trip. Please describe what is shown in this picture, highlighting any product names, styles, specifications, colors, or visible price tags. Return a direct 2-3 sentence description.",
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: dataUrl,
                        },
                      },
                    ],
                  },
                ],
                max_tokens: 500,
              });

              if (aiRes && typeof (aiRes as any).response === "string") {
                description = (aiRes as any).response.trim();
              } else {
                description = "Image attachment analyzed successfully.";
              }
            } else {
              description = `Uploaded document "${file.name}" of type ${file.type || "unknown"}.`;
            }

            // Update description in D1
            await db
              .update(journalAttachments)
              .set({ aiDescription: description })
              .where(eq(journalAttachments.id, attachment.id))
              .run();

            console.log(`Updated attachment description for ID ${attachment.id}:`, description);
          } catch (visionErr) {
            console.error(`AI Vision failed to generate description for ID ${attachment.id}:`, visionErr);
            await db
              .update(journalAttachments)
              .set({ aiDescription: "Failed to compile visual description." })
              .where(eq(journalAttachments.id, attachment.id))
              .run();
          }
        })()
      );
    }

    return c.json({ success: true, attachments: uploadedAttachments });
  } catch (error) {
    console.error("Failed to upload attachments:", error);
    return c.json({ error: "Upload failed", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — Delete journal entry & all attachments from R2/CF Images
// ---------------------------------------------------------------------------
shoppingJournalRouter.delete("/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const db = drizzle(c.env.DB);
    const entry = await db.select().from(shoppingJournalEntries).where(eq(shoppingJournalEntries.id, id)).get();
    if (!entry) return c.json({ error: "Entry not found" }, 404);

    const attachments = await db.select().from(journalAttachments).where(eq(journalAttachments.journalEntryId, id)).all();

    // Delete files from R2 and Cloudflare Images
    const deletePromises: Promise<void>[] = [];
    const accountId = await c.env.CLOUDFLARE_ACCOUNT_ID.get();
    const cfImagesToken = await c.env.CF_IMAGES_TOKEN.get();

    for (const attachment of attachments) {
      if (attachment.hostingService === "r2" && attachment.r2Key) {
        deletePromises.push(c.env.ARTIFACTS_BUCKET.delete(attachment.r2Key));
      } else if (attachment.hostingService === "cloudflare_images" && attachment.cfImageId && accountId && cfImagesToken) {
        const deleteUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${attachment.cfImageId}`;
        deletePromises.push(
          fetch(deleteUrl, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${cfImagesToken}` },
          }).then((res) => {
            if (!res.ok) console.error(`Failed to delete Cloudflare Image ${attachment.cfImageId}`);
          }) as any
        );
      }
    }

    await Promise.allSettled(deletePromises);

    // Delete from D1 (cascade delete will handle attachments)
    await db.delete(shoppingJournalEntries).where(eq(shoppingJournalEntries.id, id)).run();

    return c.json({ success: true, message: "Journal entry and associated attachments deleted successfully." });
  } catch (error) {
    console.error("Delete journal entry failed:", error);
    return c.json({ error: "Delete failed", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});
