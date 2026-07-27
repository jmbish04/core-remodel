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

import { editNode } from "../api";
import type { BoardNode } from "../types";

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
      const result = await editNode(node.id, { prompt: prompt.trim() });
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
