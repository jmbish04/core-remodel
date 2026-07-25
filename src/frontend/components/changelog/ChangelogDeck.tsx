"use client";

/**
 * @fileoverview Slide deck view of one changelog entry, on reveal.js.
 *
 * Same content as the detail page, paced for presenting rather than reading —
 * walking a reviewer or a contractor through a change without asking them to
 * scroll a long document while you talk.
 *
 * Built from the slidecn registry (`TitleSlide`, `SectionSlide`, `ContentSlide`,
 * `ListSlide`, `SplitSlide`) over `@revealjs/react`. That replaces a hand-rolled
 * deck and, with it, hand-rolled keyboard navigation, touch swiping, the slide
 * counter, the overview grid, fullscreen and speaker notes — reveal.js ships all
 * of that and does it better than a bespoke implementation will.
 *
 * Two things reveal does NOT do, which is why the pieces below survive:
 *
 *   - Reveal scales a slide UNIFORMLY from a fixed design size. It does not
 *     shrink text to fit a variable amount of content, so a nine-paragraph
 *     problem statement still overflows its slide. `AutoScaleContainer` is what
 *     handles that.
 *   - Every content slide links back to its section anchor on the detail page,
 *     because a deck is a summary and the reader needs the way back.
 */

import { Deck, useReveal } from "@revealjs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MermaidCn } from "@/components/mermaidcn/MermaidCn";
import { MarkdownProse } from "@/components/research/MarkdownProse";
import { ContentSlide } from "@/components/slides/content-slide";
import { ListSlide } from "@/components/slides/list-slide";
import { SectionSlide } from "@/components/slides/section-slide";
import { SplitSlide } from "@/components/slides/split-slide";
import { TitleSlide } from "@/components/slides/title-slide";
import { AutoScaleContainer } from "@/components/ui/auto-scale-container";
import { toMarkdown, type Prose } from "@/lib/markdown-normalize";

import "reveal.js/reveal.css";
import "@/components/slides/themes/theme-dark.css";

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

const KIND_LABEL: Record<string, string> = {
  added: "Features",
  fixed: "Fixes",
  changed: "Improvements",
  removed: "Removed",
  migration: "Migrations",
};

/**
 * Markdown body that shrinks to fit the slide.
 *
 * Nothing is truncated. An earlier version showed the first three paragraphs and
 * printed "+N more on the detail page", because a fixed font size on a
 * fixed-height slide had no other option. The scaler removes the constraint, so
 * the presenter is showing the actual content rather than an excerpt of it.
 */
function SlideBody({ markdown, anchorHref }: { markdown: string; anchorHref?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col text-left">
      <AutoScaleContainer contentKey={markdown} min={12} max={24} className="flex-1">
        <MarkdownProse className="prose-p:mb-5" markdown={markdown} />
      </AutoScaleContainer>
      {anchorHref ? (
        <a
          href={anchorHref}
          className="mt-3 shrink-0 self-start text-sm text-sky-400 underline underline-offset-4"
        >
          Read the full section →
        </a>
      ) : null}
    </div>
  );
}

/**
 * Render children only once their slide is actually on screen.
 *
 * Reveal keeps every slide in the DOM and hides the inactive ones, so anything
 * that MEASURES itself at mount measures zero. Mermaid does exactly that, and
 * its failure is not a blank diagram but a rendered error on the slide:
 *
 *   Syntax Error — Could not find a suitable point for the given distance
 *
 * which reads as a problem with the diagram source and is not one. Deferring the
 * mount until the slide is present gives mermaid a laid-out box to measure.
 *
 * Once shown, it stays mounted: re-rendering a diagram every time the presenter
 * steps back through it is wasted work and visibly re-flashes the SVG.
 */
function WhenSlideActive({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hasBeenActive, setHasBeenActive] = useState(false);
  const deck = useReveal();

  useEffect(() => {
    if (!deck || hasBeenActive) return;

    const update = () => {
      const section = ref.current?.closest("section");
      if (section?.classList.contains("present")) setHasBeenActive(true);
    };

    update();
    deck.on("slidechanged", update);
    deck.on("ready", update);
    return () => {
      deck.off("slidechanged", update);
      deck.off("ready", update);
    };
  }, [deck, hasBeenActive]);

  return (
    <div ref={ref} className="h-full min-h-0">
      {hasBeenActive ? children : null}
    </div>
  );
}

