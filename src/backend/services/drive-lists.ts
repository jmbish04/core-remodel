/**
 * @fileoverview Shared Showroom Drive List logic — used by both the MCP tools
 * (`create_drive_list`) and the admin API (`POST /api/drive-lists`) so the two
 * write paths can never drift.
 *
 * Notes are a LIST of short note strings (each renders as its own full-width
 * card in the drive viewport). They are persisted as a JSON-encoded array in the
 * `drive_lists.notes` TEXT column; `parseDriveNotes` reads that back and, for
 * legacy rows that still hold one freeform chunk, splits on blank lines so old
 * drives also render as a stack of cards.
 */
import { driveListStops, driveLists } from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Drizzle D1 client (matches the MCP registry's `RemodelDb`). */
type RemodelDb = ReturnType<typeof drizzle>;

/** Kebab-case a title into a URL slug base (letters/digits/hyphens only). */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "drive-list";
}

/** Find a drive-list slug not already taken (appends -2, -3, … on collision). */
export async function uniqueSlug(db: RemodelDb, base: string): Promise<string> {
  const [exact] = await db
    .select({ slug: driveLists.slug })
    .from(driveLists)
    .where(eq(driveLists.slug, base))
    .limit(1);
  if (!exact) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const [hit] = await db
      .select({ slug: driveLists.slug })
      .from(driveLists)
      .where(eq(driveLists.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Read the stored `notes` column into an array of note strings.
 *
 * - JSON array (the new format) → its trimmed, non-empty entries.
 * - Legacy single chunk of text → split on blank lines into paragraph cards.
 * - null / empty → [].
 */
export function parseDriveNotes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        return arr.map((n) => String(n).trim()).filter(Boolean);
      }
    } catch {
      // Not valid JSON after all — fall through to the legacy split.
    }
  }
  return trimmed
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize a notes array for storage, or `null` when there are no notes. */
export function serializeDriveNotes(notes: string[] | null | undefined): string | null {
  if (!notes) return null;
  const clean = notes.map((n) => n.trim()).filter(Boolean);
  return clean.length ? JSON.stringify(clean) : null;
}

/** One stop as accepted by the create surfaces. */
export interface DriveStopInput {
  name: string;
  showroomStoreId?: number;
  city?: string;
  address?: string;
  phone?: string;
  hours?: string;
  note?: string;
  pick?: string;
  websiteUrl?: string;
  latitude?: number;
  longitude?: number;
  leg?: string;
  legWindow?: string;
  isOptional?: boolean;
}

export interface DriveListCreateInput {
  title: string;
  description?: string;
  notes?: string[];
  status?: "draft" | "active" | "completed" | "archived";
  sourceConversation?: string;
  stops: DriveStopInput[];
}

/** Insert a drive list + its ordered stops. Returns the new id/slug/stopCount. */
export async function createDriveList(
  db: RemodelDb,
  input: DriveListCreateInput,
): Promise<{ id: number; slug: string; stopCount: number }> {
  const slug = await uniqueSlug(db, slugify(input.title));
  const [drive] = await db
    .insert(driveLists)
    .values({
      slug,
      title: input.title,
      description: input.description,
      notes: serializeDriveNotes(input.notes),
      status: input.status ?? "active",
      sourceConversation: input.sourceConversation,
    })
    .returning({ id: driveLists.id });

  const stopValues = input.stops.map((s, i) => ({
    driveListId: drive.id,
    showroomStoreId: s.showroomStoreId,
    sortOrder: i,
    leg: s.leg,
    legWindow: s.legWindow,
    name: s.name,
    city: s.city,
    address: s.address,
    phone: s.phone,
    hours: s.hours,
    note: s.note,
    pick: s.pick,
    websiteUrl: s.websiteUrl,
    latitude: s.latitude,
    longitude: s.longitude,
    isOptional: s.isOptional ?? false,
  }));
  // Write via db.batch() of single-row inserts, chunked, so we never approach
  // Cloudflare D1's 100-bound-parameter-per-query limit on large drives.
  const STOP_BATCH_SIZE = 50;
  for (let i = 0; i < stopValues.length; i += STOP_BATCH_SIZE) {
    const chunk = stopValues.slice(i, i + STOP_BATCH_SIZE);
    const stmts = chunk.map((val) => db.insert(driveListStops).values(val));
    // chunk is always non-empty here; cast to the non-empty tuple db.batch expects.
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  return { id: drive.id, slug, stopCount: input.stops.length };
}
