/**
 * @fileoverview Phase 2 — sweep plan-review interstitial.
 *
 * Drives a plan-gated showroom sweep: polls the `sourcing_sweep_sessions` row
 * and renders each phase — drafting, awaiting approval (plan markdown + onboard
 * agent annotations + Approve / Request-changes), sweeping, and completion. On
 * completion it bubbles up so the console can refresh findings/media; on cancel
 * it dismisses. Quick-mode sweeps don't use this — they run un-gated.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { approveSweepPlan, getSweepSession, reviseSweepPlan } from "./api";
import type { PlanAnnotation, SweepSession } from "./types";

interface SweepPlanReviewProps {
  sessionId: number;
  /** Fired when the approved sweep finishes, so the console can refresh. */
  onComplete: () => void;
  /** Dismiss the interstitial (returns to staging). */
  onClose: () => void;
}

function parseAnnotations(raw: string | null | undefined): PlanAnnotation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlanAnnotation[]) : [];
  } catch {
    return [];
  }
}

const ANNOTATION_TONE: Record<PlanAnnotation["kind"], string> = {
  scope: "text-sky-400",
  gap: "text-amber-400",
  redundancy: "text-zinc-400",
  constraint: "text-rose-400",
  risk: "text-rose-400",
};

export function SweepPlanReview({ sessionId, onComplete, onClose }: SweepPlanReviewProps) {
  const [session, setSession] = useState<SweepSession | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "revise">(null);
  const completedRef = useRef(false);

  const poll = useCallback(async () => {
    const result = await getSweepSession(sessionId);
    if (result.ok) setSession(result.data);
  }, [sessionId]);

  // Poll while the session is actively progressing (drafting / sweeping). In
  // terminal/idle states (awaiting_plan_approval / complete / failed) we stop
  // the interval so we don't poll the backend forever.
  useEffect(() => {
    void poll();
    const currentStatus = session?.status;
    const isProgressing =
      !currentStatus || currentStatus === "planning" || currentStatus === "sweeping";
    if (!isProgressing) return;
    const interval = setInterval(() => {
      void poll();
    }, 2500);
    return () => clearInterval(interval);
  }, [poll, session?.status]);

  // Fire onComplete once when the sweep finishes.
  useEffect(() => {
    if (session?.status === "complete" && !completedRef.current) {
      completedRef.current = true;
      toast.success("Sweep complete — findings updated.");
      onComplete();
    }
  }, [session?.status, onComplete]);

  const status = session?.status ?? "planning";
  const annotations = parseAnnotations(session?.planAnnotations);
  const isAwaiting = status === "awaiting_plan_approval";
  const isWorking = status === "planning" || status === "sweeping";

  async function approve() {
    setBusy("approve");
    const result = await approveSweepPlan(sessionId);
    setBusy(null);
    if (!result.ok) {
      toast.error(`Approve failed: ${result.error}`);
      return;
    }
    toast.success("Plan approved — running the sweep…");
    void poll();
  }

  async function requestChanges() {
    const trimmed = feedback.trim();
    if (!trimmed) {
      toast.error("Add feedback so the plan can be revised.");
      return;
    }
    setBusy("revise");
    const result = await reviseSweepPlan(sessionId, trimmed);
    setBusy(null);
    if (!result.ok) {
      toast.error(`Request failed: ${result.error}`);
      return;
    }
    toast.success("Re-planning with your feedback…");
    setFeedback("");
    setShowFeedback(false);
    void poll();
  }

  return (
    <Card className="ring-1 ring-violet-500/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-violet-400" />
              Research plan — review &amp; approve
            </CardTitle>
            <CardDescription>
              {isWorking
                ? status === "planning"
                  ? "Drafting and reviewing the plan…"
                  : "Running the approved sweep…"
                : isAwaiting
                  ? `Review the plan${(session?.planRevision ?? 0) > 0 ? ` (revision ${session?.planRevision})` : ""} and the agent's notes, then approve or request changes.`
                  : status === "failed"
                    ? "The plan-gated sweep failed."
                    : "Sweep complete."}
            </CardDescription>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Dismiss">
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isWorking && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/10 px-4 py-6 ring-1 ring-border/40">
            <Loader2 className="size-5 animate-spin text-violet-400" />
            <p className="text-sm text-muted-foreground">
              {status === "planning" ? "Gemini is drafting a plan; the onboard agent will annotate it." : "Scraping sources, images, and specs from the approved plan."}
            </p>
          </div>
        )}

        {status === "failed" && (
          <div className="rounded-lg bg-rose-500/5 px-4 py-4 text-sm text-rose-300 ring-1 ring-rose-500/25">
            {session?.errorMessage ?? "Unknown error."}
          </div>
        )}

        {isAwaiting && (
          <>
            {annotations.length > 0 && (
              <div className="rounded-lg bg-card p-3 ring-1 ring-border/40">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Onboard agent review · {annotations.length}
                </p>
                <ul className="space-y-1.5">
                  {annotations.map((a, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed">
                      <span className={cn("shrink-0 font-mono uppercase", ANNOTATION_TONE[a.kind] ?? "text-zinc-400")}>
                        {a.kind}
                      </span>
                      <span className="text-foreground/80">{a.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/10 p-4 text-xs leading-relaxed text-foreground/90 ring-1 ring-border/40">
              {session?.planMarkdown || "No plan content."}
            </pre>

            {showFeedback && (
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change? e.g. focus on slab inventory; exclude appointment-only showrooms."
                className="min-h-20 text-sm"
              />
            )}

            <div className="flex items-center justify-end gap-2">
              {showFeedback ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowFeedback(false);
                      setFeedback("");
                    }}
                    disabled={busy !== null}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={requestChanges} disabled={busy !== null}>
                    {busy === "revise" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Send changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setShowFeedback(true)} disabled={busy !== null}>
                    Request changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={approve}
                    disabled={busy !== null}
                    className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90"
                  >
                    {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Approve &amp; run
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
