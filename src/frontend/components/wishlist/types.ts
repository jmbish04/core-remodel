/**
 * @fileoverview Shared types + a thin fetch client for the wishlist surface.
 *
 * These types mirror the exact `c.json(...)` response shapes emitted by
 * `src/backend/api/routes/wishlist.ts` (mounted at `/api/wishlist`). Keep them
 * in lock-step with that file — every field here corresponds to a real column
 * on `wishlist_items` / `wishlist_collections` or a computed field the route
 * adds (`roomName`, `itemCount`).
 *
 * NOTHING in the wishlist UI uses mock/placeholder data: every value rendered
 * flows from one of the `wishlistApi.*` calls below, which hit the credentialed
 * Hono API with `credentials: "include"`.
 */

/**
 * The lifecycle status of a wishlist item, matching the informal state machine
 * enforced at the app layer (see `wishlist_items.ts`):
 *   "wishlist" → "considering" → "chosen" | "dismissed"
 *
 * Typed as a union of the known values plus `string` so an unexpected
 * server-side status never breaks rendering — the UI degrades to a neutral
 * badge rather than crashing.
 */
export type WishlistStatus =
  | "wishlist"
  | "considering"
  | "chosen"
  | "dismissed"
  | (string & {});

/**
 * A single wishlist item. Mirrors `wishlistItems.$inferSelect` plus the
 * `roomName` annotation the list/grouped endpoints add for roomed items.
 *
 * NOTE: `createdAt` / `updatedAt` arrive as JSON numbers (unix-epoch seconds,
 * since the column is `mode: "timestamp"` serialized over the wire). We keep
 * them as `number` and never rely on them for rendering-critical logic.
 */
export interface WishlistItem {
  id: number;
  roomId: number | null;
  showroomStoreProductId: number | null;
  materialScheduleItemId: number | null;
  title: string;
  imageUrl: string | null;
  price: number | null;
  notes: string | null;
  status: WishlistStatus;
  priority: number | null;
  createdAt: number;
  updatedAt: number;
  /** Present (via join) on `/` and `/grouped`; absent/undefined elsewhere. */
  roomName?: string | null;
}

/** One room bucket from `GET /grouped` (only rooms with ≥1 item appear). */
export interface GroupedRoom {
  roomId: number;
  roomName: string | null;
  items: WishlistItem[];
}

/** Full `GET /grouped` payload. */
export interface GroupedResponse {
  rooms: GroupedRoom[];
  allRooms: WishlistItem[];
}

/** A named, cross-room collection. Mirrors `wishlistCollections.$inferSelect`. */
export interface WishlistCollection {
  id: number;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  isShared?: boolean | null;
  createdAt: number;
  updatedAt: number;
  /** Added by `GET /collections` (count of member items). */
  itemCount?: number;
}

/** `POST /:id/promote-to-material` result. `material` may be null in edge cases. */
export interface PromoteResult {
  material: { id: number; title: string } | null;
  item: WishlistItem;
}

// ---------------------------------------------------------------------------
// Fetch client
// ---------------------------------------------------------------------------

/**
 * Low-level JSON fetch wrapper. Throws an `Error` whose message is the API's
 * `{ error }` string when present, so callers can surface it directly in a
 * toast. Always forwards credentials (the wishlist API is admin-gated).
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * The full wishlist API surface, typed to the real route shapes. Every method
 * maps 1:1 to an endpoint in `wishlist.ts`.
 */
export const wishlistApi = {
  /** `GET /grouped` — room buckets + the cross-room "All rooms" bucket. */
  grouped: () => request<GroupedResponse>("/api/wishlist/grouped"),

  /** `GET /collections` — collections annotated with `itemCount`. */
  collections: () =>
    request<{ collections: WishlistCollection[] }>("/api/wishlist/collections"),

  /** `GET /collections/:id` — a collection plus its member items. */
  collection: (id: number) =>
    request<{ collection: WishlistCollection; items: WishlistItem[] }>(
      `/api/wishlist/collections/${id}`,
    ),

  /** `POST /collections` — create a named collection. */
  createCollection: (body: { name: string; description?: string | null }) =>
    request<{ collection: WishlistCollection }>("/api/wishlist/collections", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** `POST /collections/:id/items` — add an item to a collection (idempotent). */
  addToCollection: (collectionId: number, wishlistItemId: number) =>
    request<{ alreadyExists: boolean }>(
      `/api/wishlist/collections/${collectionId}/items`,
      { method: "POST", body: JSON.stringify({ wishlistItemId }) },
    ),

  /** `PATCH /:id` — partial update (used here for room re-assignment + status). */
  updateItem: (
    id: number,
    body: Partial<Pick<WishlistItem, "roomId" | "status" | "notes" | "title" | "priority">>,
  ) =>
    request<{ item: WishlistItem }>(`/api/wishlist/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** `DELETE /:id` — remove a wishlist item entirely. */
  deleteItem: (id: number) =>
    request<{ success: true }>(`/api/wishlist/${id}`, { method: "DELETE" }),

  /** `POST /:id/promote-to-material` — commit an item into the material schedule. */
  promoteToMaterial: (id: number) =>
    request<PromoteResult>(`/api/wishlist/${id}/promote-to-material`, {
      method: "POST",
    }),
} as const;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human-facing label + badge treatment for each status. */
export const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  wishlist: {
    label: "Wishlist",
    className: "bg-sky-500/10 text-sky-400",
  },
  considering: {
    label: "Considering",
    className: "bg-amber-500/10 text-amber-400",
  },
  chosen: {
    label: "Chosen",
    className: "bg-emerald-500/10 text-emerald-400",
  },
  dismissed: {
    label: "Dismissed",
    className: "bg-muted text-muted-foreground",
  },
};

/** Resolve status metadata with a neutral fallback for unknown values. */
export function statusMeta(status: WishlistStatus) {
  return (
    STATUS_META[status] ?? {
      label: status ? status.charAt(0).toUpperCase() + status.slice(1) : "—",
      className: "bg-muted text-muted-foreground",
    }
  );
}

/** Format a numeric price snapshot as USD, or return null when absent. */
export function formatPrice(price: number | null): string | null {
  if (price == null || Number.isNaN(price)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
}
