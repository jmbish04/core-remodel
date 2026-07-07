// ---------------------------------------------------------------------------
// PilesRail — the docked side-rail of "piles". Each pile is a LayeredStack that
// fans on hover. You can:
//   • drop an image (a node or an artifact) onto a pile to add it (POST item);
//   • click "+ new pile" to create one instantly (naming optional);
//   • double-click a pile name to rename it inline;
//   • click a fanned photo → a small action menu (Add to canvas / Extract a
//     sample…).
// Drop data is a JSON payload set by the drag source (see DRAG_MIME).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { LayeredStack } from "./LayeredStack";
import type { Collection, CollectionItem, NodeSourceType } from "../types";
import type { UseBoardResult } from "../hooks/useBoard";

export const DRAG_MIME = "application/x-workshop-image";

export interface DragPayload {
  cfImageUrl: string;
  sourceType: NodeSourceType;
  sourceId?: string;
}

interface PilesRailProps {
  board: UseBoardResult;
  onAddItemToCanvas: (item: CollectionItem) => void;
  onExtractFromItem: (item: CollectionItem) => void;
}

interface FanMenuState {
  item: CollectionItem;
  x: number;
  y: number;
}

export function PilesRail({
  board,
  onAddItemToCanvas,
  onExtractFromItem,
}: PilesRailProps) {
  const { collections, createCollection, renameCollection, addItemToCollection } =
    board;
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [fanMenu, setFanMenu] = useState<FanMenuState | null>(null);

  useEffect(() => {
    if (!fanMenu) return;
    const onDown = () => setFanMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFanMenu(null);
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [fanMenu]);

  const readDrag = (event: React.DragEvent): DragPayload | null => {
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  };

  const handleDrop = (collectionId: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(null);
    const payload = readDrag(event);
    if (!payload) return;
    void addItemToCollection(collectionId, payload);
  };

  const handleDropNewPile = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(null);
    const payload = readDrag(event);
    const collection = await createCollection();
    if (collection && payload) {
      void addItemToCollection(collection.id, payload);
    }
  };

  return (
    <aside
      aria-label="Photo piles"
      className="flex h-full w-[132px] shrink-0 flex-col gap-3 overflow-y-auto bg-card/40 p-3 ring-1 ring-border/40"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        Piles
      </div>

      {collections.length === 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Drag photos here to start a pile.
        </p>
      )}

      {collections.map((collection) => (
        <PileSlot
          key={collection.id}
          collection={collection}
          isDragOver={dragOver === collection.id}
          isRenaming={renaming === collection.id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(collection.id);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(collection.id, e)}
          onStartRename={() => setRenaming(collection.id)}
          onCommitRename={(name) => {
            setRenaming(null);
            if (name.trim()) void renameCollection(collection.id, name.trim());
          }}
          onCancelRename={() => setRenaming(null)}
          onPhotoClick={(item, anchor) =>
            setFanMenu({ item, x: anchor.x, y: anchor.y })
          }
        />
      ))}

      {/* "+ new pile" ghost slot — instant creation. */}
      <button
        type="button"
        onClick={() => void createCollection()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver("__new__");
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={handleDropNewPile}
        className={cn(
          "flex h-14 items-center justify-center gap-1.5 rounded-lg text-[11px] text-muted-foreground outline-none ring-1 ring-dashed ring-border/50 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          dragOver === "__new__" && "bg-primary/10 ring-primary/50",
        )}
      >
        <Plus className="size-3.5" /> New pile
      </button>

      {fanMenu && (
        <div
          role="menu"
          className="fixed z-50 w-44 overflow-hidden rounded-lg bg-card/95 p-1 shadow-xl ring-1 ring-border/40 backdrop-blur"
          style={{ left: fanMenu.x + 8, top: fanMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full rounded-md px-2.5 py-2 text-left text-[13px] outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onAddItemToCanvas(fanMenu.item);
              setFanMenu(null);
            }}
          >
            Add to canvas
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full rounded-md px-2.5 py-2 text-left text-[13px] outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onExtractFromItem(fanMenu.item);
              setFanMenu(null);
            }}
          >
            Extract a sample…
          </button>
        </div>
      )}
    </aside>
  );
}

function PileSlot({
  collection,
  isDragOver,
  isRenaming,
  onDragOver,
  onDragLeave,
  onDrop,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onPhotoClick,
}: {
  collection: Collection;
  isDragOver: boolean;
  isRenaming: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onPhotoClick: (item: CollectionItem, anchor: { x: number; y: number }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-lg p-1.5 transition-colors",
        isDragOver && "bg-primary/10 ring-1 ring-primary/50",
      )}
    >
      <LayeredStack items={collection.items} onPhotoClick={onPhotoClick} />
      <div className="mt-1.5 flex items-center justify-between gap-1">
        {isRenaming ? (
          <input
            ref={inputRef}
            defaultValue={collection.name ?? ""}
            placeholder="Name…"
            onBlur={(e) => onCommitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onCancelRename();
            }}
            className="w-full rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none ring-1 ring-border/40 focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={onStartRename}
            title="Double-click to rename"
            className="truncate text-left text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {collection.name || (
              <span className="font-mono tabular-nums">
                {collection.items.length} photo
                {collection.items.length === 1 ? "" : "s"}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default PilesRail;
