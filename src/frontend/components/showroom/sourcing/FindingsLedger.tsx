/**
 * @fileoverview Workflow 2 (part B) — Findings & Sources ledger.
 *
 * Renders the sentiment-coded research findings (`store_research` /
 * `store_product_research`) and the external rating "sources"
 * (`showroom_store_ratings`) for the selected target. Each row carries a
 * good/bad/neutral sentiment chip and a new-vs-existing badge derived from its
 * timestamp, plus a deep-link to the citing source URL. Read-only diff view —
 * the approvable actions live on the candidate ledger and the rule-out form.
 */

import { ExternalLink, MessageSquareQuote, Sparkle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  isNewlySourced,
  ratingToSentiment,
  sentimentChip,
  sentimentLabel,
  type ExternalRating,
  type ResearchFinding,
} from "./types";

interface FindingsLedgerProps {
  findings: ResearchFinding[];
  /** External platform ratings shown as discovered "sources". */
  sources?: ExternalRating[];
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

export function FindingsLedger({ findings, sources = [] }: FindingsLedgerProps) {
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
            {findings.map((f) => {
              const isNew = isNewlySourced(f.timestamp);
              return (
                <li
                  key={f.id}
                  className="rounded-lg bg-card p-3 ring-1 ring-border/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">
                      {f.finding}
                    </p>
                    <SentimentBadge sentiment={f.sentiment} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {isNew ? (
                      <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[9px] text-violet-300">
                        <Sparkle className="mr-0.5 size-2.5" /> New
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        Existing
                      </Badge>
                    )}
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
                  </div>
                </li>
              );
            })}
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