function RecapColumns({ entries }: { entries: [string, string[]][] }) {
  return (
    <div className="space-y-5 text-left">
      {entries.map(([label, items]) => (
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
  );
}

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

  const recapColumns = useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const c of changes) {
      const label = KIND_LABEL[c.kind] ?? c.kind;
      buckets.set(label, [...(buckets.get(label) ?? []), c.text]);
    }
    return [...buckets.entries()];
  }, [changes]);

  const half = Math.ceil(recapColumns.length / 2);

  return (
    /*
      `text-foreground` is load-bearing, not decoration. Importing reveal.css
      brings a reset that sets the document's inherited color to black, and the
      slidecn slide components carry no color class of their own — their headings
      INHERIT. Without this the title renders black-on-black and only the
      elements with an explicit `text-muted-foreground` survive. Setting it once
      on the deck root fixes the entire subtree.
    */
    <div className="fixed inset-0 z-50 bg-background text-foreground">
      {/*
        The way out, layered above reveal rather than inside it. Reveal owns the
        whole viewport once it initializes and its chrome has no concept of "back
        to the page this came from" — a presentation with no exit is a trap.
      */}
      <a
        href={detailHref}
        className="absolute top-3 left-4 z-[60] rounded-md bg-background/80 px-2.5 py-1 text-xs text-muted-foreground underline underline-offset-4 backdrop-blur transition-colors hover:text-foreground"
      >
        ← Back to the full entry
      </a>

      <Deck
        className="h-full w-full"
        config={{
          // A 16:9 design surface. Reveal scales it uniformly to whatever the
          // window is, so the deck looks the same on a laptop and a projector.
          width: 1280,
          height: 720,
          margin: 0.06,
          controls: true,
          progress: true,
          slideNumber: "c/t",
          // No URL hash: this is an admin route, and rewriting the address bar
          // on every arrow press makes the browser Back button useless for
          // getting out of the deck.
          hash: false,
          // Not embedded, so reveal binds the arrow keys document-wide — a
          // presenter should not have to click the slide first.
          embedded: false,
          transition: "slide",
          transitionSpeed: "fast",
        }}
      >
        <TitleSlide
          eyebrow={status === "shipped" ? "Shipped" : "Proposed — not yet deployed"}
          title={entryNo ? `#${entryNo} · ${title}` : title}
          subtitle={subtitle ?? summary}
          author={branch}
          date={prNumber ? `PR #${prNumber} · ${date}` : date}
        />

        {introduction ? (
          <ContentSlide title="What this is">
            <SlideBody markdown={introduction} anchorHref={`${detailHref}#introduction`} />
          </ContentSlide>
        ) : null}

        {problem ? (
          <>
            <SectionSlide label="Problem" title="Why this had to change" />
            <ContentSlide>
              <SlideBody markdown={problem} anchorHref={`${detailHref}#problem`} />
            </ContentSlide>
          </>
        ) : null}

        {approach ? (
          <>
            <SectionSlide label="Approach" title="How it was solved" variant="accent" />
            <ContentSlide>
              <SlideBody markdown={approach} anchorHref={`${detailHref}#approach`} />
            </ContentSlide>
          </>
        ) : null}

        {diagrams.map((d, i) => (
          <ContentSlide key={`diagram-${i}`} title={d.title}>
            <div className="flex h-full flex-col gap-3 text-left">
              {d.description ? (
                <MarkdownProse className="shrink-0 text-sm prose-p:mb-2" markdown={d.description} />
              ) : null}
              {/*
                An EXPLICIT height, not `flex-1`. Dagre lays a flowchart out
                against the box it is given; in a content-sized flex column that
                box resolves to zero height, so every node lands on the same
                coordinate and the edges between them have zero length. Mermaid
                then throws while positioning an edge LABEL:

                  Could not find a suitable point for the given distance

                which renders on the slide as a syntax error and reads as a
                problem with the diagram source. It is not — the same diagram
                renders correctly on the detail page, where the container has a
                natural height.
              */}
              <div className="h-[430px] w-full overflow-auto">
                <WhenSlideActive>
                  <MermaidCn code={d.code} caption={d.title} />
                </WhenSlideActive>
              </div>
            </div>
          </ContentSlide>
        ))}

        {apiChanges.length > 0 ? (
          <ListSlide title="API surface" items={apiChanges.map((a) => ({ text: a }))} animated />
        ) : null}

        {recapColumns.length > 0 ? (
          <SplitSlide
            title={status === "shipped" ? "What this introduced" : "What this will introduce"}
            divider
            left={<RecapColumns entries={recapColumns.slice(0, half)} />}
            right={<RecapColumns entries={recapColumns.slice(half)} />}
          />
        ) : null}

        <ContentSlide title={verification ? "Verification" : "Nothing was verified"}>
          {verification ? (
            <div className="space-y-4 text-left">
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
                        className={
                          m.appliedRemote
                            ? "rounded-md bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
                            : "rounded-md bg-rose-500/12 px-2 py-0.5 text-[10px] font-medium text-rose-300"
                        }
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
            <p className="mx-auto max-w-2xl rounded-xl bg-rose-500/8 px-5 py-4 text-base leading-7 text-rose-200/90 ring-1 ring-rose-500/25">
              No QC run was recorded for this entry. Nothing here has been verified against the
              deployed worker — treat the change as unproven, not as passing.
            </p>
          )}
        </ContentSlide>
      </Deck>
    </div>
  );
}
