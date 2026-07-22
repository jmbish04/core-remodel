"use client";

/**
 * @fileoverview Slide deck view of one changelog entry.
 *
 * Same content as the detail page, paced for presenting rather than reading —
 * walking a reviewer or a contractor through a change without asking them to
 * scroll a long document while you talk.
 *
 * Every slide that summarizes a section carries a link back to that section's
 * anchor on the detail page, because a deck necessarily truncates: slides show
 * the first few paragraphs and the reader follows the link for the rest. The
 * truncation is stated on the slide ("+N more paragraphs") rather than silently
 * dropping text, so nobody presents from a deck believing they have seen it all.
 *
 * Hand-rolled rather than pulled from a slide registry: the registry package
 * wanted Next.js and a second syntax highlighter as dependencies, which is a
 * large permanent cost for keyboard navigation and a counter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MermaidCn } from "@/components/mermaidcn/MermaidCn";
import { MarkdownProse } from "@/components/research/MarkdownProse";
import { AutoScaleContainer } from "@/components/ui/auto-scale-container";
import { toMarkdown, type Prose } from "@/lib/markdown-normalize";
import { cn } from "@/lib/utils";

interface DeckDiagram {
  title: string;
  description?: Prose;
  code: string;
}

export interface ChangelogDeckProps {
  entryNo?: number;
  title: string;
  subtitle?: string;
  summary: string;
  date: string;
  branch: string;
  status: "shipped" | "staged";
  prNumber?: number;
  prUrl?: string;
  /** Detail page this deck was generated from — every "read more" points here. */
  detailHref: string;

  introduction?: Prose;
  problem?: Prose;
  approach?: Prose;
  diagrams?: DeckDiagram[];
  apiChanges?: string[];
  migrations?: { tag: string; appliedRemote: boolean }[];
  verification?: { command: string; ranAt?: string } | null;
  changes?: { kind: string; text: string }[];
}

interface Slide {
  key: string;
  /** Section anchor on the detail page, or null for slides with no counterpart. */
  anchor: string | null;
  eyebrow: string;
  heading: string;
  render: () => React.ReactNode;
}

/**
 * Slide body.
 *
 * Nothing is truncated any more. The previous version showed the first three
 * paragraphs and printed "+N more on the detail page", because a fixed font size
 * on a fixed-height slide had no other option. AutoScaleContainer removes the
 * constraint — the full text is rendered and the type shrinks to fit — so the
 * reader is presenting the actual content rather than an excerpt of it.
 */
function SlideBody({ markdown }: { markdown: string }) {
  return (
    <AutoScaleContainer contentKey={markdown} min={12} max={26}>
      <MarkdownProse className="prose-p:mb-5">{markdown}</MarkdownProse>
    </AutoScaleContainer>
  );
}

const KIND_LABEL: Record<string, string> = {
  added: "Features",
  fixed: "Fixes",
  changed: "Improvements",
  removed: "Removed",
  migration: "Migrations",
};

