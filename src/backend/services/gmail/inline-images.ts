/**
 * @fileoverview Embedded-image extraction for the Gmail Comms Hub (0041).
 *
 * Marketing/HTML emails reference inline images as `src="cid:..."`, which a
 * browser can't resolve. On first view of a message we fetch those inline image
 * parts from Gmail, upload the bytes to Cloudflare Images, and store the served
 * delivery URL in `gmail_message_images` so the reading pane can show them. The
 * `gmail_messages.images_extracted` flag guards this — each message is fetched +
 * uploaded at most once (true even when it had zero inline images).
 *
 * On-view (not at ingestion) on purpose: only images in threads the user
 * actually opens get uploaded, so a spam blast's images never cost storage
 * unless someone looks at it.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gmailMessageImages, gmailMessages } from "@backend/db";
import type { GmailMessage, GmailMessageImage } from "@backend/db";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";

import { getGmailAccessToken } from "./auth";
import { collectInlineImageParts, getAttachmentBytes, getMessage, base64UrlToBytes } from "./client";

/** A slug-safe custom id for Cloudflare Images from a message id + content id. */
function imageCustomId(messageId: string, contentId: string): string {
  return `gmail-${messageId}-${contentId}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 100);
}

/**
 * Ensure a message's embedded images are uploaded to Cloudflare Images and
 * recorded. Idempotent: returns the existing rows without work when the message
 * is already extracted. Best-effort — any per-image failure is logged and
 * skipped, and the message is still marked extracted so we don't re-fetch it
 * forever. Returns the current set of image rows for the message.
 */
export async function ensureMessageImages(
  env: Env,
  db: ReturnType<typeof drizzle>,
  message: Pick<GmailMessage, "id" | "messageId" | "imagesExtracted">,
): Promise<GmailMessageImage[]> {
  if (message.imagesExtracted) {
    return db.select().from(gmailMessageImages).where(eq(gmailMessageImages.gmailMessageId, message.id)).all();
  }

  // Resolve CF Images credentials once; if unavailable, leave the flag false so
  // a later configured run can still populate images.
  const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
  const [primaryToken, ...fallbackApiTokens] = apiTokens ?? [];
  if (!accountId || !primaryToken) {
    console.warn("[gmail] inline-images: Cloudflare Images not configured — skipping");
    return db.select().from(gmailMessageImages).where(eq(gmailMessageImages.gmailMessageId, message.id)).all();
  }
  const processor = new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });

  try {
    const token = await getGmailAccessToken(env);
    const full = await getMessage(token, message.messageId);
    const inline = collectInlineImageParts(full.payload);

    for (const img of inline) {
      try {
        const bytes = img.inlineData
          ? base64UrlToBytes(img.inlineData)
          : img.attachmentId
            ? await getAttachmentBytes(token, message.messageId, img.attachmentId)
            : new Uint8Array(0);
        if (bytes.length === 0) continue;

        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: img.mimeType || "image/png" });
        const customId = imageCustomId(message.messageId, img.contentId);
        const uploaded = await processor.uploadToCloudflareImages(blob, customId);
        const deliveryUrl = processor.getDeliveryUrl(uploaded, uploaded.result?.id ?? customId);

        await db
          .insert(gmailMessageImages)
          .values({
            gmailMessageId: message.id,
            contentId: img.contentId,
            cfImageId: uploaded.result?.id ?? customId,
            deliveryUrl,
            mimeType: img.mimeType || null,
          })
          .onConflictDoNothing()
          .run();
      } catch (err) {
        console.error(`[gmail] inline-images: failed image cid=${img.contentId} on msg ${message.messageId}:`, err);
      }
    }

    // Mark checked regardless of how many uploaded, so we never re-fetch this
    // message from Gmail just to rediscover it has no (more) inline images.
    await db
      .update(gmailMessages)
      .set({ imagesExtracted: true })
      .where(eq(gmailMessages.id, message.id))
      .run();
  } catch (err) {
    console.error(`[gmail] inline-images: extraction failed for msg ${message.messageId}:`, err);
  }

  return db.select().from(gmailMessageImages).where(eq(gmailMessageImages.gmailMessageId, message.id)).all();
}
