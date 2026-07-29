import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";

/** Compact note look, plus the legacy-HTML prose fallback styling. */
const NOTE_PROSE_CLASS =
  "prose-sm text-sm leading-relaxed prose-p:my-1.5 prose-headings:mt-2 prose-headings:mb-1 prose-ul:pl-5 prose-ol:pl-5";
const LEGACY_HTML_PROSE_CLASS =
  "prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_a]:text-sky-400 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

/** True when the string carries no HTML element — i.e. it is really Markdown. */
function looksLikeMarkdownNotHtml(s: string): boolean {
  return !/<[a-z!/][^>]*>/i.test(s);
}

/**
 * Client-side defense-in-depth strip for a legacy `*Html` blob before we inject
 * it. Mirrors the backend `sanitizeNoteHtml`: removes script/style/iframe/object/
 * embed, event-handler attributes, and `javascript:` URIs. Dependency-free on
 * purpose (single trusted author; the backend now sanitizes on write too).
 */
function stripDangerousHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/((?:href|src)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, '$1$2#$2');
}

/**
 * Read-only render of a homeowner note. Markdown is the source of truth, so it is
 * rendered through the one markdown renderer (react-markdown, no rehype-raw) — this
 * also rescues historical rows whose `*Html` column actually holds raw Markdown
 * (the old record_showroom_visit bug). Returns null when both are empty.
 *
 * Fallback for legacy html-only rows: if that HTML is actually raw Markdown it is
 * promoted to the safe Markdown renderer; genuine HTML is passed through a
 * client-side strip before injection (belt-and-suspenders on top of the backend
 * sanitizer, which older stored rows predate).
 */
export function NoteBody({
  markdown,
  html,
  className,
}: {
  markdown?: string | null;
  html?: string | null;
  className?: string;
}) {
  const md = markdown?.trim();
  if (md) {
    return <MarkdownProse markdown={md} className={cn(NOTE_PROSE_CLASS, className)} />;
  }
  const legacy = html?.trim();
  if (legacy) {
    // A legacy row whose "html" is really Markdown → render it safely, not as HTML.
    if (looksLikeMarkdownNotHtml(legacy)) {
      return <MarkdownProse markdown={legacy} className={cn(NOTE_PROSE_CLASS, className)} />;
    }
    return (
      <div
        className={cn(LEGACY_HTML_PROSE_CLASS, className)}
        // Sanitized legacy HTML (single trusted author; backend also strips on write).
        dangerouslySetInnerHTML={{ __html: stripDangerousHtml(legacy) }}
      />
    );
  }
  return null;
}
