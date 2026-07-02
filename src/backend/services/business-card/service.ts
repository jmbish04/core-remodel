/**
 * @fileoverview Business Card Service
 *
 * Handles two concerns for the Showroom POC (point-of-contact) flow:
 *
 *  1. `uploadCard` — uploads a raw dataUrl (front or back of a business card)
 *     to Cloudflare Images via the project's ImageProcessorService and returns
 *     the delivery URL. Returns null on any failure so callers can safely
 *     continue with partial data.
 *
 *  2. `extractFromImages` — sends the card image(s) through the Workers AI VLM
 *     (kimi-k2.6) with a strict extraction prompt, parses the structured JSON
 *     response, and returns a flat contact object. When both front and back are
 *     provided the results are merged, preferring any non-empty value. Returns
 *     an empty object on total failure.
 *
 * Neither method throws — all errors are logged and swallowed so the calling
 * route can surface partial results rather than a 500.
 */

import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The structured contact fields that Workers AI is asked to extract from a
 * business card image. All fields are optional — the card may not carry every
 * piece of information and extraction is best-effort.
 */
export interface ExtractedContact {
  fullName?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Decode a `data:<mime>;base64,<data>` URL into a Blob.
 * Returns null if the string is not a valid data URL.
 */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, b64] = match;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Strip ```json fences that the VLM sometimes wraps its output in, then
 * parse the cleaned string as JSON. Returns null on any parse failure.
 */
function parseVlmJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Coerce a raw VLM JSON object into our ExtractedContact shape.
 * The model is given explicit key names but may vary casing or use synonyms;
 * we map the most common variants here.
 */
function coerceContact(raw: Record<string, unknown>): ExtractedContact {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  return {
    fullName: str(raw.fullName ?? raw.full_name ?? raw.name),
    title: str(raw.title ?? raw.job_title ?? raw.jobTitle),
    company: str(raw.company ?? raw.organization),
    phone: str(raw.phone ?? raw.phone_number ?? raw.phoneNumber),
    email: str(raw.email ?? raw.email_address ?? raw.emailAddress),
    website: str(raw.website ?? raw.url ?? raw.websiteUrl ?? raw.website_url),
    address: str(raw.address ?? raw.mailing_address ?? raw.mailingAddress),
  };
}

/**
 * Merge two extracted contacts, preferring any non-empty value from `primary`
 * and falling back to `secondary` for each field.
 */
function mergeContacts(
  primary: ExtractedContact,
  secondary: ExtractedContact,
): ExtractedContact {
  return {
    fullName: primary.fullName ?? secondary.fullName,
    title: primary.title ?? secondary.title,
    company: primary.company ?? secondary.company,
    phone: primary.phone ?? secondary.phone,
    email: primary.email ?? secondary.email,
    website: primary.website ?? secondary.website,
    address: primary.address ?? secondary.address,
  };
}

// ─── BusinessCardService ───────────────────────────────────────────────────────

export class BusinessCardService {
  /**
   * Upload one side of a business card to Cloudflare Images.
   *
   * Uses the project's `ImageProcessorService` with the standard
   * `resolveCloudflareImagesCredentials` helper so token selection follows the
   * same priority order used everywhere else (CLOUDFLARE_IMAGES_STREAM_TOKEN →
   * CLOUDFLARE_API_TOKEN → CLOUDFLARE_WORKER_ADMIN_TOKEN → CLOUDFLARE_WRANGLER_API_TOKEN).
   *
   * @param env       - The Worker `Env` binding object (passed from the route handler).
   * @param side      - "front" | "back" — used to build the Cloudflare Images custom ID.
   * @param dataUrl   - A base64 data URL (`data:<mime>;base64,<data>`) from the client.
   * @returns         - The Cloudflare Images delivery URL on success, or `null` on any
   *                   failure (including missing credentials, bad data URL, or upload error).
   *                   Never throws.
   */
  async uploadCard(
    env: Env,
    side: "front" | "back",
    dataUrl: string,
  ): Promise<string | null> {
    try {
      const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
      if (!accountId || apiTokens.length === 0) {
        console.warn("[BusinessCardService] Missing Cloudflare Images credentials — skipping upload");
        return null;
      }

      const blob = dataUrlToBlob(dataUrl);
      if (!blob) {
        console.warn("[BusinessCardService] Could not decode dataUrl to Blob for side:", side);
        return null;
      }

      const [primaryToken, ...fallbackApiTokens] = apiTokens;
      const processor = new ImageProcessorService(env, accountId, primaryToken, {
        fallbackApiTokens,
      });

      const customId = `poc-card-${side}-${crypto.randomUUID()}`;
      const filename = `business-card-${side}.jpg`;

      const uploadResponse = await processor.uploadToCloudflareImages(blob, customId, filename);
      return processor.getDeliveryUrl(uploadResponse, customId);
    } catch (err) {
      console.error("[BusinessCardService] uploadCard failed:", err);
      return null;
    }
  }

  /**
   * Extract structured contact information from one or two business card images.
   *
   * Sends the provided image(s) to Workers AI (`@cf/moonshotai/kimi-k2.6`) through
   * the project's AI Gateway with a strict extraction prompt that requests a JSON
   * object with exactly these keys:
   *   `fullName`, `title`, `company`, `phone`, `email`, `website`, `address`
   *
   * When both `front` and `back` images are provided they are included in the same
   * prompt as separate image_url messages so the model sees the full card in one
   * call. Results are merged (front preferred over back for each field).
   *
   * @param env     - The Worker `Env` binding object.
   * @param images  - Object with optional `front` and/or `back` base64 data URLs.
   *                  At least one must be present for extraction to run.
   * @returns       - A flat ExtractedContact object. Missing or unrecognised fields
   *                  are omitted. Returns `{}` on total failure. Never throws.
   */
  async extractFromImages(
    env: Env,
    images: { front?: string; back?: string },
  ): Promise<ExtractedContact> {
    const { front, back } = images;
    if (!front && !back) return {};

    // Build the user-turn content array. We send both sides if available so the
    // VLM can correlate info that spans front-and-back (e.g. address on back).
    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: "Extract all contact information from this business card image (or images if both sides are provided). Return a single JSON object with exactly these keys: fullName, title, company, phone, email, website, address. Use null for any field that is not visible on the card. Return JSON only — no explanation, no markdown fences.",
      },
    ];

    if (front) {
      userContent.push({ type: "image_url", image_url: { url: front } });
    }
    if (back) {
      userContent.push({ type: "image_url", image_url: { url: back } });
    }

    try {
      const vlmResponse = await env.AI.run(
        "@cf/moonshotai/kimi-k2.6" as Parameters<typeof env.AI.run>[0],
        {
          messages: [
            {
              role: "system",
              content:
                "You are a precise data-extraction assistant. You read business cards and return structured JSON. You never hallucinate contact details — if a field is not on the card, set it to null.",
            },
            {
              role: "user",
              content: userContent,
            },
          ],
        } as any,
        { gateway: { id: env.AI_GATEWAY_ID } },
      );

      const rawOutput =
        typeof vlmResponse === "string"
          ? vlmResponse
          : (vlmResponse as any)?.response ?? "";

      const parsed = parseVlmJson(rawOutput);
      if (!parsed) {
        console.warn("[BusinessCardService] VLM returned non-JSON:", rawOutput.slice(0, 200));
        return {};
      }

      // When both sides were sent in a single call the model already merged them.
      // When only one side was sent, coerce that single result.
      return coerceContact(parsed);
    } catch (err) {
      console.error("[BusinessCardService] extractFromImages failed:", err);
      return {};
    }
  }
}

// Export a pre-constructed singleton for convenience in route handlers.
export const businessCardService = new BusinessCardService();
