// ---------------------------------------------------------------------------
// WorkshopApp — the Slice-1 orchestrator.
//
// Reads ?roomId= from the URL. Without a roomId it shows a room-pick screen
// (rooms from /api/rooms/catalog). With a roomId it loads the board and renders
// the full table: the Konva canvas + chrome, the piles rail, the sample drawer,
// and the node recipe dialogs.
//
// Recipes are SYNC-201: the POST /nodes/:id/recipe response body IS the
// finished child node. While the request is in flight the SOURCE node shows the
// calm ambient + a generic narration line; on the 201 the child drops in with a
// staggered reveal. There is no always-open socket — the session-keyed realtime
// hook stays available (see useRenderRealtime) but is only connected when a
// sessionId is known (kept for retries; not needed for the happy path).
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { WorkshopCanvas } from "./canvas/WorkshopCanvas";
import { PilesRail, DRAG_MIME } from "./piles/PilesRail";
import { SampleDrawer } from "./drawer/SampleDrawer";
import { ExtractClippingDialog } from "./drawer/ExtractClippingDialog";
import {
  RecipeDialog,
  type RecipeReference,
  type RecipeRunParams,
} from "./recipes/RecipeDialog";
import { RoomPicker } from "./RoomPicker";
import { runRecipe } from "./api";
import { isAsyncRecipeResult, RECIPE_NARRATION } from "./types";
import { useBoard } from "./hooks/useBoard";
import type {
  BoardNode,
  BoardPhoto,
  Clipping,
  CollectionItem,
  RecipeKind,
} from "./types";

function useRoomId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");
  return roomId && roomId.trim() ? roomId.trim() : null;
}

export function WorkshopApp() {
  const roomId = useRoomId();
  if (!roomId) {
    return <RoomPicker />;
  }
  return <WorkshopBoard roomId={roomId} />;
}

