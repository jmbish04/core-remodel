"use client";

/**
 * @fileoverview Syntax-highlighted code block for the changelog viewport.
 *
 * Highlighting runs in the BROWSER, not in the Worker. Shiki's highlighter is
 * heavy and its default engine wants WASM; running it per-request inside the
 * SSR handler would put that cost on every page render for a low-traffic admin
 * page. Client-side it loads once, lazily, and only on pages that actually show
 * code.
 *
 * Two consequences of that choice, both handled deliberately:
 *   - The plain `<pre>` renders immediately and is replaced by the highlighted
 *     markup when the highlighter resolves. That is a progressive upgrade, not a
 *     flash of empty content — the code is readable the whole time.
 *   - Imports are FINE-GRAINED (`shiki/core` + one file per language and theme)
 *     rather than `import { codeToHtml } from "shiki"`, which pulls every
 *     grammar and every theme — several megabytes — into the client bundle.
 *
 * The JavaScript regex engine is used instead of Oniguruma so there is no WASM
 * payload at all. It handles every grammar registered below; a grammar it could
 * not compile would throw at `createHighlighterCore`, which is why the failure
 * path leaves the plain `<pre>` in place rather than rendering nothing.
 */

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Languages the changelog actually stores — see `CodeCard["lang"]` plus SQL migrations. */
export type CodeLang = "ts" | "tsx" | "sql" | "json" | "bash" | "css" | "markdown" | "diff";

type Highlighter = {
  codeToHtml: (code: string, options: Record<string, unknown>) => string;
};

/**
 * One highlighter for the whole page, created on first use.
 *
 * Held as a promise rather than a resolved value so that N code blocks mounting
 * in the same tick share a single initialization instead of racing to build N
 * highlighters.
 */
let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
      ]);
      return (await createHighlighterCore({
        themes: [
          import("shiki/themes/github-light.mjs"),
          import("shiki/themes/github-dark.mjs"),
        ],
        langs: [
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/sql.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/diff.mjs"),
        ],
        engine: createJavaScriptRegexEngine(),
      })) as unknown as Highlighter;
    })().catch((err) => {
      // Reset so a transient chunk-load failure can be retried by the next mount
      // instead of poisoning every code block on the page for good.
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

/** Our short lang keys → the grammar ids shiki registers them under. */
const GRAMMAR: Record<CodeLang, string> = {
  ts: "typescript",
  tsx: "tsx",
  sql: "sql",
  json: "json",
  bash: "bash",
  css: "css",
  markdown: "markdown",
  diff: "diff",
};

const LANG_LABEL: Record<CodeLang, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  sql: "SQL",
  json: "JSON",
  bash: "Shell",
  css: "CSS",
  markdown: "Markdown",
  diff: "Diff",
};

export interface CodeHighlightProps {
  code: string;
  lang?: CodeLang;
  /** Shown in the header strip — a filename, a migration tag, a card title. */
  filename?: string;
  /** Cap the height and scroll. Omit for short blocks that should show in full. */
  maxHeightClass?: string;
  className?: string;
}

export function CodeHighlight({
  code,
  lang = "ts",
  filename,
  maxHeightClass = "max-h-[32rem]",
  className,
}: CodeHighlightProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((hl) =>
        hl.codeToHtml(code, {
          lang: GRAMMAR[lang] ?? "typescript",
          themes: { light: "github-light", dark: "github-dark" },
          // No inline `color:` on the root — the CSS in global.css switches the
          // token colors off `--shiki-dark`, so the block follows the app theme
          // rather than baking one in.
          defaultColor: false,
        }),
      )
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // Leave the plain <pre>. An unhighlighted block is completely readable;
        // an error message in its place is not.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // Clearing on unmount matters because the copy button can be clicked and the
  // page navigated away from inside the 2s window.
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and blocked in some embedded contexts.
      // The code is selectable either way, so a failure is not worth a toast.
    }
  }

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl bg-card ring-1 ring-border/40",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-2 bg-muted/30 px-4 py-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {filename ?? LANG_LABEL[lang]}
        </span>
        <div className="flex items-center gap-2">
          {filename ? (
            <span className="shrink-0 rounded-md bg-background/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {LANG_LABEL[lang]}
            </span>
          ) : null}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-400" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
      </figcaption>

      {html ? (
        <div
          className={cn(
            "overflow-auto px-4 py-3 text-xs leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0",
            maxHeightClass,
          )}
          // Shiki output only — the input is our own changelog content, and the
          // highlighter emits <pre>/<code>/<span> with style attributes, never
          // script or event handlers.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={cn("overflow-auto px-4 py-3 text-xs leading-relaxed", maxHeightClass)}>
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}
