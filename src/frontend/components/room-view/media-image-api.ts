/**
 * media-image-api.ts — the thin client wrapper around the Images API that the
 * Room Media management surface (Round 3b — T3.8 delete, T3.9 move/reassign)
 * shares between `ImageActions` and `MovePhotosModal`.
 *
 * Why a dedicated module: both the delete flow and the move flow need to know an
 * inspiration image's CURRENT room mappings, and the room-detail payload's
 * `RoomImage` rows deliberately omit `roomIds` (the detail endpoint returns raw
 * `images` rows, see `loadRoomDetail` in `src/backend/api/routes/rooms.ts`). So
 * for any inspiration mutation we must read the live mapping set from
 * `GET /api/images/:id` and recompute. Centralizing that here keeps each UI file
 * small (the swarm rule caps components at < 400 lines) and guarantees the two
 * surfaces speak the identical wire contract to the backend.
 *
 * Backend handlers consumed (all under `src/backend/api/routes/images.ts`):
 *   - GET    /api/images/:id   → `{ success, image: { ...row, roomIds, roomLabels } }`
 *   - PUT    /api/images/:id   → partial update; for LISTING requires a non-null
 *                                `roomId`, for INSPIRATION requires a NON-EMPTY
 *                                `roomIds` array (it 400s on an empty set), and it
 *                                REPLACES the full `inspirational_image_rooms`
 *                                set whenever `roomIds` is present.
 *   - DELETE /api/images/:id   → removes the D1 row AND the Cloudflare Images
 *                                asset (best-effort across configured tokens).
 *
 * Every helper returns a discriminated `ApiResult` so callers render a real
 * error toast (never swallow) and never need a try/catch of their own.
 */

/** A uniform success/failure envelope so callers can branch without try/catch. */
export type ApiResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Shape of the slice of `GET /api/images/:id` we rely on. */
interface ImageDetailResponse {
  success?: boolean;
  error?: string;
  image?: {
    id: string;
    roomIds?: number[];
    roomLabels?: string[];
  };
}

/** Generic `{ success?, error? }` mutation envelope returned by PUT/DELETE. */
interface MutationResponse {
  success?: boolean;
  error?: string;
  details?: string;
}

/**
 * Pulls a human-readable message out of a failed JSON body, falling back to a
 * supplied default. Surfaces the backend's `error` (and `details` when present)
 * so the toast the user sees matches what the API actually rejected.
 */
function messageFromBody(body: MutationResponse | undefined, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === "string" && body.error.trim().length > 0) {
    return body.details ? `${body.error}: ${body.details}` : body.error;
  }
  return fallback;
}

/**
 * Reads an image's CURRENT inspiration room-id set from the server. Used by both
 * the inspiration unmap action and the inspiration move action, which must add
 * to / subtract from the authoritative live mapping (not the stale detail view).
 */
export async function fetchImageRoomIds(imageId: string): Promise<ApiResult<number[]>> {
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
      credentials: "include",
    });
    const body = (await res.json().catch(() => undefined)) as ImageDetailResponse | undefined;
    if (!res.ok || !body?.success || !body.image) {
      return { ok: false, error: messageFromBody(body, "Failed to load image mappings") };
    }
    const roomIds = Array.isArray(body.image.roomIds)
      ? Array.from(
          new Set(
            body.image.roomIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.trunc(value)),
          ),
        )
      : [];
    return { ok: true, data: roomIds };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load image mappings",
    };
  }
}

/**
 * Hard-deletes an image everywhere: the D1 row plus the Cloudflare Images asset.
 * Used for BOTH "Delete photo" (listing) and "Delete permanently everywhere"
 * (inspiration).
 */
export async function deleteImage(imageId: string): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    const body = (await res.json().catch(() => undefined)) as MutationResponse | undefined;
    if (!res.ok || !body?.success) {
      return { ok: false, error: messageFromBody(body, "Failed to delete photo") };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete photo",
    };
  }
}

/**
 * Reassigns a LISTING photo to a single target room via `PUT /api/images/:id`
 * `{ roomId }`. The backend rejects a listing photo left without a room, so the
 * caller must always pass a valid target id.
 */
export async function reassignListingImage(
  imageId: string,
  targetRoomId: number,
): Promise<ApiResult> {
  return putImage(imageId, { roomId: targetRoomId }, "Failed to move photo");
}

/**
 * Replaces an INSPIRATION photo's full room-mapping set via
 * `PUT /api/images/:id` `{ roomIds }`. The backend REPLACES the entire
 * `inspirational_image_rooms` set with the provided list and 400s on an empty
 * list, so callers build the exact desired set before calling.
 */
export async function setInspirationRoomIds(
  imageId: string,
  roomIds: number[],
): Promise<ApiResult> {
  const unique = Array.from(
    new Set(roomIds.filter((value) => Number.isFinite(value) && value > 0).map((v) => Math.trunc(v))),
  );
  if (unique.length === 0) {
    // Guard locally so we never send a request the API is guaranteed to reject;
    // callers should disable the relevant control before reaching this point.
    return {
      ok: false,
      error: "An inspiration photo must stay linked to at least one room — delete it instead.",
    };
  }
  return putImage(imageId, { roomIds: unique }, "Failed to update photo rooms");
}

/**
 * Adds a target room to an inspiration photo's CURRENT mapping set (read live
 * first, then union with the target). No-ops gracefully if it is already mapped
 * there. This is the inspiration half of the move/reassign flow.
 */
export async function addInspirationRoom(
  imageId: string,
  targetRoomId: number,
): Promise<ApiResult> {
  const current = await fetchImageRoomIds(imageId);
  if (!current.ok) return current;
  if (current.data.includes(targetRoomId)) {
    // Already linked — treat as success so a batch move does not report a
    // spurious failure when some photos were already in the target room.
    return { ok: true, data: undefined };
  }
  return setInspirationRoomIds(imageId, [...current.data, targetRoomId]);
}

/**
 * Removes the CURRENT room from an inspiration photo's mapping set (read live
 * first, then subtract). Returns a typed `remaining` count so the caller can
 * decide whether the unmap was even allowed (the API forbids the last room).
 */
export async function removeInspirationRoom(
  imageId: string,
  roomId: number,
): Promise<ApiResult<{ remaining: number }>> {
  const current = await fetchImageRoomIds(imageId);
  if (!current.ok) return current;
  const remaining = current.data.filter((value) => value !== roomId);
  if (remaining.length === 0) {
    return {
      ok: false,
      error: "This is the photo's only room. Delete it permanently instead of unmapping.",
    };
  }
  const result = await setInspirationRoomIds(imageId, remaining);
  if (!result.ok) return result;
  return { ok: true, data: { remaining: remaining.length } };
}

/**
 * Low-level `PUT /api/images/:id` helper shared by the listing/inspiration
 * mutators above. Keeps the fetch + envelope-parsing logic in exactly one place.
 */
async function putImage(
  imageId: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => undefined)) as MutationResponse | undefined;
    if (!res.ok || !parsed?.success) {
      return { ok: false, error: messageFromBody(parsed, fallback) };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : fallback };
  }
}
