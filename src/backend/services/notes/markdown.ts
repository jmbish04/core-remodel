/**
 * Server-side Markdown → sanitized HTML for homeowner-authored notes.
 *
 * This is the SINGLE source of truth for turning a note's Markdown into the HTML
 * we cache in `*_html` columns. It is a deliberate port of the frontend
 * `OverviewNoteEditor.markdownToHtml` (same small subset: h1–h3, ordered/unordered
 * lists, bold/italic, links, paragraphs) so what an MCP/REST caller writes matches
 * what the PlateJS editor would have produced — and so the render is identical
 * whichever surface authored it.
 *
 * SECURITY: every text run is HTML-escaped BEFORE inline marks are applied, and
 * only this fixed tag vocabulary is ever emitted. Raw `<script>`, event-handler
 * attributes, and arbitrary tags in the input therefore survive only as escaped
 * text, never as live markup — there is no `rehype-raw`-style passthrough. Callers
 * must derive HTML from Markdown with this function rather than trusting a
 * caller-supplied HTML blob.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline marks: bold (`**x**`/`__x__`), italic (`*x*`/`_x_`), links. */
function renderInline(raw: string): string {
  let out = escapeHtml(raw);

  // Extract links to placeholder tokens FIRST so the bold/italic passes can't
  // inject <strong>/<em> into a URL containing `_`/`*`. Restored after.
  const links: string[] = [];
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) => {
      links.push(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
      );
      return `LINKZZ${links.length - 1}`;
    },
  );

  // Bold before italic so `**x**` isn't consumed by the single-char italic rule.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");

  out = out.replace(/LINKZZ(\d+)/g, (_m, i: string) => links[Number(i)]);
  return out;
}

/**
 * Convert note Markdown into the sanitized HTML subset. Returns "" for empty
 * input. Never throws on odd input — unrecognized lines fall through as escaped
 * paragraphs.
 */
export function renderNoteHtml(markdown: string | null | undefined): string {
  if (!markdown) return "";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length) {
      blocks.push(`<${listType}>${listItems.join("")}</${listType}>`);
    }
    listType = null;
    listItems.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ordered) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    flushList();
    blocks.push(`<p>${renderInline(trimmed)}</p>`);
  }
  flushList();

  return blocks.join("\n");
}

/**
 * Normalize a note write into the {markdown, html} pair we persist.
 *
 * Markdown is the source of truth: when present, HTML is ALWAYS derived from it
 * (any caller-supplied HTML is ignored — that is the anti-bypass guarantee). When
 * only legacy HTML is supplied with no Markdown, it is passed through unchanged so
 * we don't destroy pre-existing content we can't round-trip.
 */
export function normalizeNoteContent(input: {
  markdown?: string | null;
  html?: string | null;
}): { markdown: string | null; html: string | null } {
  const markdown = input.markdown?.trim() ? input.markdown : null;
  if (markdown) return { markdown, html: renderNoteHtml(markdown) };
  const html = input.html?.trim() ? input.html : null;
  return { markdown: null, html };
}
