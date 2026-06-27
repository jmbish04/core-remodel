/**
 * @fileoverview MermaidDiagram — a client-only React island that renders a
 * Mermaid diagram string into inline SVG.
 *
 * The docs site is otherwise data-driven and SSR; Mermaid needs a browser DOM,
 * so this component is mounted with `client:only="react"` and dynamically
 * imports `mermaid` inside an effect (keeping it out of the SSR/main bundle —
 * it only loads on docs pages that actually carry diagrams).
 *
 * Theme is tuned to the dark Monolith palette. `securityLevel: "loose"` is used
 * deliberately: every diagram source is authored in-repo (src/frontend/lib/docs.ts),
 * never user-supplied, so HTML labels are safe and render cleanly.
 *
 * Inputs:  code (Mermaid source), caption (optional figure caption).
 * Output:  rendered SVG inside a ring-bordered, horizontally-scrollable card.
 */

import { useEffect, useId, useRef, useState } from "react";

interface MermaidDiagramProps {
  /** Mermaid diagram source (flowchart, sequenceDiagram, erDiagram, etc.). */
  code: string;
  /** Optional caption rendered beneath the diagram. */
  caption?: string;
}

/** One-time global init guard — mermaid.initialize must run once per page. */
let initialized = false;

export function MermaidDiagram({ code, caption }: MermaidDiagramProps) {
  const reactId = useId();
  // Mermaid render ids must be valid CSS selectors — strip React's colons.
  const renderId = `mmd-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!initialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "loose",
            theme: "dark",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            themeVariables: {
              // Monolith-flavoured dark palette.
              background: "transparent",
              primaryColor: "#1c1c20",
              primaryBorderColor: "#3f3f46",
              primaryTextColor: "#fafafa",
              lineColor: "#71717a",
              secondaryColor: "#26262b",
              tertiaryColor: "#18181b",
              fontSize: "14px",
            },
          });
          initialized = true;
        }

        // `mermaid.parse` throws a readable error for malformed sources.
        await mermaid.parse(code);
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  return (
    <figure className="my-2 space-y-2">
      <div className="overflow-x-auto rounded-xl bg-card/40 p-4 ring-1 ring-border/40">
        {error ? (
          <pre className="whitespace-pre-wrap text-xs text-rose-400">
            Diagram error: {error}
          </pre>
        ) : svg ? (
          // Rendered SVG is produced by mermaid from trusted in-repo source.
          <div
            ref={containerRef}
            className="mermaid-svg flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, in-repo diagram source
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">Rendering diagram…</div>
        )}
      </div>
      {caption ? (
        <figcaption className="text-center text-xs font-light text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
