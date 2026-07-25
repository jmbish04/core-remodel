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

  return reflowParagraphs(out.join("\n"));
}

/**
 * Second pass: break up any block that is still one unbroken wall of prose.
 *
 * Runs on the OUTPUT of the line pass, so by here every block construct is
 * already separated by blank lines and can be identified and skipped whole. A
 * block is reflowed only when every one of its lines is ordinary prose — a
 * table, list, quote or fence is passed through untouched.
 */
function reflowParagraphs(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  let inFence = false;

  return blocks
    .map((block) => {
      // Track fences across blocks: a fenced region can contain blank lines,
      // which means it can be split across several "blocks" here.
      const fenceTicks = (block.match(/^\s{0,3}(`{3,}|~{3,})/gm) ?? []).length;
      const wasInFence = inFence;
      if (fenceTicks % 2 === 1) inFence = !inFence;
      if (wasInFence || inFence || fenceTicks > 0) return block;

      const lines = block.split("\n");
      if (lines.some((l) => isStructural(l))) return block;

      // Join soft-wrapped lines before measuring: a blob that arrived
      // hard-wrapped at 80 columns is still a blob.
      return reflowBlob(lines.map((l) => l.trim()).join(" "));
    })
    .join("\n\n");
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

// ── Paragraph inference for text blobs ──────────────────────────────────────

/**
 * Sentence-final punctuation followed by the start of a new sentence.
 *
 * Abbreviations, decimals and ellipses are handled by the scanner rather than
 * by lookarounds, because the ones that matter here (`e.g.`, `i.e.`, `vs.`,
 * `No.`, version numbers, `0.5`) all break naive regex splitting.
 */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "vs", "etc", "cf", "no", "fig", "approx", "al", "inc", "ltd",
  "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vol", "ch", "pp",
]);

/**
 * Openers that reliably start a NEW thought rather than continue one.
 *
 * Kept deliberately short and high-confidence. Words like "When" or "Because"
 * are omitted on purpose — they introduce subordinate clauses mid-argument at
 * least as often as they start a paragraph, and a wrong break reads worse than
 * a missing one.
 */
const PARAGRAPH_OPENERS = [
  "So ", "But ", "Then ", "Worse", "Instead", "Now ", "Also ", "Second", "Third",
  "Finally", "However", "Meanwhile", "In practice", "In its place", "That is why",
  "The result", "The fix", "The problem", "The point", "Crucially", "Critically",
  "Rather than", "Conversely", "Additionally", "Separately", "Note that",
  "There was", "There is", "This is why", "Which is", "Neither", "Both ",
];

/** Roughly a comfortable paragraph. Past this, break at the next sentence. */
const TARGET_PARAGRAPH_CHARS = 320;
/** Never reflow anything shorter than this — it is already a paragraph. */
const MIN_BLOB_CHARS = 420;
/** Fewer sentences than this and there is nothing to group. */
const MIN_BLOB_SENTENCES = 4;

/**
 * Split prose into sentences, respecting inline code and parentheses.
 *
 * A `.` inside `` `foo.bar()` `` or inside a parenthetical is not a sentence
 * boundary, and splitting there produces fragments that read as errors.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inCode = false;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "`") inCode = !inCode;
    if (inCode) continue;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (ch !== "." && ch !== "?" && ch !== "!") continue;

    // "…" and "?!" — consume the whole run before deciding.
    let end = i;
    while (end + 1 < text.length && ".?!".includes(text[end + 1])) end++;

    const next = text.slice(end + 1);
    // A boundary needs whitespace then something that can open a sentence.
    const boundary = /^\s+["'`(\[]?[A-Z0-9]/.test(next);
    if (!boundary) { i = end; continue; }

    // Abbreviation or an initial? Then the period is not terminal.
    const word = text.slice(start, i).split(/[\s(]/).pop()?.toLowerCase() ?? "";
    if (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word)) { i = end; continue; }
    // A decimal like "0.5" — digit on both sides.
    if (/\d$/.test(text.slice(0, i)) && /^\d/.test(text.slice(end + 1))) { i = end; continue; }

    out.push(text.slice(start, end + 1).trim());
    start = end + 1;
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/**
 * Turn one long unbroken paragraph into several.
 *
 * This is a HEURISTIC, and it is opt-in by length: only a blob past
 * `MIN_BLOB_CHARS` with at least `MIN_BLOB_SENTENCES` sentences is touched, so
 * text somebody actually shaped is left exactly as written. Within a blob a
 * break is taken when the next sentence opens a new thought, or when the
 * current paragraph has grown past a comfortable reading length.
 *
 * The alternative — leaving it alone — is what produced the wall of text this
 * exists to fix. A break in a slightly wrong place costs a reader nothing close
 * to what an unbroken 900-character paragraph costs them.
 */
export function reflowBlob(text: string): string {
  if (text.length < MIN_BLOB_CHARS) return text;

  const sentences = splitSentences(text);
  if (sentences.length < MIN_BLOB_SENTENCES) return text;

  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const opensNewThought = PARAGRAPH_OPENERS.some((m) => sentence.startsWith(m));
    const longEnough = currentLength >= TARGET_PARAGRAPH_CHARS;

    // An opener only breaks once the current paragraph is substantial enough to
    // stand alone — otherwise a run of short sentences that each begin with
    // "So"/"But" would shatter into one-line paragraphs.
    if (current.length > 0 && (longEnough || (opensNewThought && currentLength >= 100))) {
      paragraphs.push(current.join(" "));
      current = [];
      currentLength = 0;
    }

    current.push(sentence);
    currentLength += sentence.length + 1;
  }
  if (current.length > 0) paragraphs.push(current.join(" "));

  return paragraphs.join("\n\n");
}
