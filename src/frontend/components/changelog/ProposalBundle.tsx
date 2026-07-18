/**
 * @fileoverview The artifact bundle behind a preview changelog entry.
 *
 * Renders on /admin/changelog/preview/[slug] under the normal entry view: the
 * PRD, the design brief, the PROMPT (with a copy button — that is the handoff
 * artifact a human pastes into a coding agent), the linked plan tasks with their
 * LIVE status, and a link to the raw conversation transcript.
 *
 * The transcript is NOT inlined. It is a ~450KB R2 object fetched on demand, and
 * its size is shown before you click so the choice is informed.
 *
 * The coverage note sits directly beside the transcript link, never below the
 * fold and never in a tooltip. Transcripts are frequently partial (a dump often
 * only reaches a compaction boundary), and a reader who assumes completeness
 * will read a gap as a decision nobody made.
 */
import { useState } from "react";

import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";

export interface ProposalTaskView {
  taskKey: string;
  title: string;
  workstream: string;
  phase: number;
  changeType: string;
  status: "pending" | "in_progress" | "blocked" | "deferred" | "done";
  notes: string | null;
}

export interface ProposalBundleProps {
  slug: string;
  status: string;
  sourceKind: string;
  sourceModel: string | null;
  planSlug: string | null;
  prdMarkdown: string | null;
  designBriefMarkdown: string | null;
  promptMarkdown: string | null;
  tasks: ProposalTaskView[];
  context: {
    available: boolean;
    bytes: number | null;
    sha256: string | null;
    coverageNote: string | null;
    href: string;
  };
}

const TASK_STATUS_STYLE: Record<ProposalTaskView["status"], string> = {
  done: "bg-emerald-500/12 text-emerald-300",
  in_progress: "bg-sky-500/12 text-sky-300",
  blocked: "bg-rose-500/12 text-rose-300",
  deferred: "bg-zinc-500/12 text-zinc-400",
  pending: "bg-amber-500/12 text-amber-300",
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Copy-to-clipboard button for the PROMPT — the whole point of rendering it. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard is blocked outside a secure context / without permission.
          // Say so rather than silently appearing to have copied nothing.
          setCopied(false);
          window.prompt("Copy the prompt manually:", text);
        }
      }}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
        copied
          ? "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30"
          : "bg-card text-muted-foreground ring-border/40 hover:text-foreground",
      )}
    >
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4 rounded-xl bg-card p-5 ring-1 ring-border/40">{children}</div>
    </section>
  );
}

export function ProposalBundle(props: ProposalBundleProps) {
  const { prdMarkdown, designBriefMarkdown, promptMarkdown, tasks, context } = props;

  return (
    <div className="mt-10 border-t border-border/40 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-300">
          Proposal bundle
        </span>
        <span className="rounded-md bg-card px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/40">
          {props.status}
        </span>
        <span className="text-[11px] text-muted-foreground">
          filed by {props.sourceKind.replace("_", " ")}
          {props.sourceModel ? ` · ${props.sourceModel}` : ""}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        The thinking behind this entry, carried forward so it can be picked up later without
        rebuilding it from a summary.
      </p>

      {promptMarkdown ? (
        <Panel
          title="Prompt"
          subtitle="The handoff artifact — paste this to start a coding agent."
          action={<CopyButton text={promptMarkdown} />}
        >
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
            {promptMarkdown}
          </pre>
        </Panel>
      ) : null}

      {prdMarkdown ? (
        <Panel title="PRD">
          <MarkdownProse>{prdMarkdown}</MarkdownProse>
        </Panel>
      ) : null}

      {designBriefMarkdown ? (
        <Panel title="Design brief">
          <MarkdownProse>{designBriefMarkdown}</MarkdownProse>
        </Panel>
      ) : null}

      <Panel
        title="Original conversation"
        subtitle="Raw and unsummarized — the rejected alternatives and the constraints found mid-discussion live here, not in the PRD."
      >
        {context.available ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={context.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-sky-500/12 px-2.5 py-1 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/20"
              >
                Open transcript ↗
              </a>
              <span className="text-[11px] text-muted-foreground">{formatBytes(context.bytes)}</span>
              {context.sha256 ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  sha256 {context.sha256.slice(0, 12)}…
                </span>
              ) : null}
            </div>
            {/*
             * Rendered as a warning, not a footnote. An unrecorded coverage note
             * is itself the risk — silence reads as "complete" to every reader
             * who does not know better.
             */}
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-xs leading-relaxed ring-1",
                context.coverageNote
                  ? "bg-amber-500/8 text-amber-200/90 ring-amber-500/25"
                  : "bg-rose-500/8 text-rose-200/90 ring-rose-500/25",
              )}
            >
              <span className="font-semibold uppercase tracking-wide">Coverage — </span>
              {context.coverageNote ??
                "Not recorded. Treat this transcript's completeness as UNKNOWN: it may stop at a compaction boundary or omit earlier discussion."}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No transcript was attached to this proposal, so the reasoning behind it is only what the
            PRD captures.
          </p>
        )}
      </Panel>

      {tasks.length > 0 ? (
        <Panel
          title="Plan tasks"
          subtitle={
            props.planSlug
              ? `Live status from plan_tasks — tracked at /admin/plans/${props.planSlug}`
              : "Live status from plan_tasks"
          }
        >
          <ul className="divide-y divide-border/30">
            {tasks.map((t) => (
              <li key={t.taskKey} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium",
                    TASK_STATUS_STYLE[t.status],
                  )}
                >
                  {t.status.replace("_", " ")}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.taskKey}</span>
                <span className="text-sm text-foreground/85">{t.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {t.workstream} · P{t.phase}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
