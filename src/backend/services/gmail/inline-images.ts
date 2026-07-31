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
import { and, eq } from "drizzle-orm";
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
  const currentRows = () =>
    db.select().from(gmailMessageImages).where(eq(gmailMessageImages.gmailMessageId, message.id)).all();

  if (message.imagesExtracted) return currentRows();

  // Atomically CLAIM the extraction: flip images_extracted false→true and only
  // proceed if THIS request won the flip. A concurrent viewer that loses the
  // race returns the current rows instead of fetching + uploading again. On
  // failure we reset the flag so a later view retries. (Combined with the
  // UNIQUE(gmail_message_id, content_id) index, duplicate rows are impossible.)
  const claimed = await db
    .update(gmailMessages)
    .set({ imagesExtracted: true })
    .where(and(eq(gmailMessages.id, message.id), eq(gmailMessages.imagesExtracted, false)))
    .returning({ id: gmailMessages.id })
    .all();
  if (claimed.length === 0) return currentRows();

  // Resolve CF Images credentials; if unavailable, release the claim so a later
  // configured run can still populate images.
  const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
  const [primaryToken, ...fallbackApiTokens] = apiTokens ?? [];
  if (!accountId || !primaryToken) {
    console.warn("[gmail] inline-images: Cloudflare Images not configured — skipping");
    await db.update(gmailMessages).set({ imagesExtracted: false }).where(eq(gmailMessages.id, message.id)).run();
    return currentRows();
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
    // The claim already set images_extracted=true; individual per-image failures
    // above are logged + skipped, and the message stays "checked" so we never
    // re-fetch it from Gmail just to rediscover it has no (more) inline images.
  } catch (err) {
    // A whole-message failure (Gmail fetch, etc.): release the claim so a later
    // view retries rather than leaving the message permanently "checked".
    console.error(`[gmail] inline-images: extraction failed for msg ${message.messageId}:`, err);
    await db.update(gmailMessages).set({ imagesExtracted: false }).where(eq(gmailMessages.id, message.id)).run();
  }

  return currentRows();
}
