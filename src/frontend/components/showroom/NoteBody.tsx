import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";

/** Compact note look, plus the legacy-HTML prose fallback styling. */
const NOTE_PROSE_CLASS =
  "prose-sm text-sm leading-relaxed prose-p:my-1.5 prose-headings:mt-2 prose-headings:mb-1 prose-ul:pl-5 prose-ol:pl-5";
const LEGACY_HTML_PROSE_CLASS =
  "prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_a]:text-sky-400 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

/**
 * Read-only render of a homeowner note. Markdown is the source of truth, so it is
 * rendered through the one markdown renderer (react-markdown, no rehype-raw) — this
 * also rescues historical rows whose `*Html` column actually holds raw Markdown
 * (the old record_showroom_visit bug). Falls back to the stored HTML only when
 * there is no Markdown source (legacy html-only rows). Returns null when empty.
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
  if (markdown?.trim()) {
    return <MarkdownProse markdown={markdown} className={cn(NOTE_PROSE_CLASS, className)} />;
  }
  if (html?.trim()) {
    return (
      <div
        className={cn(LEGACY_HTML_PROSE_CLASS, className)}
        // Legacy row with only HTML (no Markdown source). Single trusted author.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return null;
}
