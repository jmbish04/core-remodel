// ---------------------------------------------------------------------------
// RecipeDialog — shared runtime for the two node recipes:
//   • material-swap → "Try a different material" — pick ≤10 reference images
//     (inspiration nodes + saved clippings) + optional PlateJS prompt.
//   • mix           → "Mix with samples" — pick ≤10 clippings from the drawer
//     + optional prompt.
// This dialog only COLLECTS inputs (references + optional PlateJS prompt). It
// hands them to `onRun` and closes immediately, so the in-flight ambient +
// narration lands on the SOURCE node on the canvas (not behind a modal).
// WorkshopApp owns the sync-201 POST, the processing flag, and error handling.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { RecipePromptEditor } from "./RecipePromptEditor";
import type { BoardNode } from "../types";

const REFERENCE_CAP = 10;

export interface RecipeReference {
  id: string;
  cfImageUrl: string;
  label: string | null;
}

export interface RecipeRunParams {
  referenceCfImageUrls: string[];
  prompt?: string;
}

interface RecipeDialogProps {
  recipe: "material-swap" | "mix" | null;
  node: BoardNode | null;
  /** Candidate references — inspiration nodes + clippings (material-swap) or
   *  clippings only (mix). */
  references: RecipeReference[];
  onClose: () => void;
  /** Fire the recipe. WorkshopApp performs the POST + owns in-flight/errors. */
  onRun: (
    node: BoardNode,
    recipe: "material-swap" | "mix",
    params: RecipeRunParams,
  ) => void;
}

const COPY: Record<
  "material-swap" | "mix",
  { title: string; description: string; refLabel: string; cta: string }
> = {
  "material-swap": {
    title: "Try a different material",
    description:
      "Pick up to ten reference images of the finish you want. We keep your walls, windows, and layout exactly where they are.",
    refLabel: "Reference materials",
    cta: "Try it",
  },
  mix: {
    title: "Mix with samples",
    description:
      "Pick up to ten saved samples to blend onto this image. Add a note if you want to steer the look.",
    refLabel: "Samples to mix in",
    cta: "Mix it",
  },
};

export function RecipeDialog({
  recipe,
  node,
  references,
  onClose,
  onRun,
}: RecipeDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");

  const copy = recipe ? COPY[recipe] : null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= REFERENCE_CAP) {
        toast.error(`You can pick up to ${REFERENCE_CAP} references.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const selectedUrls = useMemo(
    () =>
      references
        .filter((ref) => selected.includes(ref.id))
        .map((ref) => ref.cfImageUrl),
    [references, selected],
  );

  const reset = () => {
    setSelected([]);
    setPrompt("");
  };

  const handleRun = () => {
    if (!node || !recipe) return;
    // Hand off + close immediately — the ambient/narration shows on the source
    // node while WorkshopApp awaits the 201.
    onRun(node, recipe, {
      referenceCfImageUrls: selectedUrls,
      prompt: prompt.trim() || undefined,
    });
    reset();
    onClose();
  };

  return (
    <Dialog
      open={Boolean(recipe && node)}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl ring-1 ring-border/40">
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold tracking-tight">
                {copy.title}
              </DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    {copy.refLabel}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {selected.length}/{REFERENCE_CAP}
                  </span>
                </div>
                {references.length === 0 ? (
                  <p className="rounded-lg bg-foreground/[0.02] px-3 py-6 text-center text-xs text-muted-foreground ring-1 ring-border/40">
                    Nothing to pick yet. Add inspiration to the board or extract
                    a sample first.
                  </p>
                ) : (
                  <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 overflow-y-auto">
                    {references.map((ref) => {
                      const isOn = selected.includes(ref.id);
                      return (
                        <button
                          key={ref.id}
                          type="button"
                          onClick={() => toggle(ref.id)}
                          aria-pressed={isOn}
                          className={cn(
                            "group relative aspect-square overflow-hidden rounded-lg bg-background outline-none ring-1 transition-all focus-visible:ring-2 focus-visible:ring-ring",
                            isOn
                              ? "ring-2 ring-primary"
                              : "ring-border/40 hover:ring-border",
                          )}
                        >
                          <img
                            src={ref.cfImageUrl}
                            alt={ref.label ?? "Reference"}
                            className="size-full object-cover"
                            draggable={false}
                          />
                          {isOn && (
                            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  Note (optional)
                </span>
                <RecipePromptEditor
                  onChange={setPrompt}
                  placeholder={
                    recipe === "material-swap"
                      ? "e.g. matte, warm-toned, large-format…"
                      : "e.g. keep it calm and light…"
                  }
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleRun}>{copy.cta}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RecipeDialog;