function WorkshopBoard({ roomId }: { roomId: string }) {
  const board = useBoard(roomId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Drawer open state is lifted so the canvas "Place image (I)" tool can open it.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Dialog targets.
  const [extractNode, setExtractNode] = useState<BoardNode | null>(null);
  const [recipeState, setRecipeState] = useState<{
    recipe: "material-swap" | "mix";
    node: BoardNode;
  } | null>(null);

  // References for the recipe dialogs. Inspiration is now sourced from the
  // drawer's inspirationPhotos (whole photos no longer arrive as nodes) PLUS any
  // inspiration node the user has explicitly placed on the canvas.
  const materialSwapRefs = useMemo<RecipeReference[]>(() => {
    const fromInspirationPhotos = board.inspirationPhotos.map((photo) => ({
      id: `photo:${photo.sourceId}`,
      cfImageUrl: photo.cfImageUrl,
      label: photo.label,
    }));
    const fromInspirationNodes = board.nodes
      .filter((node) => node.sourceType === "inspiration")
      .map((node) => ({
        id: `node:${node.id}`,
        cfImageUrl: node.cfImageUrl,
        label: null,
      }));
    const fromClippings = board.clippings.map((clip) => ({
      id: `clip:${clip.id}`,
      cfImageUrl: clip.clippingCfImageUrl,
      label: clip.label,
    }));
    return [
      ...fromInspirationPhotos,
      ...fromInspirationNodes,
      ...fromClippings,
    ];
  }, [board.inspirationPhotos, board.nodes, board.clippings]);

  const mixRefs = useMemo<RecipeReference[]>(
    () =>
      board.clippings.map((clip) => ({
        id: `clip:${clip.id}`,
        cfImageUrl: clip.clippingCfImageUrl,
        label: clip.label,
      })),
    [board.clippings],
  );

  // --- Handlers ------------------------------------------------------------

  const placeClippingOnCanvas = useCallback(
    (clipping: Clipping) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: clipping.clippingCfImageUrl,
        sourceType: "clipping",
        sourceId: clipping.id,
      });
    },
    [board],
  );

  const addItemToCanvas = useCallback(
    (item: CollectionItem) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: item.cfImageUrl,
        sourceType: item.sourceType,
        sourceId: item.sourceId ?? undefined,
      });
    },
    [board],
  );

  // Place a whole listing/inspiration photo from the drawer onto the canvas.
  // The server marks it "placed"; it keeps its own sourceType.
  const placeListingOnCanvas = useCallback(
    (photo: BoardPhoto) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: photo.cfImageUrl,
        sourceType: "listing_photo",
        sourceId: photo.sourceId,
      });
    },
    [board],
  );

  const placeRenderOnCanvas = useCallback(
    (photo: BoardPhoto) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: photo.cfImageUrl,
        sourceType: "render",
        sourceId: photo.sourceId,
      });
    },
    [board],
  );

  const placeFloorPlanOnCanvas = useCallback(
    (photo: BoardPhoto) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: photo.cfImageUrl,
        sourceType: "floor_plan",
        sourceId: photo.sourceId,
      });
    },
    [board],
  );

  const placeInspirationOnCanvas = useCallback(
    (photo: BoardPhoto) => {
      void board.addNode({
        kind: "image",
        cfImageUrl: photo.cfImageUrl,
        sourceType: "inspiration",
        sourceId: photo.sourceId,
      });
    },
    [board],
  );

  // Move a clipping between this room's Samples and the house-wide Global drawer.
  const setClippingGlobal = useCallback(
    (clipping: Clipping, next: boolean) => {
      void board.patchClipping(clipping.id, { isGlobal: next }).then(() => {
        toast.success(
          next
            ? "Moved to Global — it’s in every room now."
            : "Made room-only.",
        );
      });
    },
    [board],
  );

  // Open the extraction dialog against an inspiration photo from the drawer by
  // wrapping it in the lightweight node shape the dialog reads.
  const onExtractFromPhoto = useCallback(
    (photo: BoardPhoto) => {
      setExtractNode({
        id: `photo:${photo.sourceId}`,
        boardId: board.board?.id ?? "",
        kind: "image",
        cfImageUrl: photo.cfImageUrl,
        sourceType: "inspiration",
        sourceId: photo.sourceId,
        renderCanvasId: null,
        parentNodeId: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex: 0,
        isVisible: true,
        isLocked: false,
        metadata: null,
        createdAt: "",
        updatedAt: "",
      });
    },
    [board.board?.id],
  );

  // Sync-201 recipe executor. Flags the source node "processing" (ambient +
  // narration on the canvas) while the POST is in flight; on the 201 the body
  // carries the finished child node — drop it in with a staggered reveal. On
  // error, an honest recoverable toast (§7 copy). Defensive: if the API ever
  // returns the async (202) shape, insert its placeholder rather than crash.
  const handleRunRecipe = useCallback(
    (
      node: BoardNode,
      recipe:
        | "material-swap"
        | "mix"
        | "clay-to-photoreal"
        | "floor-plan-furnish"
        | "tone-unify"
        | "lighting-enhance"
        | "plan-to-isometric"
        | "evolution-grid",
      params: RecipeRunParams,
    ) => {
      board.setNodeProcessing(node.id, true, RECIPE_NARRATION[recipe]);
      void (async () => {
        try {
          const result = await runRecipe(node.id, recipe as RecipeKind, {
            referenceCfImageUrls: params.referenceCfImageUrls,
            prompt: params.prompt,
          });
          const child = isAsyncRecipeResult(result)
            ? result.placeholderNode
            : result.node;
          board.insertChildNode(child);
        } catch {
          toast.error("That render drifted — retry, or tighten the mask.");
        } finally {
          board.setNodeProcessing(node.id, false);
        }
      })();
    },
    [board],
  );

  const onExtractFromItem = useCallback(
    (item: CollectionItem) => {
      // Wrap a pile item into a lightweight node shape for the extract dialog.
      const pseudo: BoardNode = {
        id: item.id,
        boardId: board.board?.id ?? "",
        kind: "image",
        cfImageUrl: item.cfImageUrl,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        renderCanvasId: null,
        parentNodeId: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex: 0,
        isVisible: true,
        isLocked: false,
        metadata: null,
        createdAt: "",
        updatedAt: "",
      };
      setExtractNode(pseudo);
    },
    [board.board?.id],
  );

  if (board.loading) {
    return <BoardSkeleton />;
  }

  if (board.error && !board.board) {
    return (
      <div className="grid h-full place-items-center bg-[hsl(240_10%_4%)] p-8">
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            That table wouldn’t open
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{board.error}</p>
          <button
            type="button"
            onClick={() => void board.reload()}
            className="mt-4 rounded-md bg-foreground px-3 py-1.5 text-sm text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full min-h-0">
      <PilesRail
        board={board}
        onAddItemToCanvas={addItemToCanvas}
        onExtractFromItem={onExtractFromItem}
      />

      <div className="relative min-w-0 flex-1">
        {/* A drop-anywhere handler for placing a dragged item onto the canvas. */}
        <div
          className="absolute inset-0"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(DRAG_MIME);
            if (!raw) return;
            e.preventDefault();
            try {
              const payload = JSON.parse(raw) as {
                cfImageUrl: string;
                sourceType: BoardNode["sourceType"];
                sourceId?: string;
              };
              void board.addNode({ kind: "image", ...payload });
            } catch {
              /* ignore malformed drop */
            }
          }}
        >
          <WorkshopCanvas
            board={board}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onExtractClipping={setExtractNode}
            onMaterialSwap={(node) =>
              setRecipeState({ recipe: "material-swap", node })
            }
            onMix={(node) => setRecipeState({ recipe: "mix", node })}
            onClayToPhotoreal={(node) =>
              handleRunRecipe(node, "clay-to-photoreal", { referenceCfImageUrls: [] })
            }
            onFloorPlanFurnish={(node) =>
              handleRunRecipe(node, "floor-plan-furnish", { referenceCfImageUrls: [] })
            }
            onPlanToIsometric={(node) =>
              handleRunRecipe(node, "plan-to-isometric", { referenceCfImageUrls: [] })
            }
            onToneUnify={(node) =>
              handleRunRecipe(node, "tone-unify", { referenceCfImageUrls: [] })
            }
            onLightingEnhance={(node) =>
              handleRunRecipe(node, "lighting-enhance", { referenceCfImageUrls: [] })
            }
            onEvolutionGrid={(node) =>
              handleRunRecipe(node, "evolution-grid", { referenceCfImageUrls: [] })
            }
            onPlaceImage={() => setDrawerOpen(true)}
          />
        </div>

        <SampleDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          listingPhotos={board.listingPhotos}
          inspirationPhotos={board.inspirationPhotos}
          renderPhotos={board.renderPhotos}
          floorPlanPhotos={board.floorPlanPhotos}
          clippings={board.clippings}
          onPlaceListing={placeListingOnCanvas}
          onPlaceInspiration={placeInspirationOnCanvas}
          onPlaceRender={placeRenderOnCanvas}
          onPlaceFloorPlan={placeFloorPlanOnCanvas}
          onPlaceClipping={placeClippingOnCanvas}
          onExtractFromInspiration={onExtractFromPhoto}
          onSetClippingGlobal={setClippingGlobal}
        />
      </div>

      <ExtractClippingDialog
        node={extractNode}
        roomId={roomId}
        onClose={() => setExtractNode(null)}
        onExtracted={(clipping) => board.registerClipping(clipping)}
      />

      <RecipeDialog
        recipe={recipeState?.recipe ?? null}
        node={recipeState?.node ?? null}
        references={
          recipeState?.recipe === "material-swap" ? materialSwapRefs : mixRefs
        }
        onClose={() => setRecipeState(null)}
        onRun={handleRunRecipe}
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] w-full bg-[hsl(240_10%_4%)]">
      <div className="w-[132px] shrink-0 space-y-3 p-3 ring-1 ring-border/40">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-foreground/[0.05]"
          />
        ))}
      </div>
      <div className="grid flex-1 place-items-center">
        <div className="grid grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 w-56 animate-pulse rounded-lg bg-foreground/[0.05]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default WorkshopApp;
