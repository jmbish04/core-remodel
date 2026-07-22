/**
 * @fileoverview Runnable check for the markdown normalizer.
 *
 *   npx tsx scripts/checks/markdown-normalize.check.ts
 *
 * Exists because the normalizer is the one piece of this feature with real
 * branching logic and no other test surface. The two things it must never do —
 * detach a GFM table from its delimiter, and inject blank lines into a fence —
 * are exactly the failures a reader would notice last and blame on the author.
 */
import assert from "node:assert/strict";

import { normalizeMarkdown, reflowBlob } from "../../src/frontend/lib/markdown-normalize";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log("\nmarkdown-normalize\n");

check("a long single-line blob becomes several paragraphs", () => {
  const blob =
    "An idea gets worked out in conversation with an AI model, often mid-discussion. " +
    "Weeks later a coding agent picks it up with zero shared memory. " +
    "What survives that gap is a summary, and a summary loses the alternatives that were rejected, the constraints discovered halfway through, and the phrasing a paraphrase quietly changes. " +
    "The agent rebuilds a lossy version of the plan from it, and the divergence only surfaces once the wrong thing is built. " +
    "Second gap: there was no way to submit an idea as a proposal from a non-coding tool at all.";
  const out = normalizeMarkdown(blob);
  assert.ok(out.split(/\n{2,}/).length >= 3, `only ${out.split(/\n{2,}/).length} paragraph(s)`);
});

check("short prose is left exactly as written", () => {
  const short = "One sentence. Then a second one.";
  assert.equal(normalizeMarkdown(short), short);
});

check("a GFM table keeps its rows contiguous", () => {
  const md = "Intro line.\n| A | B |\n| --- | --- |\n| 1 | 2 |\nTrailing prose.";
  const out = normalizeMarkdown(md);
  assert.match(out, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
});

check("prose after a table ends the table instead of joining it", () => {
  const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\nTrailing prose.";
  const out = normalizeMarkdown(md);
  assert.match(out, /\| 1 \| 2 \|\n\nTrailing prose\./);
});

check("a fenced block is byte-identical", () => {
  const fence = "```ts\nconst a = 1;\nconst b = 2;\n```";
  assert.ok(normalizeMarkdown(`Before.\n${fence}\nAfter.`).includes(fence));
});

check("a tight list stays tight", () => {
  const md = "- one\n- two\n- three";
  assert.equal(normalizeMarkdown(md), md);
});

check("inline code containing a period is not a sentence boundary", () => {
  const text = "Call `foo.bar()` to do it. ".repeat(8);
  assert.ok(!reflowBlob(text).includes("`foo.\n"));
});

check("a decimal is not a sentence boundary", () => {
  const text = "The threshold is 0.5 in every case and that matters here. ".repeat(9);
  assert.ok(!/0\.\n/.test(reflowBlob(text)));
});

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
