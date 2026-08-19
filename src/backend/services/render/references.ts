/**
 * @fileoverview Resolve a bag of image inputs into render inspiration references
 * ([{url,label}]) — the 0041 bridge from showroom photos into the render pipeline.
 *
 * Accepts any mix of: showroom image ids (→ their CF deliveryUrl), a showroom
 * image-group id (→ every photo in that folder), and explicit {url,label} refs.
 * Deduped by url. Chunked at 20 for D1's 100-bound-param cap.
 */
import { showroomImages } from "@backend/db";
import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";

/**
 * A reference image URL restricted to http(s) — blocks `javascript:`/`data:`/
 * `file:` schemes that could become a stored-XSS or SSRF vector when the studio
 * renders the ref in an <img src> / <a href>.
 */
export const httpUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: "must be an http(s) URL" });

/** A single {url,label} reference, url restricted to http(s). */
export const referenceSchema = z.object({ url: httpUrlSchema, label: z.string().optional() });

export interface ImageRefInput {
  showroomImageIds?: number[];
  imageGroupId?: number | null;
  references?: { url: string; label?: string }[];
}

export type ImageRef = { url: string; label?: string };

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export async function resolveShowroomImageRefs<TSchema extends Record<string, unknown>>(
  db: DrizzleD1Database<TSchema>,
  input: ImageRefInput,
): Promise<ImageRef[]> {
  const byUrl = new Map<string, ImageRef>();
  const push = (url: string | null | undefined, label?: string) => {
    if (url && !byUrl.has(url)) byUrl.set(url, { url, label });
  };

  for (const r of input.references ?? []) push(r.url, r.label);

  // Every photo in a folder.
  if (input.imageGroupId != null) {
    const members = await db
      .select({ id: showroomImages.id, url: showroomImages.deliveryUrl, alt: showroomImages.altText })
      .from(showroomImages)
      .where(eq(showroomImages.groupId, input.imageGroupId));
    for (const m of members) push(m.url, m.alt ?? `#${m.id}`);
  }

  // Explicit showroom image ids.
  const ids = [...new Set(input.showroomImageIds ?? [])];
  for (const part of chunk(ids, 20)) {
    const rows = await db
      .select({ id: showroomImages.id, url: showroomImages.deliveryUrl, alt: showroomImages.altText })
      .from(showroomImages)
      .where(inArray(showroomImages.id, part));
    for (const r of rows) push(r.url, r.alt ?? `#${r.id}`);
  }

  return [...byUrl.values()];
}

/** Parse a session's seed-reference JSON into [{url,label}] (never throws). */
export function parseSeedRefs(json: string | null | undefined): ImageRef[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is ImageRef =>
            Boolean(r && typeof r.url === "string") &&
            (r.label === undefined || typeof r.label === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

/** Merge new refs into an existing seed list, deduped by url. */
export function mergeRefs(existing: ImageRef[], added: ImageRef[]): ImageRef[] {
  const byUrl = new Map<string, ImageRef>();
  for (const r of existing) if (r?.url) byUrl.set(r.url, r);
  for (const r of added) if (r?.url && !byUrl.has(r.url)) byUrl.set(r.url, r);
  return [...byUrl.values()];
}
