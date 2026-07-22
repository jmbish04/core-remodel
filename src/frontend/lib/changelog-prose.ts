/**
 * @fileoverview Paragraph handling for changelog prose fields.
 *
 * Every long-form field on a changelog entry (introduction, problem, approach,
 * diagram descriptions) is authored as an ARRAY where one element = one
 * paragraph. A single unbroken blob of text is genuinely hard to read, and the
 * array shape makes the paragraph break part of the data rather than something
 * the renderer has to guess at.
 *
 * These fields live inside `changelog_entries.detail_json`, so widening them
 * from `string` to `string | string[]` needs no migration — but the ~1,500 lines
 * of already-written entries in `data/changelog-detail.ts` are all plain
 * strings, so both shapes have to keep working forever.
 *
 * On the string branch we split on blank lines only. We deliberately do NOT
 * chunk a single-line blob on sentence boundaries: every break would be a guess,
 * and a wrong break reads worse than no break. Old entries render as one
 * paragraph until someone re-files them as an array; new ones get it for free.
 */

/** A long-form field: one string, or one string per paragraph. */
export type Prose = string | string[];

/**
 * Normalize a prose field to paragraphs.
 *
 * @returns One entry per paragraph, trimmed, with empties dropped. `[]` when
 *          there is nothing to render — callers can branch on `.length`.
 */
export function toParagraphs(value: Prose | null | undefined): string[] {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : value.split(/\n\s*\n/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Flatten a prose field to a single string, for the few consumers that cannot
 * take paragraphs (a block component's `description` prop, a slide subtitle,
 * a meta tag). Joined with a space so it reads as continuous prose.
 */
export function proseToText(value: Prose | null | undefined): string {
  return toParagraphs(value).join(" ");
}

/** First paragraph only — the lede, for summaries and slide bodies. */
export function proseLede(value: Prose | null | undefined): string {
  return toParagraphs(value)[0] ?? "";
}
