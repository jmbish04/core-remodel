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
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
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

/**
 * Backfill missing stop coordinates from each stop's linked showroom, in place.
 *
 * A stop can be created without lat/lng yet still link a geocoded showroom; the
 * drive map and per-stop navigation both key off the stop's OWN coords, so
 * without this the whole map falls back to an empty pin even though the
 * coordinates exist on the linked showroom. Mutates and returns the same array.
 * Stop counts are bounded (the planner caps a drive at 24 stops), so the id
 * list needs no chunking.
 */
export async function fillMissingStopCoords<
  T extends { showroomStoreId: number | null; latitude: number | null; longitude: number | null },
>(db: RemodelDb, stops: T[]): Promise<T[]> {
  const need = stops.filter(
    (s) => (s.latitude == null || s.longitude == null) && s.showroomStoreId != null,
  );
  if (need.length === 0) return stops;
  const ids = Array.from(new Set(need.map((s) => s.showroomStoreId as number)));
  const coords = await db
    .select({
      id: showroomStores.id,
      latitude: showroomStores.latitude,
      longitude: showroomStores.longitude,
    })
    .from(showroomStores)
    .where(inArray(showroomStores.id, ids));
  const byId = new Map(coords.map((r) => [r.id, r]));
  for (const s of stops) {
    if (s.showroomStoreId == null) continue;
    const sr = byId.get(s.showroomStoreId);
    if (!sr) continue;
    if (s.latitude == null) s.latitude = sr.latitude;
    if (s.longitude == null) s.longitude = sr.longitude;
  }
  return stops;
}

/**
 * Decode the handful of HTML entities that leak into drive-list display text
 * when a drive is created from the MCP tools (e.g. "Wall &amp; Floor" stored for
 * "Wall & Floor"). Drive titles/notes/stop fields are plain text, never HTML, so
 * an entity here is always wrong. `&amp;` is decoded LAST so a double-encoded
 * "&amp;lt;" resolves to "<". null/undefined pass through unchanged.
 */
export function decodeHtmlEntities<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return (s as string)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") as T;
}

/** Insert a drive list + its ordered stops. Returns the new id/slug/stopCount. */
export async function createDriveList(
  db: RemodelDb,
  input: DriveListCreateInput,
): Promise<{ id: number; slug: string; stopCount: number }> {
  // Decode HTML entities up front so neither the stored title nor the derived
  // slug carries "&amp;"/"amp" — MCP-created drives were storing raw entities.
  const title = decodeHtmlEntities(input.title);
  const description = decodeHtmlEntities(input.description);
  const notes = input.notes?.map((n) => decodeHtmlEntities(n));
  const slug = await uniqueSlug(db, slugify(title));
  const status = input.status ?? "active";
  const [drive] = await db
    .insert(driveLists)
    .values({
      slug,
      title,
      description,
      notes: serializeDriveNotes(notes),
      status,
      sourceConversation: input.sourceConversation,
    })
    .returning({ id: driveLists.id });

  // Single-active invariant: a newly-active drive supersedes any other active
  // one (only one drive is "the active drive" at a time — it's what admin
  // devices auto-land on).
  if (status === "active") await setActiveDrive(db, drive.id);

  const stopValues = input.stops.map((s, i) => ({
    driveListId: drive.id,
    showroomStoreId: s.showroomStoreId,
    sortOrder: i,
    leg: decodeHtmlEntities(s.leg),
    legWindow: decodeHtmlEntities(s.legWindow),
    name: decodeHtmlEntities(s.name),
    city: decodeHtmlEntities(s.city),
    address: decodeHtmlEntities(s.address),
    phone: s.phone,
    hours: decodeHtmlEntities(s.hours),
    note: decodeHtmlEntities(s.note),
    pick: decodeHtmlEntities(s.pick),
    websiteUrl: s.websiteUrl,
    latitude: s.latitude,
    longitude: s.longitude,
    isOptional: s.isOptional ?? false,
    kind: (s.isOptional ?? false) ? ("optional" as const) : ("core" as const),
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

/**
 * Make `id` THE active drive, or (with `null`) clear the active slot entirely.
 *
 * The clear and the set go out as one `db.batch()` so D1 never observes two
 * active rows — which its partial unique index (`drive_lists_single_active_uniq`)
 * would reject anyway. This is the ONLY sanctioned way to write `is_active`.
 */
export async function setActiveDrive(db: RemodelDb, id: number | null): Promise<void> {
  const clear = db
    .update(driveLists)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      id == null
        ? eq(driveLists.isActive, true)
        : and(eq(driveLists.isActive, true), ne(driveLists.id, id)),
    );
  if (id == null) {
    await db.batch([clear]);
    return;
  }
  const set = db
    .update(driveLists)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(driveLists.id, id));
  await db.batch([clear, set]);
}

/**
 * The slug of THE active drive (`is_active = 1`, at most one by index). `null`
 * when nothing is active. Backs the admin-device auto-landing in `src/_worker.ts`.
 */
export async function getActiveDriveSlug(db: RemodelDb): Promise<string | null> {
  const [row] = await db
    .select({ slug: driveLists.slug })
    .from(driveLists)
    .where(eq(driveLists.isActive, true))
    .orderBy(desc(driveLists.updatedAt))
    .limit(1);
  return row?.slug ?? null;
}

/**
 * Convenience for the Worker fetch handler: the internal landing PATH of the
 * active drive (`/admin/shopping/drives/<slug>`), or `null` when none is active.
 * Constructs its own Drizzle client from `env.DB`.
 */
export async function getActiveDriveLandingPath(env: Env): Promise<string | null> {
  const slug = await getActiveDriveSlug(drizzle(env.DB));
  return slug ? `/admin/shopping/drives/${slug}` : null;
}
