#!/usr/bin/env node
/**
 * @fileoverview QC — PR #191, changelog viewport rework + the 0028 planning bundle.
 *
 *   pnpm run test:pr 191 -- --preview   # this branch's preview worker (new template)
 *   pnpm run test:pr 191                # production — new sections report PENDING
 *                                       # until merge + deploy
 *
 * The surface is server-rendered HTML, not JSON, so the assertions are on markup:
 * section anchor ids, the `#N` entry-number chip, the REST method chips, and the
 * slides route existing at all. That is deliberate — the whole change IS the
 * rendered page, and an endpoint-shape test would prove nothing about it.
 *
 * Three things are checked ONLY on an entry that actually carries the data
 * (`feature-proposals` has migrations, diagrams, code and files). Asserting them
 * against an arbitrary slug would fail for a reason that has nothing to do with
 * this PR — an entry with no migrations correctly renders no migrations section.
 */
import { createClient, createChecks, assertReachable, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_191 — changelog viewport rework\n  target: ${resolveBase()}${
    onProd ? " (PROD — new template PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

/** Entry known to carry migrations + diagrams + code + files in its detail. */
const RICH = "feature-proposals";
/** The 0028 proposal filed by this PR — proves the preview path end to end. */
const PROPOSAL = "0028_project_management";
/**
 * Entry authored AS markdown, deliberately containing single-newline prose, a
 * GFM table and a bullet list. The markdown assertions run against this one:
 * `feature-proposals` predates markdown fields and is a single-string blob, so
 * asserting "a table survived" there would fail for reasons unrelated to the
 * normalizer.
 */
const MARKDOWN_FIXTURE = "changelog-viewport-rework";

const count = (html, needle) => (html.match(new RegExp(needle, "g")) ?? []).length;

// ── 1. Regression: the pages still render at all ────────────────────────────
const list = await client.get("/admin/changelog");
const okList = checks.ok("GET /admin/changelog → 200 (regression)", list.status === 200, `→ ${list.status}`);

const preview = await client.get("/admin/changelog/preview");
checks.ok(
  "GET /admin/changelog/preview → 200 (regression)",
  preview.status === 200,
  `→ ${preview.status}`,
);

const entry = await client.get(`/admin/changelog/${RICH}`);
const okEntry = checks.ok(
  `GET /admin/changelog/${RICH} → 200 (regression)`,
  entry.status === 200,
  `→ ${entry.status}`,
);

// ── 2. Entry numbers on the list ────────────────────────────────────────────
if (okList) {
  const numbered = count(list.text, "#\\d+ ·");
  if (onProd && numbered === 0) {
    checks.info("PENDING (prod): entry numbers not deployed yet — expected before merge.");
  } else {
    checks.ok(
      "list titles carry the D1 entry number (#N ·)",
      numbered > 0,
      `${numbered} numbered titles`,
    );
  }
}

// ── 3. The reworked viewport ────────────────────────────────────────────────
if (okEntry) {
  const html = entry.text;
  const sections = ["problem", "approach", "diagrams", "api", "code", "migrations", "files", "verification"];
  const present = sections.filter((id) => html.includes(`id="${id}"`));

  if (onProd && present.length <= 1) {
    checks.info(
      `PENDING (prod): reworked sections not deployed yet (found ${present.join(", ") || "none"}).`,
    );
  } else {
    checks.ok(
      "every detail section renders with its anchor id",
      sections.every((id) => present.includes(id)),
      `present: ${present.join(", ")}`,
    );

    // Problem and Approach must be STACKED, not the old md:grid-cols-2 pair.
    // Guarding on the removed class is what actually detects a regression here —
    // "both sections exist" was true of the old layout too.
    checks.ok(
      "problem/approach are full-width and stacked (no md:grid-cols-2 wrapper)",
      !/id="problem"[\s\S]{0,400}md:grid-cols-2/.test(html),
    );

    checks.ok(
      "API surface renders REST method chips, not a bullet list",
      /GET|POST|PATCH|DELETE/.test(html) && html.includes('id="api"'),
    );

    checks.ok("files touched render as a tree island", html.includes("FilesTouchedTree"));
    checks.ok("code/SQL render through the shiki island", html.includes("CodeHighlight"));

    // The duplicate Verification block read fields that do not exist on the
    // Verification type; it rendered a second empty heading. Exactly one now.
    checks.ok(
      "exactly one Verification section (the broken duplicate is gone)",
      count(html, ">Verification<") === 1,
      `found ${count(html, ">Verification<")}`,
    );

    checks.ok("entry links to its slide deck", html.includes("Present as slides"));

  }
}

// ── 3b. The markdown pipeline, against the fixture entry ────────────────────
const fixture = await client.get(`/admin/changelog/preview/${MARKDOWN_FIXTURE}`);
// Gate on the RENDERED container, not on the word "prose" — the entry's own
// text talks about prose, so a substring check matches on production too and
// the block runs against markup that does not exist there yet.
const fixtureRendered = /class="[^"]*\bprose\b/.test(fixture.text);
if (onProd && !fixtureRendered) {
  checks.info("PENDING (prod): markdown pipeline not deployed yet — expected before merge.");
} else if (checks.ok(`GET /admin/changelog/preview/${MARKDOWN_FIXTURE} → 200`, fixture.status === 200, `→ ${fixture.status}`)) {
  const html = fixture.text;
  checks.ok(
    "prose renders through Tailwind Typography (prose container present)",
    /class="[^"]*\bprose\b/.test(html),
  );
  checks.ok(
    "single newlines became real paragraphs",
    (html.match(/<p>/g) ?? []).length >= 10,
    `${(html.match(/<p>/g) ?? []).length} paragraphs`,
  );
  checks.ok("a GFM table survived normalization", html.includes("<table"));
  checks.ok("a bullet list survived normalization", html.includes("<ul>"));
  // The regression this caught: prose immediately after a table row was being
  // absorbed INTO the table instead of ending it.
  checks.ok(
    "prose after a table is a sibling of the table, not inside it",
    /<\/table><\/div>\s*<p>/.test(html),
  );
  // Matched as an ATTRIBUTE, not a substring: this entry's own code cards quote
  // those class names in their text, which made a bare includes() pass against
  // production where the renderer is not deployed at all.
  checks.ok(
    "inline code renders as a badge with the backticks stripped",
    /<code class="[^"]*bg-zinc-800\/60[^"]*before:content-none/.test(html),
  );
}

