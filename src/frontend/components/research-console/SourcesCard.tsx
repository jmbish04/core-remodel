/**
 * @fileoverview SourcesCard — the reference list cited across a research report.
 *
 * Renders job.sources (a shortId → source map) as a list of [title](url) rows,
 * each with its domain and a count of the claims it supports. Collapsible; hidden
 * entirely when there are no sources.
 */

import { ExternalLink, Quote } from "lucide-react";

import type { JobSource } from "./types";

export function SourcesCard({ sources }: { sources: Record<string, JobSource> | null }) {
  const list = sources ? Object.values(sources) : [];
  if (list.length === 0) return null;

  // Stable, readable order: most-cited first, then alphabetical by domain.
  const ordered = [...list].sort((a, b) => {
    const d = (b.supportedClaims?.length ?? 0) - (a.supportedClaims?.length ?? 0);
    if (d !== 0) return d;
    return (a.domain ?? "").localeCompare(b.domain ?? "");
  });

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <h2 className="text-base font-semibold">Sources ({ordered.length})</h2>
      <ul className="mt-4 divide-y divide-border/40">
        {ordered.map((src) => {
          const claims = src.supportedClaims?.length ?? 0;
          return (
            <li key={src.shortId || src.url} className="py-2.5">
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2"
              >
                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-sky-400" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm font-medium text-sky-400 group-hover:underline">
                    {src.title || src.domain || src.url}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {src.domain ? <span>{src.domain}</span> : null}
                    {claims > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Quote className="size-3" />
                        {claims} claim{claims === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
