/**
 * @fileoverview Make dense AI-generated markdown break into real paragraphs.
 *
 * Models return prose with SINGLE newlines between what are plainly separate
 * paragraphs. Markdown treats a single newline as a soft wrap, so the whole
 * thing renders as one unbroken wall of text.
 *
 * The obvious fix is `text.replace(/(?<!\n)\n(?!\n)/g, "\n\n")`. Do not use it.
 * It is correct for pure prose and destructive for everything else in the same
 * document:
 *
 *   - **GFM tables break outright.** A table's header, delimiter and body rows
 *     must be contiguous. Insert a blank line and it stops being a table and
 *     becomes three paragraphs of pipe characters.
 *   - **Fenced code and mermaid diagrams get blank lines injected** between every
 *     line of source.
 *   - **Tight lists become loose lists** — each item gains a wrapping `<p>` and
 *     the spacing doubles.
 *
 * Our planning artifacts are full of all three (the AGENTS.md rule requires
 * diagram-dense PRDs), so a blind replace would wreck the exact pages this is
 * meant to improve.
 *
 * So the rule is applied structurally: a blank line is inserted between two
 * lines only when BOTH are ordinary prose. Anything that participates in a block
 * construct — list item, table row, heading, blockquote, fence, indented code,
 * HTML, thematic break, link reference — is left exactly as written.
 */

/** Opening or closing fence: ``` or ~~~, optionally indented, with an info string. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Lines that participate in a block construct and must keep their neighbours.
 * Order is irrelevant; any match protects the line.
 */
const STRUCTURAL: RegExp[] = [
  /^\s{0,3}([-*+]|\d{1,9}[.)])\s/, // list item
  /^\s{0,3}\|/, //                    table row
  /^\s{0,3}:?-{2,}:?(\s*\|)/, //      table delimiter without a leading pipe
  /^\s{0,3}#{1,6}\s/, //              ATX heading
  /^\s{0,3}>/, //                     blockquote
  /^(\s{4,}|\t)/, //                  indented code block
  /^\s{0,3}</, //                     raw HTML
  /^\s{0,3}([-*_])\s*(\1\s*){2,}$/, // thematic break
  /^\s{0,3}(=+|-+)\s*$/, //           setext heading underline
  /^\s{0,3}\[[^\]]+\]:/, //           link reference / footnote definition
];

/**
 * Lines that must stay glued to the line ABOVE them. Breaking here does not just
 * change spacing, it changes what the block IS:
 *
 *   - a setext underline turns its heading into a paragraph plus a rule;
 *   - a table delimiter row detached from its header stops being a table, which
 *     matters for pipe-less tables (`Construct | What` on the header line does
 *     not start with `|`, so the header itself does not read as structural).
 */
const NEVER_BREAK_BEFORE: RegExp[] = [
  /^\s{0,3}(=+|-+)\s*$/, //          setext underline
  /^\s{0,3}:?-{2,}:?(\s*\|)/, //     table delimiter without a leading pipe
  /^\s{0,3}\|[\s:|-]+\|?\s*$/, //   table delimiter with pipes
];

function isStructural(line: string): boolean {
  return STRUCTURAL.some((re) => re.test(line));
}

function neverBreakBefore(line: string): boolean {
  return NEVER_BREAK_BEFORE.some((re) => re.test(line));
}

/** A line ending in two spaces or a backslash is an explicit `<br>`; respect it. */
function hasHardBreak(line: string): boolean {
  return /( {2,}|\\)$/.test(line);
}

/**
 * Expand single newlines between prose lines into paragraph breaks.
 *
 * @param markdown Raw markdown, typically straight from a model.
 * @returns The same markdown with prose paragraphs separated by blank lines and
 *          every block construct byte-identical to the input.
 */
export function normalizeMarkdown(markdown: string): string {
  // Defensive, not decorative. This is the boundary where a caller can hand us
  // something that is not a string: Astro passes a component's slotted children
  // to React as a rendered SLOT OBJECT, not as raw text, so `<X>{str}</X>` in an
  // .astro file arrives here as an object and `.replace` explodes — taking the
  // whole streamed page down from that point on. Callers pass `markdown` as a
  // prop for that reason, and this guard makes the remaining paths non-fatal.
  if (typeof markdown !== "string" || !markdown) return "";

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    // Inside a fence nothing is touched — not the content, not the closing line.
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const next = lines[i + 1];
    if (next === undefined) continue;

    // Only ever act on two adjacent NON-blank lines — a blank line already is
    // the paragraph break we would be adding.
    if (line.trim() === "" || next.trim() === "") continue;
    if (hasHardBreak(line)) continue;
    if (neverBreakBefore(next)) continue;

    const curStructural = isStructural(line);
    const nextStructural = isStructural(next);

    // Two structural lines in a row are one block — a table's rows, a list's
    // items. Keep them contiguous.
    if (curStructural && nextStructural) continue;

    // An indented line after a structural one is that block's lazy
    // continuation ("- item" / "  more of the same item"), not a new paragraph.
    if (curStructural && /^\s+\S/.test(next)) continue;

    // Everything else gets the break — including a structural line followed by
    // prose, which is what ENDS a table or a list. Skipping that case is how the
    // paragraph after a table ended up rendered inside it.
    out.push("");
  }

  return out.join("\n");
}

/**
 * Coerce a long-form field to a markdown string.
 *
 * Entries written between 2026-07-22 and this change stored these fields as an
 * array of paragraphs. That shape is gone from the authoring contract, but the
 * rows are in D1 and must keep rendering — so an array is joined into the
 * markdown it was standing in for rather than being special-cased downstream.
 */
export function toMarkdown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  // Anything else (a React node, a slot object) is not markdown and must not be
  // stringified into "[object Object]" on the page.
  return "";
}

/** First paragraph only — for summaries and meta tags. */
export function markdownLede(value: unknown): string {
  const first = toMarkdown(value).split(/\n\s*\n/)[0] ?? "";
  return first.trim();
}

/**
 * A long-form field.
 *
 * `string` is the contract: markdown, exactly as a model or an author wrote it.
 * `string[]` is tolerated only for rows written during the brief window when
 * these fields were stored as one element per paragraph — `toMarkdown` folds
 * those back into markdown. Do not author new content as an array.
 */
export type Prose = string | string[];