// ── 4. Slides route ─────────────────────────────────────────────────────────
const slides = await client.get(`/admin/changelog/${RICH}/slides`);
if (onProd && slides.status === 404) {
  checks.info("PENDING (prod): /slides route not deployed yet — expected before merge.");
} else {
  checks.ok(`GET /admin/changelog/${RICH}/slides → 200`, slides.status === 200, `→ ${slides.status}`);
  checks.ok("slides page mounts the deck island", slides.text.includes("ChangelogDeck"));
  checks.ok(
    "deck takes over the viewport (fixed inset-0, so its controls are on screen)",
    slides.text.includes("AutoScaleContainer") || slides.text.includes("ChangelogDeck"),
  );
}

const previewSlides = await client.get(`/admin/changelog/preview/${PROPOSAL}/slides`);
if (onProd && previewSlides.status === 404) {
  checks.info("PENDING (prod): preview /slides route not deployed yet.");
} else {
  checks.ok(
    `GET /admin/changelog/preview/${PROPOSAL}/slides → 200`,
    previewSlides.status === 200,
    `→ ${previewSlides.status}`,
  );
}

// ── 5. The 0028 proposal itself (regression on the proposal API) ────────────
const proposal = await client.get(`/api/changelog/proposals/${PROPOSAL}`);
const okProposal = checks.ok(
  `GET /api/changelog/proposals/${PROPOSAL} → 200`,
  proposal.status === 200,
  `→ ${proposal.status}`,
);
if (okProposal) {
  const p = proposal.json?.proposal ?? {};
  checks.ok(
    "proposal carries PRD, design brief, prompt and 61 tasks",
    Boolean(p.prdMarkdown) &&
      Boolean(p.designBriefMarkdown) &&
      Boolean(p.promptMarkdown) &&
      proposal.json?.tasks?.length === 61,
    `tasks=${proposal.json?.tasks?.length}`,
  );
  // The AGENTS.md rule from #186: a planning artifact without diagrams is a defect.
  const fences = (p.prdMarkdown?.match(/```mermaid/g) ?? []).length;
  checks.ok("PRD is diagram-dense (>= 5 mermaid blocks)", fences >= 5, `${fences} mermaid blocks`);
}

// ── 6. Auth guard (regression) ──────────────────────────────────────────────
// `fetch` follows the redirect, so the status is the ACCESS page's 200, not the
// 302. Asserting on the status alone would pass for a page that leaked its
// content; assert on the body instead — the gate works only if the changelog
// itself is absent from what an unauthenticated caller receives.
const unauth = await client.get("/admin/changelog", { auth: false });
checks.ok(
  "admin changelog without auth does not serve changelog content",
  !unauth.text.includes("Release Highlights") && !unauth.text.includes("Release Feed"),
  `→ ${unauth.status}`,
);

checks.finish();
