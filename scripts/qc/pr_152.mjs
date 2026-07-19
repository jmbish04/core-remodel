#!/usr/bin/env node
/**
 * @fileoverview QC for PR #152 — feature-proposal API, MCP tools, script parity,
 * preview bundle, changelog verification block.
 *
 * Branch: claude/feature-proposals-api-tools-ea0c5c
 * Migrations: 0112_careful_gambit (changelog_proposals)
 *
 * Run:  pnpm run test:pr 152
 *       pnpm run test:pr 152 -- --sweep     # also push a REAL ~450KB transcript
 *
 * The sweep is where the interesting failures are. A 2KB fixture exercises none
 * of what actually makes this feature risky — the payload size on the write
 * path, the R2 round-trip, and the hash-based dedupe. So `--sweep` generates a
 * transcript at the size a real `cat` dump measured (~450KB) and asserts it
 * survives the round-trip byte-for-byte.
 *
 * Regression guard: the proposal routes are registered ahead of the pre-existing
 * `GET /api/changelog/:slug`. Hono matches in registration order, so getting
 * that wrong silently breaks either the new list route or the old entry route —
 * both are asserted below.
 */
import { assertReachable, accessCookie, createChecks, createClient, resolveBase } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const SWEEP = process.argv.includes("--sweep");

const SLUG = "qc-pr-152-feature-proposal";

/**
 * Build a transcript of roughly `targetBytes`, shaped like a real session dump
 * (alternating speaker turns) rather than one long run of filler — the write
 * path should be exercised with something structurally realistic.
 */
function makeTranscript(targetBytes) {
  const turns = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const turn =
      `## ${i % 2 === 0 ? "User" : "Assistant"}\n\n` +
      `Turn ${i}. Considered storing the transcript inline in D1 and rejected it: ` +
      `SQLite reads whole rows, so a status query would drag the entire blob off disk. ` +
      `Constraint discovered mid-conversation: prod D1 is ~28MB total.\n\n`;
    turns.push(turn);
    size += turn.length;
    i++;
  }
  return turns.join("");
}

