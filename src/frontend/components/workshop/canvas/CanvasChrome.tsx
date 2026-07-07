// ---------------------------------------------------------------------------
// CanvasChrome — the overlay chrome kept from the devl.dev shell, Monolith-ized
// (ring-1 ring-border/40, no border border-border) and split into focused
// pieces: the zoom controls, the status pill, and the node inspector. The
// vector-shape inspector became an image-node inspector: position/size in
// JetBrains-mono tabular numerals + lock/visibility toggles + delete.
// ---------------------------------------------------------------------------

import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  Maximize2,
  MinusIcon,
  PlusIcon,
  Trash2,
  UnlockIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { nodeAltText, type BoardNode } from "../types";

export function ZoomControls({
  zoom,
  onIn,
  onOut,
  onFit,
}: {
  zoom: number;
  onIn: () => void;
  onOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-full bg-card/85 p-1 shadow-lg ring-1 ring-border/40 backdrop-blur">
      <Tooltip>
        <TooltipTrigger
          aria-label="Zoom out"
          onClick={onOut}
          className="grid size-7 place-items-center rounded-full text-foreground/70 outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MinusIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>Zoom out</TooltipPopup>
      </Tooltip>
      <span className="min-w-[46px] px-2 text-center font-mono text-xs tabular-nums text-foreground/80">
        {Math.round(zoom * 100)}%
      </span>
      <Tooltip>
        <TooltipTrigger
          aria-label="Zoom in"
          onClick={onIn}
          className="grid size-7 place-items-center rounded-full text-foreground/70 outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>Zoom in</TooltipPopup>
      </Tooltip>
      <span className="mx-1 h-5 w-px bg-border/60" />
      <Tooltip>
        <TooltipTrigger
          aria-label="Fit to screen"
          onClick={onFit}
          className="grid size-7 place-items-center rounded-full text-foreground/70 outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>Fit to screen</TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function StatusPill({
  selected,
  total,
}: {
  selected: BoardNode | null;
  total: number;
}) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-card/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/70 ring-1 ring-border/40 backdrop-blur">
      {selected
        ? `1 selected · ${Math.round(selected.width)} × ${Math.round(selected.height)}`
        : `${total} node${total === 1 ? "" : "s"} · drag to move · right-click to run a tool`}
    </div>
  );
}

export function NodeInspector({
  node,
  nodes,
  selectedId,
  onSelect,
  onUpdate,
  onToggleVisible,
  onToggleLocked,
  onDelete,
}: {
  node: BoardNode | null;
  nodes: BoardNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BoardNode>) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 z-10 w-72 overflow-hidden rounded-xl bg-card/85 shadow-lg ring-1 ring-border/40 backdrop-blur">
      <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        Inspector
      </div>
      <div className="h-px bg-border/40" />

      {!node ? (
        <div className="px-3 py-6 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            No selection
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Pick an image on the table to see its position, size, and controls.
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-3 py-3">
          <Section title="Position">
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="X"
                value={Math.round(node.x)}
                onChange={(v) => onUpdate(node.id, { x: v })}
              />
              <NumberField
                label="Y"
                value={Math.round(node.y)}
                onChange={(v) => onUpdate(node.id, { y: v })}
              />
            </div>
          </Section>
          <Section title="Size">
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="W"
                value={Math.round(node.width)}
                onChange={(v) => onUpdate(node.id, { width: Math.max(16, v) })}
              />
              <NumberField
                label="H"
                value={Math.round(node.height)}
                onChange={(v) => onUpdate(node.id, { height: Math.max(16, v) })}
              />
            </div>
          </Section>
          <Section title="Source">
            <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
              {nodeAltText(node)}
            </p>
          </Section>
        </div>
      )}

      <div className="h-px bg-border/40" />

      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Layers
          </span>
          {node ? (
            <button
              type="button"
              onClick={() => onDelete(node.id)}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-3" /> Delete
            </button>
          ) : null}
        </div>
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {nodes.length === 0 ? (
            <p className="px-1.5 py-2 text-[11px] text-muted-foreground">
              No nodes yet.
            </p>
          ) : (
            [...nodes]
              .sort((a, b) => b.zIndex - a.zIndex)
              .map((layer) => {
                const isActive = selectedId === layer.id;
                return (
                  <div
                    key={layer.id}
                    onClick={() => onSelect(layer.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-foreground/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleVisible(layer.id);
                      }}
                      aria-label={layer.isVisible ? "Hide node" : "Show node"}
                      className="grid size-4 place-items-center text-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {layer.isVisible ? (
                        <EyeIcon className="size-3" />
                      ) : (
                        <EyeOffIcon className="size-3" />
                      )}
                    </button>
                    <span className="flex-1 truncate">{nodeAltText(layer)}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLocked(layer.id);
                      }}
                      aria-label={layer.isLocked ? "Unlock node" : "Lock node"}
                      className="grid size-4 place-items-center text-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {layer.isLocked ? (
                        <LockIcon className="size-3" />
                      ) : (
                        <UnlockIcon className="size-3" />
                      )}
                    </button>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-md bg-background px-2 py-1 ring-1 ring-border/40 focus-within:ring-2 focus-within:ring-ring">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={String(value)}
        key={value}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full bg-transparent font-mono text-[11px] tabular-nums text-foreground outline-none"
      />
    </label>
  );
}
