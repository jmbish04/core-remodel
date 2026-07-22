/**
 * @fileoverview The one markdown renderer for AI-generated text.
 *
 * Every long-form surface goes through here — research reports, brand and
 * product intel, MCP conversations, the changelog detail page, the proposal
 * bundle and the slide decks — so a change to reading comfort lands everywhere
 * at once instead of drifting per page.
 *
 * Layout comes from `@tailwindcss/typography` (`prose`), registered in
 * global.css via `@plugin` because Tailwind v4 has no JS config file. The old
 * version of this component hand-mapped every element precisely because that
 * plugin was missing; the hand-mapping is gone and only three deliberate
 * overrides remain:
 *
 *   1. **Paragraph rhythm** — `prose-p:mb-6`. The plugin's default leading is
 *      tuned for articles; model output is denser and needs more air between
 *      blocks to stay scannable.
 *   2. **Inline code as a badge** — the plugin wraps inline code in literal
 *      backticks via `::before`/`::after`. Those are stripped and replaced with
 *      a bordered chip, so `someFunction()` reads as a token rather than as
 *      punctuation someone forgot to remove.
 *   3. **Mermaid fences render as diagrams**, not as their source (see `pre`).
 *
 * Input is normalized first — see `lib/markdown-normalize.ts` for why a blind
 * single-newline replace is not safe here.
 *
 * Safety: react-markdown does not evaluate raw HTML unless `rehype-raw` is
 * added, and it is deliberately not. Markdown from a model is untrusted input;
 * it renders as text, never as markup.
 */

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidCn } from "@/components/mermaidcn/MermaidCn";
import { normalizeMarkdown, toMarkdown } from "@/lib/markdown-normalize";
import { cn } from "@/lib/utils";

/** Flatten a react-markdown children tree to its raw text (for code fences). */
function nodeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return nodeText((children as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

const components: Components = {
  code: ({ className, children }) => {
    // A fenced block's <code> carries `language-*` and is styled by its <pre>;
    // only INLINE code gets the badge treatment.
    if (className?.includes("language-")) {
      return <code className={cn("font-mono", className)}>{children}</code>;
    }
    return (
      <code className="rounded border border-zinc-700/50 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[0.85em] font-normal text-foreground/90 before:content-none after:content-none">
        {children}
      </code>
    );
  },
  pre: ({ children }) => {
    // A fenced ```mermaid block arrives as <pre><code class="language-mermaid">…</code></pre>.
    // Render it as an actual diagram (MermaidCn — the same renderer the changelog
    // detail page uses) instead of raw source. Both mermaid components
    // dynamic-import `mermaid`, so this stays SSR-safe; the diagram paints on the
    // client wherever MarkdownProse is hydrated.
    const child = Array.isArray(children) ? children[0] : children;
    const className =
      child && typeof child === "object" && "props" in child
        ? ((child as { props?: { className?: string } }).props?.className ?? "")
        : "";
    if (typeof className === "string" && className.includes("language-mermaid")) {
      const code = nodeText((child as { props?: { children?: unknown } }).props?.children).replace(
        /\n$/,
        "",
      );
      return <MermaidCn code={code} />;
    }
    return (
      <pre className="overflow-x-auto rounded-lg bg-muted/40 p-4 ring-1 ring-border/40">
        {children}
      </pre>
    );
  },
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wrapped so a wide table scrolls inside its own box rather than forcing the
  // page — or a slide — to scroll sideways.
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-lg ring-1 ring-border/40">
      <table className="my-0 w-full">{children}</table>
    </div>
  ),
};

export interface MarkdownProseProps {
  /**
   * Markdown source. PREFER THIS over `children`, and it is the only form that
   * works from an `.astro` file: Astro hands a component's slotted children to
   * React as a rendered slot object rather than as text, so `<MarkdownProse>{md}
   * </MarkdownProse>` in Astro delivers an object, not the string.
   */
  markdown?: string | string[];
  /** Equivalent to `markdown`, for the React call sites that already read well. */
  children?: string | string[];
  className?: string;
  /**
   * Skip newline normalization. For markdown authored by hand, where the single
   * newlines are soft wraps the author actually meant.
   */
  raw?: boolean;
}

export function MarkdownProse({ markdown, children, className, raw = false }: MarkdownProseProps) {
  const source = useMemo(() => {
    const text = toMarkdown(markdown ?? children);
    return raw ? text : normalizeMarkdown(text);
  }, [markdown, children, raw]);

  return (
    <div
      className={cn(
        "prose prose-zinc max-w-none dark:prose-invert",
        // Rhythm and weight overrides — see the file header.
        "prose-p:mb-6 prose-p:leading-7 prose-li:my-1 prose-headings:tracking-tight",
        "prose-pre:bg-transparent prose-pre:p-0 prose-pre:ring-0",
        "prose-a:text-sky-400 prose-a:font-medium prose-a:no-underline hover:prose-a:underline",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
