import { Loader2, MoreVertical, Trash2, Unlink } from "lucide-react";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteImage,
  fetchImageRoomIds,
  removeInspirationRoom,
} from "./media-image-api";
import type { MediaKind, RoomImage } from "./types";

/**
 * ImageActions — the per-image action menu rendered inside the Room Media modal
 * (Round 3b — T3.8 / IMPLEMENTATION_PLAN §7.9).
 *
 * Behavior by media kind:
 *   - LISTING photo → a single destructive action, "Delete photo", confirmed in
 *     a shadcn `AlertDialog`, calling `DELETE /api/images/:id` (which removes the
 *     D1 row AND the Cloudflare Images asset).
 *   - INSPIRATION photo (multi-room via `inspirational_image_rooms`) → two
 *     distinct actions:
 *       • "Remove from this room" — unmaps only, by PUT-ing the image's CURRENT
 *         room set MINUS the current room. The Images API REJECTS an empty
 *         inspiration `roomIds` set (400), so when this is the photo's only room
 *         the action is disabled and the copy tells the user to delete instead.
 *       • "Delete permanently everywhere" — `DELETE /api/images/:id`.
 *
 * Because the room-detail payload's `RoomImage` does not carry the image's full
 * `roomIds`, this component reads the live set from `GET /api/images/:id` the
 * moment its menu opens, so "Remove from this room" can be enabled/disabled
 * accurately and the unmap math is computed against the authoritative mapping.
 *
 * All confirms are shadcn `AlertDialog`s (never `window.confirm`); every error
 * surfaces through a `sonner` toast; on any success we call `onChanged()` so the
 * orchestrator reloads counts + lists.
 *
 * Prop contract (FIXED by Round 3a — never changed here):
 *   image, kind, roomId, accessAuthenticated, onChanged
 */
export interface ImageActionsProps {
  /** The image being acted on. */
  image: RoomImage;
  /** Drives which actions show: "listing" → delete only; "inspiration" → unmap + delete. */
  kind: MediaKind;
  /** Current room id — the room the user is unmapping the inspiration photo FROM. */
  roomId: number;
  /** When false the menu is hidden entirely (destructive actions are gated). */
  accessAuthenticated: boolean;
  /** Called after any successful mutation so the parent reloads lists + counts. */
  onChanged: () => void;
}

/** Which confirmation dialog (if any) is currently open. */
type ActiveDialog = "delete" | "unmap" | null;

export function ImageActions({ image, kind, roomId, accessAuthenticated, onChanged }: ImageActionsProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [busy, setBusy] = useState(false);

  // Live inspiration mapping state, loaded lazily when the menu opens. `null`
  // means "not yet loaded"; an empty array is a legitimate loaded value.
  const [roomIds, setRoomIds] = useState<number[] | null>(null);
  const [loadingRoomIds, setLoadingRoomIds] = useState(false);

  const photoLabel = image.displayName?.trim() || "this photo";

  // For inspiration photos we need the current mapping set to know whether the
  // unmap action is even legal. Fetch it once per menu-open.
  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open || kind !== "inspiration" || roomIds !== null || loadingRoomIds) {
        return;
      }
      setLoadingRoomIds(true);
      void (async () => {
        const result = await fetchImageRoomIds(image.id);
        if (result.ok) {
          setRoomIds(result.data);
        } else {
          // Non-fatal: leave roomIds null so the menu still offers actions; the
          // unmap handler re-checks live before mutating.
          setRoomIds([]);
          toast.error(result.error);
        }
        setLoadingRoomIds(false);
      })();
    },
    [image.id, kind, loadingRoomIds, roomIds],
  );

  // Whether "Remove from this room" is allowed: only when the photo is mapped to
  // more than one room. While the live set is still loading we keep it enabled
  // and let the handler enforce the rule (it reads live before mutating).
  const unmapDisabled = roomIds !== null && roomIds.length <= 1;

  const handleDelete = useCallback(async () => {
    setBusy(true);
    const result = await deleteImage(image.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Deleted ${photoLabel} everywhere.`);
    setActiveDialog(null);
    onChanged();
  }, [image.id, onChanged, photoLabel]);

  const handleUnmap = useCallback(async () => {
    setBusy(true);
    const result = await removeInspirationRoom(image.id, roomId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Removed ${photoLabel} from this room.`);
    setActiveDialog(null);
    onChanged();
  }, [image.id, onChanged, photoLabel, roomId]);

  // Destructive actions are homeowner-gated; without access show nothing so the
  // viewer surface stays read-only for the public.
  if (!accessAuthenticated) return null;

  return (
    <>
      <DropdownMenu onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${photoLabel}`}
            />
          }
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {kind === "inspiration" ? (
            <>
              <DropdownMenuItem
                disabled={unmapDisabled || loadingRoomIds}
                onClick={() => setActiveDialog("unmap")}
              >
                {loadingRoomIds ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unlink className="size-4" />
                )}
                Remove from this room
              </DropdownMenuItem>
              {unmapDisabled ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                  This is the photo&apos;s only room — delete it permanently instead.
                </p>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}

          <DropdownMenuItem variant="destructive" onClick={() => setActiveDialog("delete")}>
            <Trash2 className="size-4" />
            {kind === "inspiration" ? "Delete permanently everywhere" : "Delete photo"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Permanent-delete confirmation (listing + inspiration). */}
      <AlertDialog
        open={activeDialog === "delete"}
        onOpenChange={(open) => {
          if (!busy) setActiveDialog(open ? "delete" : null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === "inspiration"
                ? `"${photoLabel}" will be removed from every room it is linked to, deleted from the database, and erased from Cloudflare Images. This cannot be undone.`
                : `"${photoLabel}" will be deleted from the database and erased from Cloudflare Images. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                // Keep the dialog open until the request settles.
                event.preventDefault();
                void handleDelete();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inspiration-only unmap confirmation. */}
      <AlertDialog
        open={activeDialog === "unmap"}
        onOpenChange={(open) => {
          if (!busy) setActiveDialog(open ? "unmap" : null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from this room?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${photoLabel}" will be unlinked from this room but kept everywhere else it appears. The photo and its Cloudflare Images asset are not deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void handleUnmap();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
              Remove from room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ImageActions;
