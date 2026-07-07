// ---------------------------------------------------------------------------
// ToolsPalette — the full devl.dev tool rail, Monolith-ized (ring-1, no 1px
// border). Move / Hand / Frame / Ellipse / Text / Pen / Place image / More.
// "Place image (I)" opens the drawer (our rendition of the template's image
// placement). "More" opens the node context menu for the current selection (or
// a no-op stub when nothing is selected).
// ---------------------------------------------------------------------------

import {
  Circle as CircleIcon,
  Hand,
  ImageIcon,
  MoreHorizontal,
  MousePointer2,
  Pen,
  Square,
  Type,
} from "lucide-react";

import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Tool =
  | "move"
  | "hand"
  | "frame"
  | "ellipse"
  | "text"
  | "pen"
  | "image"
  | "more";

export const TOOLS: {
  id: Tool;
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
}[] = [
  { id: "move", icon: MousePointer2, label: "Move", shortcut: "V" },
  { id: "hand", icon: Hand, label: "Hand", shortcut: "H" },
  { id: "frame", icon: Square, label: "Frame", shortcut: "F" },
  { id: "ellipse", icon: CircleIcon, label: "Ellipse", shortcut: "O" },
  { id: "text", icon: Type, label: "Text", shortcut: "T" },
  { id: "pen", icon: Pen, label: "Pen", shortcut: "P" },
  { id: "image", icon: ImageIcon, label: "Place image", shortcut: "I" },
  { id: "more", icon: MoreHorizontal, label: "More", shortcut: "" },
];

/** Shape-creating tools that arm drag-to-create with a crosshair cursor. */
export const DRAG_CREATE_TOOLS: ReadonlySet<Tool> = new Set([
  "frame",
  "ellipse",
  "text",
]);

interface ToolsPaletteProps {
  tool: Tool;
  onChangeTool: (t: Tool) => void;
  /** Invoked when the "Place image" tool is picked → opens the drawer. */
  onPlaceImage: () => void;
  /** Invoked when "More" is picked → opens the selection's context menu. */
  onMore: () => void;
}

export function ToolsPalette({
  tool,
  onChangeTool,
  onPlaceImage,
  onMore,
}: ToolsPaletteProps) {
  const handlePick = (id: Tool) => {
    if (id === "image") {
      onPlaceImage();
      return;
    }
    if (id === "more") {
      onMore();
      return;
    }
    onChangeTool(id);
  };

  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-0.5 rounded-xl bg-card/85 p-1 shadow-lg ring-1 ring-border/40 backdrop-blur">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const isActive = tool === t.id && t.id !== "image" && t.id !== "more";
        return (
          <Tooltip key={t.id}>
            <TooltipTrigger
              aria-label={t.label}
              aria-pressed={isActive}
              onClick={() => handlePick(t.id)}
              className={cn(
                "grid size-9 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-foreground/[0.1] text-foreground"
                  : "text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <span className="flex items-center gap-2">
                {t.label}
                {t.shortcut ? (
                  <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground ring-1 ring-border/40">
                    {t.shortcut}
                  </span>
                ) : null}
              </span>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default ToolsPalette;