async function main() {
  console.log(`\nPR #152 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  // Proposals are gated even though the rest of /api/changelog is not: the write
  // path puts an arbitrarily large body into R2 and the read path returns a raw
  // conversation transcript.
  const noAuth = await client.get("/api/changelog/proposals", { auth: false });
  checks.ok(
    "unauthenticated GET /api/changelog/proposals is rejected",
    noAuth.status === 401 || noAuth.status === 403,
    `got ${noAuth.status}`,
  );
  const noAuthWrite = await client.post("/api/changelog/proposals", { slug: "should-not-land" }, { auth: false });
  checks.ok(
    "unauthenticated POST /api/changelog/proposals is rejected",
    noAuthWrite.status === 401 || noAuthWrite.status === 403,
    `got ${noAuthWrite.status}`,
  );

  // ── Migration 0112 landed ──────────────────────────────────────────────────
  // A 500 here is the signature of an unapplied migration: every branch push
  // deploys the worker, but migrations do not ride the build.
  const list = await client.get("/api/changelog/proposals");
  checks.ok(
    "GET /api/changelog/proposals → 200 (migration 0112 applied)",
    list.status === 200,
    `got ${list.status}${list.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );

  // ── Regression: the pre-existing entry route still resolves ────────────────
  // /proposals is registered before /:slug; if that ordering were wrong, one of
  // these two would break.
  const oldRoute = await client.get("/api/changelog/changelog-preview");
  checks.ok(
    "regression: GET /api/changelog/:slug still resolves an entry",
    oldRoute.status === 200 || oldRoute.status === 404,
    `got ${oldRoute.status} (a 400/500 would mean /proposals shadowed it)`,
  );
  // No trailing slash: Hono routes strictly, and `/api/changelog/` 404s on the
  // pre-existing worker too — that is not something this PR changed.
  const branchList = await client.get("/api/changelog");
  checks.ok("regression: GET /api/changelog still lists branches", branchList.status === 200, `got ${branchList.status}`);

  // ── Upsert with the full bundle ────────────────────────────────────────────
  const smallContext = makeTranscript(2_000);
  const created = await client.post("/api/changelog/proposals", {
    slug: SLUG,
    title: "QC PR 152 — feature proposal round-trip",
    summary: "Synthetic proposal written by scripts/qc/pr_152.mjs to verify the bundle round-trip.",
    area: "changelog",
    branch: "claude/feature-proposals-api-tools-ea0c5c",
    prNumber: 152,
    prdMarkdown: "# PRD\n\nSynthetic PRD body.",
    designBriefMarkdown: "# Design brief\n\nSynthetic brief.",
    promptMarkdown: "Read the transcript before implementing anything.",
    context: smallContext,
    contextCoverageNote: "Synthetic QC transcript — complete, generated in full by the QC script.",
    sourceKind: "coding_agent",
    sourceModel: "qc-script",
    tasks: [
      { taskKey: "QC-152-01", title: "API round-trip", workstream: "api", phase: 1 },
      { taskKey: "QC-152-02", title: "R2 round-trip", workstream: "api", phase: 1, sortOrder: 1 },
    ],
  });
  checks.ok(
    "POST /api/changelog/proposals accepts a full bundle",
    created.status === 200 || created.status === 201,
    `got ${created.status} ${created.text.slice(0, 200)}`,
  );
  checks.ok("upsert reports the tasks it seeded", created.json?.tasksSeeded === 2, `got ${created.json?.tasksSeeded}`);
  checks.ok("upsert stored a context hash", Boolean(created.json?.contextSha256), created.json?.contextSha256 ?? "none");

  // ── Read the bundle back ───────────────────────────────────────────────────
  const bundle = await client.get(`/api/changelog/proposals/${SLUG}`);
  checks.ok("GET /api/changelog/proposals/:slug → 200", bundle.status === 200, `got ${bundle.status}`);
  checks.ok(
    "bundle carries the markdown artifacts",
    bundle.json?.proposal?.prdMarkdown?.startsWith("# PRD") &&
      Boolean(bundle.json?.proposal?.promptMarkdown),
    "prd/prompt present",
  );
  checks.ok(
    "bundle NEVER inlines the raw transcript",
    !("text" in (bundle.json?.context ?? {})) && typeof bundle.json?.context?.bytes === "number",
    `context keys: ${Object.keys(bundle.json?.context ?? {}).join(",")}`,
  );
  checks.ok(
    "coverage note round-trips (it is what stops a reader assuming completeness)",
    bundle.json?.context?.coverageNote?.includes("complete"),
    bundle.json?.context?.coverageNote ?? "missing",
  );
  checks.ok(
    "TASKS seeded into the EXISTING plan_tasks, with live status",
    bundle.json?.tasks?.length === 2 && bundle.json.tasks.every((t) => t.status === "pending"),
    `${bundle.json?.tasks?.length} tasks`,
  );
  checks.ok(
    "the staged changelog entry was upserted alongside the proposal",
    bundle.json?.entry?.status === "staged",
    `entry: ${JSON.stringify(bundle.json?.entry ?? null).slice(0, 120)}`,
  );

  // ── Transcript streams back out of R2, byte-for-byte ───────────────────────
  const ctx = await fetch(`${resolveBase()}/api/changelog/proposals/${SLUG}/context`, {
    headers: { cookie: accessCookie() },
  });
  const ctxText = await ctx.text();
  checks.ok("GET …/context streams the R2 object", ctx.status === 200, `got ${ctx.status}`);
  checks.ok(
    "transcript round-trips VERBATIM (nothing summarized it on the way in)",
    ctxText === smallContext,
    `sent ${smallContext.length} chars, got back ${ctxText.length}`,
  );

  // ── Hash dedupe: re-submitting the same transcript skips the R2 put ────────
  const resubmit = await client.post("/api/changelog/proposals", { slug: SLUG, context: smallContext });
  checks.ok(
    "re-submitting an identical transcript is detected as unchanged",
    resubmit.json?.contextUnchanged === true,
    `contextUnchanged=${resubmit.json?.contextUnchanged}`,
  );
  checks.ok("re-submit updates rather than duplicates", resubmit.json?.created === false, `created=${resubmit.json?.created}`);

  // ── Sparse patch: an omitted field must not blank a stored one ─────────────
  const patched = await client.post("/api/changelog/proposals", { slug: SLUG, status: "accepted" });
  checks.ok("status-only patch accepted", patched.status === 200 || patched.status === 201, `got ${patched.status}`);
  const afterPatch = await client.get(`/api/changelog/proposals/${SLUG}`);
  checks.ok(
    "a field omitted from the patch is NOT blanked",
    afterPatch.json?.proposal?.prdMarkdown?.startsWith("# PRD") &&
      afterPatch.json?.proposal?.status === "accepted",
    `prd=${afterPatch.json?.proposal?.prdMarkdown ? "kept" : "LOST"} status=${afterPatch.json?.proposal?.status}`,
  );

  // ── Status filter ──────────────────────────────────────────────────────────
  const filtered = await client.get("/api/changelog/proposals?status=accepted");
  checks.ok(
    "?status= filters the list",
    filtered.status === 200 && filtered.json.proposals.every((p) => p.status === "accepted"),
    `${filtered.json?.proposals?.length} rows`,
  );
  const badStatus = await client.get("/api/changelog/proposals?status=nonsense");
  checks.ok("an unknown ?status= is rejected with 400", badStatus.status === 400, `got ${badStatus.status}`);

  // ── 404s ───────────────────────────────────────────────────────────────────
  const missing = await client.get("/api/changelog/proposals/definitely-not-a-real-slug");
  checks.ok("unknown slug → 404", missing.status === 404, `got ${missing.status}`);

  // ── Preview page renders the bundle ────────────────────────────────────────
  const page = await fetch(`${resolveBase()}/admin/changelog/preview/${SLUG}`, {
    headers: { cookie: accessCookie() },
  });
  const html = await page.text();
  checks.ok("preview page renders", page.status === 200, `got ${page.status}`);
  checks.ok(
    "preview page surfaces the coverage note next to the transcript",
    html.includes("Coverage") || html.includes("coverage"),
    "coverage marker present in HTML",
  );

  // ── MCP registry exposes the three tools ───────────────────────────────────
  const catalog = await client.get("/api/mcp-docs", { auth: false });
  const names = JSON.stringify(catalog.json ?? {});
  for (const tool of ["submit_feature_proposal", "get_feature_proposal", "list_feature_proposals"]) {
    checks.ok(`MCP catalog exposes ${tool}`, names.includes(tool), catalog.status === 200 ? "" : `catalog → ${catalog.status}`);
  }

  // ── SWEEP: the real thing, at real size ────────────────────────────────────
  if (SWEEP) {
    console.log("\n  --sweep: pushing a ~450KB transcript (the size a real dump measured)\n");
    const big = makeTranscript(450_000);
    checks.info(`generated ${(big.length / 1024).toFixed(1)} KB`);
    const t0 = Date.now();
    const bigPost = await client.post("/api/changelog/proposals", {
      slug: `${SLUG}-large`,
      title: "QC PR 152 — large transcript",
      summary: "450KB transcript, the size that actually matters.",
      context: big,
      contextCoverageNote: "Synthetic 450KB dump.",
    });
    checks.ok(
      "a ~450KB transcript is accepted",
      bigPost.status === 200 || bigPost.status === 201,
      `got ${bigPost.status} in ${Date.now() - t0}ms`,
    );
    checks.info(`stored ${bigPost.json?.contextBytes} bytes in ${Date.now() - t0}ms`);
    checks.ok(
      "stored byte count matches what was sent",
      bigPost.json?.contextBytes === new TextEncoder().encode(big).length,
      `${bigPost.json?.contextBytes} vs ${new TextEncoder().encode(big).length}`,
    );

    const bigCtx = await fetch(`${resolveBase()}/api/changelog/proposals/${SLUG}-large/context`, {
      headers: { cookie: accessCookie() },
    });
    const bigText = await bigCtx.text();
    checks.ok("the large transcript streams back intact", bigText === big, `${bigText.length} vs ${big.length} chars`);

    // The listing must stay cheap even with a large blob attached — that is the
    // whole reason the transcript is in R2 and not in the row.
    const listT0 = Date.now();
    const listAfter = await client.get("/api/changelog/proposals");
    checks.ok(
      "listing stays fast with a large transcript stored",
      listAfter.status === 200 && Date.now() - listT0 < 5000,
      `${Date.now() - listT0}ms`,
    );
  } else {
    checks.info("skipped the ~450KB payload — re-run with `-- --sweep` to exercise it");
  }

  checks.finish();
}

await main();
