#!/usr/bin/env node
/**
 * @fileoverview QC for PR #379 — vendor-email context layer (instructions doc +
 * recipient resolution). No send path — this PR resolves recipients and stores
 * a reusable boilerplate doc; it never sends mail.
 *
 * New surface (GET/PUT /api/email/instructions, GET /api/email/resolve-recipient)
 * does not exist on production until this PR merges + deploys.
 * GET /api/email/instructions doubles as the "is this target running the PR?"
 * probe: on a target that doesn't have it yet (404), every assertion below is
 * reported as pending merge/deploy rather than failed, so the production run
 * stays a clean regression guard while the PR is open.
 *
 * MUTATES SHARED STATE: PUT /api/email/instructions overwrites the single
 * shared instructions row on whatever target this runs against. The script
 * reads the prior value first and restores it at the end (in a finally-style
 * block), so a run against production or a shared preview leaves no residue.
 *
 *   pnpm run test:pr 379 -- --preview   # this branch's preview worker
 *   pnpm run test:pr 379                # production regression guard
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

async function main() {
  const client = createClient({ base: resolveBase() });
  const checks = createChecks();
  console.log(`\nPR #379 QC — vendor-email context layer\n  target: ${client.base}\n`);
  await assertReachable(client, checks);

  // --- capability gate -------------------------------------------------------
  const probe = await client.get("/api/email/instructions");
  if (probe.status === 404) {
    checks.info(
      "pending merge/deploy — GET /api/email/instructions returned 404. Expected on " +
        "production pre-merge; every assertion below is skipped rather than failed.",
    );
    checks.finish();
    return;
  }
  if (
    !checks.ok(
      "GET /api/email/instructions returns 200 (the surface is expected to exist on this target)",
      probe.status === 200,
      `status ${probe.status}, body ${JSON.stringify(probe.json)}`,
    )
  ) {
    checks.finish();
    return;
  }

  // --- instructions round-trip + sanitize (mutates + restores shared state) --
  const original = probe.json; // { markdown, html, updatedAt }
  try {
    const testMarkdown = "# Vendor boilerplate\n\nHello **{{trade}}**.";
    const testHtml =
      "<h1>Vendor boilerplate</h1><p>Hello <strong>x</strong></p><script>alert(1)</script>";
    const put = await client.req("PUT", "/api/email/instructions", {
      body: { markdown: testMarkdown, html: testHtml },
    });
    checks.ok(
      "PUT /api/email/instructions accepts { markdown, html } -> 200",
      put.status === 200,
      `status ${put.status}, body ${JSON.stringify(put.json)}`,
    );

    const after = await client.get("/api/email/instructions");
    checks.ok(
      "GET after PUT: markdown round-trips exactly",
      after.json?.markdown === testMarkdown,
      `got ${JSON.stringify(after.json?.markdown)}`,
    );
    checks.ok(
      "GET after PUT: html is sanitized — <script> tag stripped",
      typeof after.json?.html === "string" && !after.json.html.includes("<script"),
      `got ${JSON.stringify(after.json?.html)}`,
    );
    checks.ok(
      "GET after PUT: sanitized html still keeps the safe markup",
      typeof after.json?.html === "string" &&
        after.json.html.includes("<h1>") &&
        after.json.html.includes("<strong>"),
      `got ${JSON.stringify(after.json?.html)}`,
    );
  } finally {
    // Restore the prior shared value regardless of pass/fail above.
    const restore = await client.req("PUT", "/api/email/instructions", {
      body: { markdown: original.markdown, html: original.html },
    });
    checks.ok(
      "restored the original instructions row (shared state left clean)",
      restore.status === 200,
      `status ${restore.status}`,
    );
  }

  // --- resolve_recipient -------------------------------------------------
  const byEmail = await client.get("/api/email/resolve-recipient?email=nancy@pietrafina.com");
  checks.ok(
    "resolve-recipient?email=<valid address> -> ok:true, recipients[0].email matches",
    byEmail.status === 200 &&
      byEmail.json?.ok === true &&
      byEmail.json?.recipients?.[0]?.email === "nancy@pietrafina.com",
    `status ${byEmail.status}, body ${JSON.stringify(byEmail.json)}`,
  );

  const invalidEmail = await client.get("/api/email/resolve-recipient?email=not-an-email");
  checks.ok(
    "resolve-recipient?email=<malformed> -> ok:false, reason:invalid",
    invalidEmail.status === 200 &&
      invalidEmail.json?.ok === false &&
      invalidEmail.json?.reason === "invalid",
    `status ${invalidEmail.status}, body ${JSON.stringify(invalidEmail.json)}`,
  );

  const noSuchStore = await client.get("/api/email/resolve-recipient?store=NoSuchStoreXYZ");
  checks.ok(
    "resolve-recipient?store=<unknown> -> ok:false, reason:no_match",
    noSuchStore.status === 200 &&
      noSuchStore.json?.ok === false &&
      noSuchStore.json?.reason === "no_match",
    `status ${noSuchStore.status}, body ${JSON.stringify(noSuchStore.json)}`,
  );

  // Info-only: exercising the store path against a real fixture. Not a hard
  // assertion — we don't know which showroom stores exist on this target, so
  // this only reports what happened rather than failing either way.
  const byStore = await client.get("/api/email/resolve-recipient?store=Pietrafina");
  checks.info(
    `store lookup for "Pietrafina" -> status ${byStore.status}, ` +
      `body ${JSON.stringify(byStore.json)}`,
  );

  checks.finish();
}

await main();