export function ChangelogDeck(props: ChangelogDeckProps) {
  const {
    entryNo,
    title,
    subtitle,
    summary,
    date,
    branch,
    status,
    prNumber,
    prUrl,
    detailHref,
    diagrams = [],
    apiChanges = [],
    migrations = [],
    verification,
    changes = [],
  } = props;

  const introduction = useMemo(() => toMarkdown(props.introduction), [props.introduction]);
  const problem = useMemo(() => toMarkdown(props.problem), [props.problem]);
  const approach = useMemo(() => toMarkdown(props.approach), [props.approach]);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];

    out.push({
      key: "title",
      anchor: null,
      eyebrow: status === "shipped" ? "Shipped" : "Proposed — not yet deployed",
      heading: title,
      render: () => (
        <div className="space-y-6">
          {subtitle ? (
            <p className="text-xl italic text-muted-foreground md:text-2xl">{subtitle}</p>
          ) : null}
          <p className="max-w-3xl text-lg leading-8 text-foreground/80">{summary}</p>
          <div className="flex flex-wrap items-center gap-2 pt-2 font-mono text-xs text-muted-foreground">
            <span className="rounded-md bg-card px-2 py-1 ring-1 ring-border/40">{branch}</span>
            {prNumber ? (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-sky-500/12 px-2 py-1 text-sky-300 ring-1 ring-sky-500/25"
              >
                PR #{prNumber} ↗
              </a>
            ) : null}
            <span>{date}</span>
          </div>
        </div>
      ),
    });

    if (introduction) {
      out.push({
        key: "introduction",
        anchor: "introduction",
        eyebrow: "Introduction",
        heading: "What this is",
        render: () => <SlideBody markdown={introduction} />,
      });
    }

    if (problem) {
      out.push({
        key: "problem",
        anchor: "problem",
        eyebrow: "Problem",
        heading: "Why this had to change",
        render: () => <SlideBody markdown={problem} />,
      });
    }

    if (approach) {
      out.push({
        key: "approach",
        anchor: "approach",
        eyebrow: "Approach",
        heading: "How it was solved",
        render: () => <SlideBody markdown={approach} />,
      });
    }

    diagrams.forEach((d, i) => {
      out.push({
        key: `diagram-${i}`,
        anchor: "diagrams",
        eyebrow: `Diagram ${i + 1} of ${diagrams.length}`,
        heading: d.title,
        render: () => (
          <div className="flex h-full min-h-0 flex-col gap-4">
            {d.description ? (
              <MarkdownProse className="shrink-0 text-sm prose-p:mb-3">
                {d.description}
              </MarkdownProse>
            ) : null}
            <div className="min-h-0 flex-1 rounded-xl bg-card p-4 ring-1 ring-border/40">
              <MermaidCn code={d.code} caption={d.title} />
            </div>
          </div>
        ),
      });
    });

    if (apiChanges.length > 0) {
      out.push({
        key: "api",
        anchor: "api",
        eyebrow: "Developer",
        heading: "API surface",
        render: () => (
          <ul className="space-y-2">
            {apiChanges.slice(0, 8).map((a) => (
              <li key={a} className="font-mono text-base leading-7 text-foreground/85">
                {a}
              </li>
            ))}
            {apiChanges.length > 8 ? (
              <li className="text-sm italic text-muted-foreground">
                + {apiChanges.length - 8} more on the detail page
              </li>
            ) : null}
          </ul>
        ),
      });
    }

    if (changes.length > 0) {
      const buckets = new Map<string, string[]>();
      for (const c of changes) {
        const label = KIND_LABEL[c.kind] ?? c.kind;
        buckets.set(label, [...(buckets.get(label) ?? []), c.text]);
      }
      out.push({
        key: "recap",
        anchor: null,
        eyebrow: "Recap",
        heading: status === "shipped" ? "What this introduced" : "What this will introduce",
        render: () => (
          <div className="grid gap-6 md:grid-cols-2">
            {[...buckets.entries()].map(([label, items]) => (
              <div key={label}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {label}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {items.map((t) => (
                    <li key={t} className="text-sm leading-6 text-foreground/85">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ),
      });
    }

    out.push({
      key: "verification",
      anchor: "verification",
      eyebrow: "Verification",
      heading: verification ? "What was run" : "Nothing was verified",
      render: () =>
        verification ? (
          <div className="space-y-4">
            <code className="inline-block rounded-md bg-emerald-500/10 px-3 py-1.5 font-mono text-base text-emerald-300 ring-1 ring-emerald-500/25">
              {verification.command}
            </code>
            {verification.ranAt ? (
              <p className="text-sm text-muted-foreground">ran {verification.ranAt}</p>
            ) : null}
            {migrations.length > 0 ? (
              <ul className="space-y-1.5 pt-2">
                {migrations.map((m) => (
                  <li key={m.tag} className="flex items-center gap-2 font-mono text-sm">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-medium",
                        m.appliedRemote
                          ? "bg-emerald-500/12 text-emerald-300"
                          : "bg-rose-500/12 text-rose-300",
                      )}
                    >
                      {m.appliedRemote ? "applied to remote" : "NOT applied"}
                    </span>
                    <span className="text-muted-foreground">{m.tag}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="max-w-2xl rounded-xl bg-rose-500/8 px-5 py-4 text-base leading-7 text-rose-200/90 ring-1 ring-rose-500/25">
            No QC run was recorded for this entry. Nothing here has been verified against the
            deployed worker — treat the change as unproven, not as passing.
          </p>
        ),
    });

    return out;
  }, [
    approach,
    apiChanges,
    branch,
    changes,
    date,
    diagrams,
    introduction,
    migrations,
    problem,
    prNumber,
    prUrl,
    status,
    subtitle,
    summary,
    title,
    verification,
  ]);

  const [index, setIndex] = useState(0);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => setIndex((i) => Math.min(last, Math.max(0, typeof next === "number" ? next : i))),
    [last],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore while the reader is typing somewhere — the deck is not modal.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(index + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(last);
          break;
        case "Escape":
          window.location.href = detailHref;
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailHref, go, index, last]);

  // Touch swipe. 60px threshold so a slightly-diagonal scroll on a diagram slide
  // does not fire a slide change.
  const [touchX, setTouchX] = useState<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    setTouchX(e.changedTouches[0]?.clientX ?? null);
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
    if (Math.abs(dx) > 60) go(dx < 0 ? index + 1 : index - 1);
    setTouchX(null);
  }

  const slide = slides[index];
  if (!slide) return null;

  return (
    /*
      `fixed inset-0`, and both halves of that matter.

      FIXED: the deck is a presentation, so it takes the whole viewport instead
      of sitting inside the admin shell. Nested in the shell it inherited a
      ~64px header, pushing its own footer — the arrows and slide dots — below
      the fold on the one view whose entire job is stepping through slides.
      "Back to the full entry" is the way out.

      DEFINITE HEIGHT: AutoScaleContainer measures its own clientHeight. Under an
      auto-height ancestor that measurement is just the content's own height, so
      everything trivially "fits" and nothing ever scales. inset-0 — plus min-h-0
      on every flex child down to the slide body — is what makes the fit mean
      something.
    */
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/*
        shrink-0 so the header and footer keep their height while the slide body
        absorbs whatever is left. They used to be sticky, which was a workaround
        for the root having no definite height — with h-svh above, the column
        bounds itself and the controls are always on screen.
      */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border/40 bg-background/95 px-6 py-3 backdrop-blur">
        <a
          href={detailHref}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          ← Back to the full entry
        </a>
        <span className="font-mono text-xs text-muted-foreground">
          {entryNo ? `#${entryNo} · ` : ""}
          {index + 1} / {slides.length}
        </span>
      </header>

      <section className="mx-auto flex w-full min-h-0 max-w-5xl flex-1 flex-col justify-center px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
          {slide.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
          {index === 0 && entryNo ? (
            <span className="mr-3 font-mono text-2xl font-normal text-muted-foreground md:text-4xl">
              #{entryNo}
            </span>
          ) : null}
          {slide.heading}
        </h1>
        <div className="mt-6 min-h-0 flex-1">{slide.render()}</div>

        {slide.anchor ? (
          <a
            href={`${detailHref}#${slide.anchor}`}
            className="mt-8 inline-flex w-fit items-center gap-1.5 text-sm text-sky-300 underline underline-offset-4 hover:text-sky-200"
          >
            Read the full {slide.eyebrow.toLowerCase()} section →
          </a>
        ) : null}
      </section>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border/40 bg-background/95 px-6 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Previous
        </button>

        <nav aria-label="Slides" className="flex flex-wrap items-center justify-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Slide ${i + 1}: ${s.heading}`}
              aria-current={i === index ? "true" : undefined}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index ? "bg-foreground" : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </nav>

        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === last}
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </footer>
    </div>
  );
}
