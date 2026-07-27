// ---------------------------------------------------------------------------
// FreeformEditDialog — the conversational power tool alongside the preset
// recipes. Type a free instruction ("add a brass sconce over the mirror",
// "remove the rug", "make the sofa brown leather") → Gemini edits the node,
// shows its thinking, and drops the result on the canvas as a child node.
//
// Multi-turn = chaining: each edit produces a new child; to keep iterating,
// run "Edit with words" again on that child. So this dialog stays single-turn
// per open and the canvas holds the revision thread.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { editNode } from "../api";
import type { BoardNode } from "../types";

/** A tiny segmented toggle (Monolith: ring group, active = filled). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-0.5 rounded-md p-0.5 ring-1 ring-border/40">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              value === o.value
                ? "bg-foreground/[0.1] text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface FreeformEditDialogProps {
  node: BoardNode | null;
  /** Drop the edited child node onto the board. */
  onResult: (child: BoardNode) => void;
  onClose: () => void;
}

export function FreeformEditDialog({ node, onResult, onClose }: FreeformEditDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [thoughts, setThoughts] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<"2K" | "4K">("2K");
  const [model, setModel] = useState<"flash" | "pro">("flash");

  // Reset when the target node changes (dialog reopened on another node).
  useEffect(() => {
    setPrompt("");
    setThoughts(null);
    setRunning(false);
  }, [node]);

  const run = async () => {
    if (!node || !prompt.trim()) return;
    setRunning(true);
    setThoughts(null);
    try {
      const result = await editNode(node.id, { prompt: prompt.trim(), imageSize, model });
      onResult(result.node);
      setThoughts(result.thoughts || "Done.");
      toast.success("Edit applied — added to the canvas.");
    } catch {
      toast.error("That edit didn’t take — try rewording it.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5" />
            Edit with words
          </DialogTitle>
          <DialogDescription>
            Describe the change — add or remove things, swap a material, adjust the scene. The
            result lands on the canvas; edit it again to keep going.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Add a large arched mirror over the vanity and remove the potted plant."
          rows={3}
          disabled={running}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
          }}
        />

        <div className="flex flex-wrap items-center gap-4">
          <Segmented
            label="Quality"
            value={imageSize}
            options={[
              { value: "2K", label: "2K" },
              { value: "4K", label: "4K" },
            ]}
            onChange={setImageSize}
            disabled={running}
          />
          <Segmented
            label="Model"
            value={model}
            options={[
              { value: "flash", label: "Fast" },
              { value: "pro", label: "Pro" },
            ]}
            onChange={setModel}
            disabled={running}
          />
        </div>

        {thoughts ? (
          <div className="rounded-lg bg-card p-3 text-sm text-muted-foreground ring-1 ring-border/40">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-foreground/70">
              <Sparkles className="size-3.5" />
              What it did
            </p>
            {thoughts}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Close
          </Button>
          <Button onClick={() => void run()} disabled={running || !prompt.trim()} className="gap-2">
            <Wand2 className="size-4" />
            {running ? "Editing…" : "Apply edit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FreeformEditDialog;
