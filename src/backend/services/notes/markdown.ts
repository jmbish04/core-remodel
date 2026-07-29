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
  // Strip the sentinel char so input can't forge the link placeholder below.
  let out = escapeHtml(raw.replace(/\uE000/g, ""));

  // Extract links to placeholder tokens FIRST so the bold/italic passes can't
  // inject <strong>/<em> into a URL containing `_`/`*`. The sentinel is wrapped in
  // U+E000 (a private-use codepoint) — which escapeHtml leaves untouched and which
  // we stripped from the input above — so no user-typed text (e.g. "LINK0") can
  // collide with it.
  const links: string[] = [];
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) => {
      links.push(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
      );
      return `\uE000LINK${links.length - 1}\uE000`;
    },
  );

  // Bold before italic so `**x**` isn't consumed by the single-char italic rule.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Zero-width lookarounds so a delimiter can't eat the neighbouring character
  // (the old `(^|[^*])` form broke adjacent emphasis like `*a**b*`).
  out = out.replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/(?<!_)_(?!_)([^_\n]+?)_(?!_)/g, "<em>$1</em>");

  out = out.replace(/\uE000LINK(\d+)\uE000/g, (_m, i: string) => links[Number(i)]);
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
 * Defense-in-depth sanitizer for note HTML that did NOT come from renderNoteHtml
 * — i.e. a caller-supplied / legacy `*_html` blob we cannot round-trip through
 * Markdown. Strips the script/style/iframe/object/embed elements, event-handler
 * attributes, and `javascript:` URIs that a stored-XSS payload needs. This is NOT
 * a general-purpose HTML sanitizer.
 *
 * ponytail: deliberately dependency-free. A full sanitizer (isomorphic-dompurify
 * / sanitize-html) is large and this Worker already fights the 10 MiB script
 * limit, while notes are authored only by the single trusted homeowner. If notes
 * ever accept third-party input, swap this for isomorphic-dompurify.
 */
export function sanitizeNoteHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/((?:href|src)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, '$1$2#$2');
}
