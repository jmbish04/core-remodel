/**
 * @fileoverview WishlistItemCard — a single wishlist item row in a detail view.
 *
 * Renders the denormalized snapshot of an item (thumbnail, title, price, room
 * label, status badge) and exposes the four per-item actions the backend
 * supports:
 *
 *   - Promote to material  → POST /api/wishlist/:id/promote-to-material
 *                            (reflects status "chosen" + a "Planned material" badge)
 *   - Change room          → PATCH /api/wishlist/:id { roomId }  (via <RoomSelect/>)
 *   - Add to a collection  → POST /api/wishlist/collections/:id/items
 *   - Delete               → DELETE /api/wishlist/:id  (shadcn AlertDialog confirm)
 *
 * All mutations are delegated to the parent through callback props so the
 * parent owns the single source of truth (optimistic list state) and the toast
 * lifecycle. This card never fetches on its own except for the collection list
 * needed to populate the "add to collection" picker, which is passed in.
 *
 * MONOLITH: no 1px borders — separation via `ring-1 ring-border/40` and
 * `bg-card`. Null images degrade to a graceful neutral tile, never a broken
 * `<img>`. Confirmation uses AlertDialog, never window.confirm.
 */

import { useState } from "react";
import {
  ImageOff,
  Loader2,
  MoreHorizontal,
  FolderPlus,
  ArrowRightLeft,
  Hammer,
  Trash2,
  Check,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoomSelect } from "@/components/ui/room-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { cn } from "@/lib/utils";

import {
  type WishlistCollection,
  type WishlistItem,
  formatPrice,
  statusMeta,
} from "./types";

export interface WishlistItemCardProps {
  item: WishlistItem;
  /** Collections available for the "add to collection" picker (from /collections). */
  collections: WishlistCollection[];
  /** PATCH the item's roomId. Resolves once the server confirms. */
  onChangeRoom: (item: WishlistItem, roomId: number | null) => Promise<void>;
  /** POST the item into a collection. */
  onAddToCollection: (item: WishlistItem, collectionId: number) => Promise<void>;
  /** POST promote-to-material; parent reflects status "chosen". */
  onPromote: (item: WishlistItem) => Promise<void>;
  /** DELETE the item. */
  onDelete: (item: WishlistItem) => Promise<void>;
}

export function WishlistItemCard({
  item,
  collections,
  onChangeRoom,
  onAddToCollection,
  onPromote,
  onDelete,
}: WishlistItemCardProps) {
  // Per-action pending flags keep the row responsive without a global spinner.
  const [promoting, setPromoting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingRoom, setChangingRoom] = useState(false);
  const [addingCollectionId, setAddingCollectionId] = useState<number | null>(null);

  const [roomPopoverOpen, setRoomPopoverOpen] = useState(false);
  const [collectionPopoverOpen, setCollectionPopoverOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = statusMeta(item.status);
  const priceLabel = formatPrice(item.price);
  const isPlannedMaterial = item.materialScheduleItemId != null;

  async function handlePromote() {
    setPromoting(true);
    try {
      await onPromote(item);
    } finally {
      setPromoting(false);
      setActionsOpen(false);
    }
  }

  async function handleChangeRoom(roomId: number | null) {
    setChangingRoom(true);
    try {
      await onChangeRoom(item, roomId);
      setRoomPopoverOpen(false);
    } finally {
      setChangingRoom(false);
    }
  }

  async function handleAddToCollection(collectionId: number) {
    setAddingCollectionId(collectionId);
    try {
      await onAddToCollection(item, collectionId);
      setCollectionPopoverOpen(false);
    } finally {
      setAddingCollectionId(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(item);
      // On success the parent unmounts this card; no need to reset state.
    } catch {
      // Parent toasts the error; reopen state so the user can retry.
      setDeleting(false);
    }
  }

  return (
    <div className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-border/40 transition-colors hover:ring-border/70">
      {/* Thumbnail — graceful fallback tile when imageUrl is null. */}
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted/50">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate font-medium leading-snug">
            {item.title}
          </p>
          {priceLabel ? (
            <span className="shrink-0 font-mono text-sm tabular-nums text-emerald-400">
              {priceLabel}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={cn("border-0", meta.className)}>{meta.label}</Badge>
          {item.roomName ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {item.roomName}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest text-muted-foreground">
              All rooms
            </Badge>
          )}
          {isPlannedMaterial ? (
            <Badge className="border-0 bg-violet-500/10 text-violet-400">
              <Hammer className="mr-1 h-3 w-3" /> Planned material
            </Badge>
          ) : null}
        </div>

        {item.notes ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.notes}</p>
        ) : null}

        {/* Action bar */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* Promote to material */}
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={promoting || isPlannedMaterial}
            onClick={handlePromote}
            title={isPlannedMaterial ? "Already promoted to the material schedule" : "Promote to material schedule"}
          >
            {promoting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : isPlannedMaterial ? (
              <Check className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Hammer className="mr-1 h-3.5 w-3.5" />
            )}
            {isPlannedMaterial ? "Planned" : "Promote"}
          </Button>

          {/* Change room */}
          <Popover open={roomPopoverOpen} onOpenChange={setRoomPopoverOpen}>
            <PopoverTrigger
              render={
                <Button size="sm" variant="ghost" className="h-7" disabled={changingRoom}>
                  {changingRoom ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                  )}
                  Room
                </Button>
              }
            />
            <PopoverContent className="w-64 p-3" side="bottom" align="start">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Move to a room (clear for “All rooms”)
              </p>
              <RoomSelect
                value={item.roomId}
                onChange={(roomId) => void handleChangeRoom(roomId)}
                includeAllOption
                allOptionLabel="All rooms"
                aria-label="Move item to room"
              />
            </PopoverContent>
          </Popover>

          {/* Add to collection */}
          <Popover open={collectionPopoverOpen} onOpenChange={setCollectionPopoverOpen}>
            <PopoverTrigger
              render={
                <Button size="sm" variant="ghost" className="h-7">
                  <FolderPlus className="mr-1 h-3.5 w-3.5" />
                  Collection
                </Button>
              }
            />
            <PopoverContent className="w-64 p-2" side="bottom" align="start">
              {collections.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  No collections yet. Create one on the Collections tab.
                </p>
              ) : (
                <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                  {collections.map((collection) => (
                    <button
                      key={collection.id}
                      type="button"
                      disabled={addingCollectionId != null}
                      onClick={() => void handleAddToCollection(collection.id)}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="truncate">{collection.name}</span>
                      {addingCollectionId === collection.id ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Overflow: delete lives here to keep the primary bar clean. */}
          <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
            <PopoverTrigger
              render={
                <Button size="sm" variant="ghost" className="h-7 w-7 px-0" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
            />
            <PopoverContent className="w-44 p-1" side="bottom" align="end">
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  setConfirmDelete(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-400 transition-colors hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete item
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Delete confirmation — AlertDialog, never window.confirm. */}
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (deleting) return;
          setConfirmDelete(next);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              “{item.title}” will be removed from your wishlist. This can’t be
              undone, and it also removes it from any collections it’s in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
