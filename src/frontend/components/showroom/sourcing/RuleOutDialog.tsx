/**
 * @fileoverview Workflow 3 — Rule-Out Feedback micro-form.
 *
 * Archives / rules out a showroom with a structured reason. The reason is
 * written as a homeowner store rating of 1 (`POST /api/showroom-stores/:id/rate`
 * with `ratingNotes`). The autonomous cron monitor reads stores whose active
 * rating is <= 1 and replays the `ratingNotes` as negative constraints when it
 * re-sweeps the category — so this form directly tunes future sourcing.
 *
 * Uses the shadcn Dialog (never window.confirm) per the Monolith conventions.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { rateStore } from "./api";

interface RuleOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: { id: number; name: string } | null;
  /** Fired after the negative rating is persisted, so the parent can refresh. */
  onRuledOut: (storeId: number) => void;
}

/** Quick-tap reasons; the homeowner can also add free text. */
const REASON_CHIPS = [
  "Too far from SF",
  "Wrong category",
  "Price point off",
  "Closed / defunct",
  "Poor reviews",
  "Duplicate listing",
] as const;

export function RuleOutDialog(props: RuleOutDialogProps) {
  const { open, onOpenChange, store, onRuledOut } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form whenever a different showroom is targeted.
  useEffect(() => {
    if (open) {
      setSelected([]);
      setNote("");
    }
  }, [open, store?.id]);

  function toggleChip(reason: string) {
    setSelected((cur) =>
      cur.includes(reason) ? cur.filter((r) => r !== reason) : [...cur, reason],
    );
  }

  async function handleConfirm() {
    if (!store) return;
    const reason = [...selected, note.trim()].filter(Boolean).join(" · ");
    if (!reason) {
      toast.error("Add at least one reason so the cron can learn from it.");
      return;
    }
    setSaving(true);
    const result = await rateStore(store.id, 1, reason);
    setSaving(false);
    if (!result.ok) {
      toast.error(`Rule-out failed: ${result.error}`);
      return;
    }
    toast.success(`Ruled out “${store.name}” — feedback queued for the sweep cron.`);
    onRuledOut(store.id);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-rose-400" />
            Why rule this out?
          </DialogTitle>
          <DialogDescription>
            Your reason feeds back into the scraper's parameters to refine future
            sweeps of {store ? <span className="text-foreground">{store.name}</span> : "this showroom"}'s category.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REASON_CHIPS.map((reason) => {
              const active = selected.includes(reason);
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => toggleChip(reason)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition ring-1",
                    active
                      ? "bg-rose-500/15 text-rose-300 ring-rose-500/40"
                      : "bg-card text-muted-foreground ring-border/40 hover:ring-border",
                  )}
                >
                  {reason}
                </button>
              );
            })}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add specifics (optional) — e.g. 45-min drive, no slab inventory, appointment-only."
            className="min-h-20 resize-y text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
            Rule out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
