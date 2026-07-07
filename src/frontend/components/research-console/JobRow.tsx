/**
 * @fileoverview JobRow — one row in the research-console landing list.
 *
 * Ongoing jobs (pending/running) foreground a live progress bar + % + a
 * currentStep narration line + elapsed time. Terminal jobs show their status
 * chip, completion time, and (on failure) the error. The whole row links to the
 * job viewport; entity-bound jobs also expose a secondary deep-link chip to the
 * entity's own viewport.
 */

import { ArrowUpRight, Clock } from "lucide-react";

import type { JobListRow } from "./types";
import { entityHref, formatElapsed, formatDateTime, isActiveStatus } from "./types";
import { KindBadge, ProgressBar, StatusChip } from "./JobBadges";

// Human labels for the entity deep-link chip.
const ENTITY_LABEL: Record<string, string> = {
  showroom: "showroom",
  brand: "brand",
  product: "product",
};

export function JobRow({ job }: { job: JobListRow }) {
  const active = isActiveStatus(job.status);
  const href = `/admin/shopping/research/${job.id}`;
  const entity = entityHref(job);

  return (
    <div className="group relative rounded-xl bg-card p-4 ring-1 ring-border/40 transition-all hover:ring-primary/40">
      <a href={href} aria-label={`Open research: ${job.title}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={job.kind} />
              <StatusChip status={job.status} />
            </div>
            <h3 className="mt-2 truncate pr-6 text-sm font-semibold tracking-tight text-card-foreground">
              {job.title || "Untitled research"}
            </h3>
          </div>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
        </div>

        {/* Live progress block — only while the job is in-flight. */}
        {active ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="line-clamp-1 flex-1">
                {job.currentStep || "Working…"}
              </span>
              <span className="shrink-0 tabular-nums">{Math.round(job.progress)}%</span>
            </div>
            <ProgressBar value={job.progress} status={job.status} />
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <Clock className="size-3" />
              {formatElapsed(job.createdAt, null)} elapsed
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono uppercase tracking-widest">
              {job.status === "failed" ? "Failed" : "Completed"}{" "}
              {formatDateTime(job.completedAt ?? job.updatedAt)}
            </span>
            {job.status === "failed" && job.error ? (
              <span className="line-clamp-1 text-rose-300/80">{job.error}</span>
            ) : null}
          </div>
        )}
      </a>

      {/* Entity deep-link — layered outside the row anchor's activation. */}
      {entity ? (
        <a
          href={entity}
          onClick={(e) => e.stopPropagation()}
          className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground"
        >
          {job.entityName || ENTITY_LABEL[job.entityType ?? ""] || "entity"}
          <ArrowUpRight className="size-3" />
        </a>
      ) : null}
    </div>
  );
}
