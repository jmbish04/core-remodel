/**
 * @fileoverview WishlistApp — the wishlist board React island.
 *
 * A user-curated "wants" layer over the products/materials catalog. Two
 * top-level views via shadcn <Tabs>:
 *
 *   • By Room     (default) — a mosaic-card grid: one card per room that has
 *                 items (from GET /api/wishlist/grouped), plus an "All rooms"
 *                 card for cross-room items (paint / drywall / lighting).
 *                 Opening a card shows that bucket's items.
 *
 *   • Collections — the named-collections grid (GET /api/wishlist/collections)
 *                 with a "New Collection" action (POST /collections). Opening a
 *                 card shows that collection's items (GET /collections/:id).
 *
 * Detail views (room bucket OR collection) render a list of <WishlistItemCard>
 * with the four backend-backed per-item actions (promote / change room /
 * add-to-collection / delete).
 *
 * DATA: every number/image is live — nothing is mocked. The header counts are
 * computed from the fetched `/grouped` + `/collections` payloads. Errors are
 * surfaced through `sonner` toasts; loading uses skeletons; empty buckets show
 * an explicit empty state.
 *
 * MONOLITH: dark, no 1px borders (`ring-1 ring-border/40`, `bg-card`),
 * high-contrast text, mobile-responsive grid, AlertDialog (never
 * window.confirm) for destructive confirms.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FolderPlus,
  Heart,
  Loader2,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { MosaicCard } from "./MosaicCard";
import { WishlistItemCard } from "./WishlistItemCard";
import { EmptyState, ItemListSkeleton, MosaicGridSkeleton } from "./shared";
import {
  type GroupedResponse,
  type WishlistCollection,
  type WishlistItem,
  wishlistApi,
} from "./types";

// ---------------------------------------------------------------------------
// Selection model — which detail bucket (if any) is open.
// ---------------------------------------------------------------------------

/** A room bucket (roomId null = the "All rooms" bucket). */
type RoomSelection = { kind: "room"; roomId: number | null; roomName: string };
/** A named collection bucket. */
type CollectionSelection = { kind: "collection"; collectionId: number; name: string };
type Selection = RoomSelection | CollectionSelection | null;

/** Pull up to four thumbnails from a list of items for a mosaic. */
function pickMosaicImages(items: WishlistItem[]): (string | null)[] {
  // Prefer items that actually have an image so mosaics look full when possible.
  const withImages = items.filter((i) => i.imageUrl).map((i) => i.imageUrl);
  const without = items.filter((i) => !i.imageUrl).map(() => null);
  return [...withImages, ...without].slice(0, 4);
}

