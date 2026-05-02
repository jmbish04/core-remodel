import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import type { Bindings } from "../index";

import { imageReviews } from "../../db/schema";

const photoReviewsRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /api/photo-reviews
 * Returns all image reviews, grouped by room (like the python app)
 */
photoReviewsRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const allImages = await db.select().from(imageReviews).orderBy(asc(imageReviews.filename));

    // Group by room
    const groupsMap = new Map<string, typeof allImages>();
    for (const img of allImages) {
      const room = img.room || "unassigned";
      if (!groupsMap.has(room)) {
        groupsMap.set(room, []);
      }
      groupsMap.get(room)!.push(img);
    }

    const groups = Array.from(groupsMap.entries())
      .map(([room, images]) => ({ room, images }))
      .sort((a, b) => a.room.localeCompare(b.room));

    return c.json({
      images: allImages,
      groups,
    });
  } catch (error) {
    console.error("List photo reviews error:", error);
    return c.json({ error: "Failed to list images" }, 500);
  }
});

/**
 * POST /api/photo-reviews/upload
 * Upload an image to R2, use Workers AI to tag it, save to D1
 */
photoReviewsRouter.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const filename = file.name;
    const fileExtension = filename.split(".").pop();
    const id = crypto.randomUUID();
    const path = `uploads/${id}.${fileExtension}`;

    // Upload to R2
    await c.env.IMAGES_BUCKET.put(path, fileBuffer, {
      httpMetadata: { contentType: file.type },
    });

    // Run AI Vision
    // Use llama-3.2-11b-vision-instruct
    let room = "unassigned";
    let tags = [];

    try {
      const aiResponse = (await c.env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Analyze this interior design/architecture photo. Reply in JSON format with exactly two keys: "room" (a short string like "Kitchen", "Bathroom", "Living Room", or "Exterior") and "tags" (an array of strings describing styles, materials, or features).',
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${file.type};base64,${Buffer.from(fileBuffer).toString("base64")}`,
                },
              },
            ],
          },
        ],
      })) as any;

      // Extract JSON from response
      const responseText = aiResponse.response;
      // Try to parse out JSON if it's wrapped in markdown
      const jsonMatch =
        responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/{[\s\S]*}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        if (parsed.room) room = parsed.room.toLowerCase();
        if (parsed.tags && Array.isArray(parsed.tags))
          tags = parsed.tags.map((t: string) => t.toLowerCase());
      }
    } catch (aiError) {
      console.error("AI analysis failed:", aiError);
      // fallback to unassigned if AI fails
    }

    // Save to D1
    const db = drizzle(c.env.DB);
    const newRecord = {
      id,
      path,
      filename,
      room,
      tags: JSON.stringify(tags),
      updatedAt: new Date(),
    };

    await db.insert(imageReviews).values(newRecord).run();

    return c.json({ success: true, image: newRecord });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Failed to upload and process image" }, 500);
  }
});

/**
 * POST /api/photo-reviews/:id
 * Update an existing photo review record
 */
photoReviewsRouter.post("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const db = drizzle(c.env.DB);

    const existing = await db.select().from(imageReviews).where(eq(imageReviews.id, id)).get();
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const updates: any = { updatedAt: new Date() };
    if (body.room !== undefined) updates.room = body.room.toLowerCase();
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
    if (body.note !== undefined) updates.note = body.note;
    if (body.sourceFile !== undefined) updates.sourceFile = body.sourceFile;
    if (body.imageNumber !== undefined) updates.imageNumber = body.imageNumber;
    if (body.igAccount !== undefined) updates.igAccount = body.igAccount;
    if (body.visibleCaption !== undefined) updates.visibleCaption = body.visibleCaption;

    await db.update(imageReviews).set(updates).where(eq(imageReviews.id, id)).run();

    const updated = await db.select().from(imageReviews).where(eq(imageReviews.id, id)).get();
    return c.json({ success: true, image: updated });
  } catch (error) {
    console.error("Update error:", error);
    return c.json({ error: "Failed to update record" }, 500);
  }
});

/**
 * GET /api/photo-reviews/image/:path
 * Serve the image directly from R2
 */
photoReviewsRouter.get("/image/:path{.*}", async (c) => {
  const path = c.req.param("path");
  try {
    const object = await c.env.IMAGES_BUCKET.get(path);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    return new Response(object.body, { headers });
  } catch (err) {
    return new Response("Error retrieving image", { status: 500 });
  }
});

export { photoReviewsRouter };
