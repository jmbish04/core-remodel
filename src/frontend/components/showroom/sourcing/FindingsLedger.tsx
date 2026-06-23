/**
 * @fileoverview Workflow 2 (part B) — Findings & Sources ledger with HITL review.
 *
 * Renders the sentiment-coded research findings (`store_research` /
 * `store_product_research`) and the external rating "sources"
 * (`showroom_store_ratings`) for the selected target. Each finding carries a
 * good/bad/neutral sentiment chip, a new-vs-existing badge, a deep-link to the
 * citing source — and per-fact **Approve / Reject** controls. Workers AI binds
 * findings to a fixed target, so a fact can be mis-attributed; approving keeps a
 * correct fact and rejecting (one tap) marks a wrong/low-quality one, whose text
 * is replayed as a negative constraint on the next sweep. External rating
 * sources are platform data (not AI-parsed), so they stay read-only.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, MessageSquareQuote, Sparkle, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { reviewFinding, type ReviewScope } from "./api";
import {
  isNewlySourced,
  ratingToSentiment,
  sentimentChip,
  sentimentLabel,
  type ExternalRating,
  type ResearchFinding,
  type ReviewStatus,
} from "./types";

interface FindingsLedgerProps {
  findings: ResearchFinding[];
  /** External platform ratings shown as discovered "sources". */
  sources?: ExternalRating[];
  /** Selects the table the finding lives in (product vs store scoped). */
  scope: ReviewScope;
  /** Re-fetch the target context after a review write lands. */
  onReviewed: () => void;
}

function SentimentBadge({ sentiment }: { sentiment: Parameters<typeof sentimentChip>[0] }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ring-1",
        sentimentChip(sentiment),
      )}
    >
      {sentimentLabel(sentiment)}
    </span>
  );
}

/** Monolith chip for a finding's HITL review state. */
function reviewChip(status: ReviewStatus): string {
  if (status === "approved") return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25";
  if (status === "rejected") return "bg-rose-500/10 text-rose-400 ring-rose-500/25";
  return "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25";
}

function FindingRow({ finding: f, scope, onReviewed }: { finding: ResearchFinding; scope: ReviewScope; onReviewed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  async function review(status: ReviewStatus, reason?: string) {
    setBusy(true);
    const result = await reviewFinding(scope, f.id, status, reason?.trim() || undefined);
    setBusy(false);
    if (!result.ok) {
      toast.error(`Review failed: ${result.error}`);
      return;
    }
    setRejectOpen(false);
    setRejectReason("");
    toast.success(status === "approved" ? "Finding approved." : "Finding rejected — it will steer future sweeps.");
    onReviewed();
  }

  const isNew = isNewlySourced(f.timestamp);
  const status: ReviewStatus = f.reviewStatus ?? "pending";

  return (
    <li
      className={cn(
        "rounded-lg p-3 ring-1 transition",
        status === "rejected"
          ? "bg-card/40 opacity-60 ring-border/40"
          : "bg-card ring-border/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 text-sm leading-relaxed text-foreground/90",
            status === "rejected" && "line-through",
          )}
        >
          {f.finding}
        </p>
        <SentimentBadge sentiment={f.sentiment} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {isNew ? (
          <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[9px] text-violet-300">
            <Sparkle className="mr-0.5 size-2.5" /> New
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] text-muted-foreground">
            Existing
          </Badge>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ring-1",
            reviewChip(status),
          )}
        >
          {status}
        </span>
        {f.findingUrl ? (
          <a
            href={f.findingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
          >
            <ExternalLink className="size-3" />
            Source
          </a>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {status !== "approved" ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => review("approved")}
              disabled={busy}
              className="text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Approve
            </Button>
          ) : null}
          {status !== "rejected" ? (
            <Popover
              open={rejectOpen}
              onOpenChange={setRejectOpen}
            >
              <PopoverTrigger
                render={
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                  />
                }
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                Reject
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-2 p-3" align="end">
                <p className="text-[11px] font-medium text-foreground/80">
                  Why is this finding wrong?
                </p>
                <Textarea
                  placeholder="e.g. mis-attributed to wrong brand (optional)"
                  className="h-20 resize-none text-xs"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setRejectOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => review("rejected", rejectReason)}
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Confirm reject
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function FindingsLedger({ findings, sources = [], scope, onReviewed }: FindingsLedgerProps) {
  const isEmpty = findings.length === 0 && sources.length === 0;
  if (isEmpty) {
    return (
      <div className="rounded-lg bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground ring-1 ring-border/40">
        No findings yet. Launch a sweep to populate the ledger.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {findings.length > 0 ? (
        <section className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Findings · {findings.length}
          </h4>
          <ul className="space-y-2">
            {findings.map((f) => (
              <FindingRow key={f.id} finding={f} scope={scope} onReviewed={onReviewed} />
            ))}
          </ul>
        </section>
      ) : null}

      {sources.length > 0 ? (
        <section className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Review sources · {sources.length}
          </h4>
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id} className="rounded-lg bg-card p-3 ring-1 ring-border/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <MessageSquareQuote className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs font-medium capitalize">{s.source}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{s.rating}/5</span>
                    </div>
                    {s.comment ? (
                      <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
                        {s.comment}
                      </p>
                    ) : null}
                  </div>
                  <SentimentBadge sentiment={ratingToSentiment(s.rating)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