export function WishlistApp() {
  // ----- board data -----
  const [grouped, setGrouped] = useState<GroupedResponse | null>(null);
  const [collections, setCollections] = useState<WishlistCollection[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(true);

  // ----- detail view -----
  const [selection, setSelection] = useState<Selection>(null);
  const [detailItems, setDetailItems] = useState<WishlistItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ----- new-collection dialog -----
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const [groupedRes, collectionsRes] = await Promise.all([
        wishlistApi.grouped(),
        wishlistApi.collections(),
      ]);
      setGrouped(groupedRes);
      setCollections(collectionsRes.collections);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load wishlist");
    } finally {
      setLoadingBoard(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  /** Load the items for whatever bucket is currently selected. */
  const loadDetail = useCallback(async (sel: Selection) => {
    if (!sel) return;
    setLoadingDetail(true);
    try {
      if (sel.kind === "collection") {
        const res = await wishlistApi.collection(sel.collectionId);
        setDetailItems(res.items);
      } else {
        // Room bucket: reuse the already-fetched /grouped payload where possible,
        // but re-fetch to reflect any mutations that happened in the detail view.
        const res = await wishlistApi.grouped();
        setGrouped(res);
        if (sel.roomId == null) {
          setDetailItems(res.allRooms);
        } else {
          const room = res.rooms.find((r) => r.roomId === sel.roomId);
          setDetailItems(room?.items ?? []);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selection) void loadDetail(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.kind, selection && (selection.kind === "room" ? selection.roomId : selection.collectionId)]);

  // -------------------------------------------------------------------------
  // Derived header counts (from real data, never hardcoded)
  // -------------------------------------------------------------------------

  const totalItems = useMemo(() => {
    if (!grouped) return 0;
    const roomed = grouped.rooms.reduce((sum, r) => sum + r.items.length, 0);
    return roomed + grouped.allRooms.length;
  }, [grouped]);

  const collectionCount = collections.length;

  // -------------------------------------------------------------------------
  // Item mutations — each returns a promise the card awaits, and refreshes
  // both the open detail list and the board counts.
  // -------------------------------------------------------------------------

  const refreshAfterMutation = useCallback(async () => {
    // Refresh board (counts / mosaics) and the open detail list together.
    await loadBoard();
    if (selection) await loadDetail(selection);
  }, [loadBoard, loadDetail, selection]);

  const handlePromote = useCallback(
    async (item: WishlistItem) => {
      try {
        const res = await wishlistApi.promoteToMaterial(item.id);
        toast.success(
          res.material
            ? `“${item.title}” promoted to the material schedule`
            : `“${item.title}” is now chosen`,
        );
        // Optimistically reflect status "chosen" + the material link locally.
        setDetailItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: res.item.status,
                  materialScheduleItemId: res.item.materialScheduleItemId,
                }
              : it,
          ),
        );
        void loadBoard();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to promote item");
      }
    },
    [loadBoard],
  );

  const handleChangeRoom = useCallback(
    async (item: WishlistItem, roomId: number | null) => {
      try {
        await wishlistApi.updateItem(item.id, { roomId });
        toast.success(roomId == null ? "Moved to All rooms" : "Room updated");
        await refreshAfterMutation();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to change room");
        throw e;
      }
    },
    [refreshAfterMutation],
  );

  const handleAddToCollection = useCallback(
    async (item: WishlistItem, collectionId: number) => {
      try {
        const res = await wishlistApi.addToCollection(collectionId, item.id);
        toast.success(
          res.alreadyExists ? "Already in that collection" : "Added to collection",
        );
        // Bump the itemCount badge on the board without a full refetch.
        setCollections((prev) =>
          prev.map((c) =>
            c.id === collectionId && !res.alreadyExists
              ? { ...c, itemCount: (c.itemCount ?? 0) + 1 }
              : c,
          ),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add to collection");
        throw e;
      }
    },
    [],
  );

  const handleDelete = useCallback(
    async (item: WishlistItem) => {
      try {
        await wishlistApi.deleteItem(item.id);
        toast.success("Item deleted");
        setDetailItems((prev) => prev.filter((it) => it.id !== item.id));
        void loadBoard();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to delete item");
        throw e;
      }
    },
    [loadBoard],
  );

  // -------------------------------------------------------------------------
  // New collection
  // -------------------------------------------------------------------------

  async function handleCreateCollection() {
    const name = newName.trim();
    if (!name) {
      toast.error("Give the collection a name");
      return;
    }
    setCreating(true);
    try {
      await wishlistApi.createCollection({
        name,
        description: newDescription.trim() || null,
      });
      toast.success(`Created “${name}”`);
      setNewCollectionOpen(false);
      setNewName("");
      setNewDescription("");
      await loadBoard();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create collection");
    } finally {
      setCreating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render — detail view when a bucket is selected, otherwise the tabbed board.
  // -------------------------------------------------------------------------

  const detailTitle =
    selection?.kind === "collection"
      ? selection.name
      : selection?.kind === "room"
        ? selection.roomName
        : "";

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Heart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything you want for the home, saved by room and curated into
              collections.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-muted-foreground">
                {totalItems} {totalItems === 1 ? "item" : "items"}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {collectionCount}{" "}
                {collectionCount === 1 ? "collection" : "collections"}
              </Badge>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadBoard()}
          disabled={loadingBoard}
          className="shrink-0"
        >
          {loadingBoard ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-1.5 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {selection ? (
        // ---------------------------- Detail view ----------------------------
        <div>
          <div className="mb-4 flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelection(null)}
              className="h-8"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight">
                {detailTitle}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selection.kind === "collection" ? "Collection" : "Room"} ·{" "}
                {detailItems.length}{" "}
                {detailItems.length === 1 ? "item" : "items"}
              </p>
            </div>
          </div>

          {loadingDetail ? (
            <ItemListSkeleton />
          ) : detailItems.length === 0 ? (
            <EmptyState
              title={
                selection.kind === "collection"
                  ? "Nothing in this collection yet"
                  : "Nothing wishlisted for this room yet"
              }
              hint={
                selection.kind === "collection"
                  ? "Open an item and use “Collection” to add it here."
                  : "Add items from the product catalog, or move existing items into this room."
              }
            />
          ) : (
            <div className="space-y-3">
              {detailItems.map((item) => (
                <WishlistItemCard
                  key={item.id}
                  item={item}
                  collections={collections}
                  onPromote={handlePromote}
                  onChangeRoom={handleChangeRoom}
                  onAddToCollection={handleAddToCollection}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // ---------------------------- Tabbed board ---------------------------
        <Tabs defaultValue="rooms">
          <TabsList className="mb-5">
            <TabsTrigger value="rooms">By Room</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
          </TabsList>

          {/* ---- By Room ---- */}
          <TabsContent value="rooms">
            {loadingBoard ? (
              <MosaicGridSkeleton />
            ) : !grouped || (grouped.rooms.length === 0 && grouped.allRooms.length === 0) ? (
              <EmptyState
                title="Your wishlist is empty"
                hint="Browse the product catalog and use “Add to wishlist” to start saving things you love."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href="/admin/shopping/products">Browse products</a>}
                  />
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* All rooms bucket first (cross-room items). */}
                {grouped.allRooms.length > 0 ? (
                  <MosaicCard
                    highlight
                    title="All rooms"
                    subtitle={`${grouped.allRooms.length} ${grouped.allRooms.length === 1 ? "item" : "items"} · paint, lighting, drywall…`}
                    count={grouped.allRooms.length}
                    images={pickMosaicImages(grouped.allRooms)}
                    onOpen={() =>
                      setSelection({ kind: "room", roomId: null, roomName: "All rooms" })
                    }
                  />
                ) : null}

                {grouped.rooms.map((room) => (
                  <MosaicCard
                    key={room.roomId}
                    title={room.roomName ?? `Room ${room.roomId}`}
                    subtitle={`${room.items.length} ${room.items.length === 1 ? "item" : "items"}`}
                    count={room.items.length}
                    images={pickMosaicImages(room.items)}
                    onOpen={() =>
                      setSelection({
                        kind: "room",
                        roomId: room.roomId,
                        roomName: room.roomName ?? `Room ${room.roomId}`,
                      })
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---- Collections ---- */}
          <TabsContent value="collections">
            <div className="mb-4 flex justify-end">
              <Button size="sm" onClick={() => setNewCollectionOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> New Collection
              </Button>
            </div>

            {loadingBoard ? (
              <MosaicGridSkeleton count={3} />
            ) : collections.length === 0 ? (
              <EmptyState
                title="No collections yet"
                hint="Collections are named, cross-room boards — group items by vibe, vendor, or project phase."
                action={
                  <Button size="sm" onClick={() => setNewCollectionOpen(true)}>
                    <FolderPlus className="mr-1 h-4 w-4" /> Create your first collection
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {collections.map((collection) => (
                  <MosaicCard
                    key={collection.id}
                    title={collection.name}
                    subtitle={
                      collection.description?.trim()
                        ? collection.description
                        : `${collection.itemCount ?? 0} ${(collection.itemCount ?? 0) === 1 ? "item" : "items"}`
                    }
                    count={collection.itemCount ?? 0}
                    // Collections don't ship item thumbnails in /collections; the
                    // cover image (if any) leads, otherwise placeholder cells.
                    images={[collection.coverImageUrl ?? null]}
                    onOpen={() =>
                      setSelection({
                        kind: "collection",
                        collectionId: collection.id,
                        name: collection.name,
                      })
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* New collection dialog */}
      <Dialog
        open={newCollectionOpen}
        onOpenChange={(open) => {
          if (creating) return;
          setNewCollectionOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              A named board you can add wishlist items to from any room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wishlist-collection-name">Name</Label>
              <Input
                id="wishlist-collection-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Primary bath — warm minimal"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !creating) {
                    e.preventDefault();
                    void handleCreateCollection();
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wishlist-collection-desc">Description (optional)</Label>
              <Textarea
                id="wishlist-collection-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What's the through-line for this board?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setNewCollectionOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleCreateCollection()} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default WishlistApp;
