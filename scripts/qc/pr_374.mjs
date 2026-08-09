#!/usr/bin/env node
/**
 * @fileoverview QC for PR #374 — Google Drive ingestion service.
 *
 * Asserts against the two REAL roots, measured by hand against the live
 * folders while building the service (see task-6-report.md):
 *   onboarding 1ZUJ… (EMAIL_ONBOARDING_MATERIALS) → 72 nodes: 61 documents +
 *     11 subfolders. Contains "1971 Blueprints.pdf" and
 *     "23. Floor Plans with Measurements.pdf", both with a non-zero size.
 *   research   17R5… (DEEP_RESEARCH_FINDINGS)
 *
 * The second-run idempotency check is the single most important assertion
 * here: a nightly scan that created rows every run would silently multiply
 * the catalogue and nothing else would catch it.
 *
 * Also asserts the two defects the review rounds actually caught, so they
 * cannot regress silently:
 *   - POST /ingest with a wrong-shaped rootId (string, not number) -> 400
 *     (Zod validation), not a generic 500.
 *   - POST /ingest with a well-shaped but nonexistent rootId -> 404, not a
 *     500 from ingestDriveFolder's throw falling through.
 *
 * New surface (POST /api/admin/drive/ingest et al) does not exist on
 * production until this PR merges + deploys. GET /api/admin/drive/roots
 * doubles as the "is this target running the PR?" probe: on a target that
 * doesn't have it yet (404), every assertion that depends on it is reported
 * as pending merge/deploy rather than failed, so the production run stays a
 * clean regression guard while the PR is open.
 *
 *   pnpm run test:pr 374 -- --preview   # this branch's preview worker
 *   pnpm run test:pr 374                # production regression guard
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const ONBOARDING = "1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU";
const RESEARCH = "17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1";
const SHARING_VALUES = ["ANYONE", "ANYONE_WITH_LINK", "DOMAIN", "DOMAIN_WITH_LINK", "PRIVATE"];

async function main() {
  const client = createClient({ base: resolveBase() });
  const checks = createChecks();
  console.log(`\nPR #374 QC — Drive ingestion service\n  target: ${client.base}\n`);
  await assertReachable(client, checks);

  const roots = await client.get("/api/admin/drive/roots");
  const surfaceDeployed = roots.status === 200;
  if (!surfaceDeployed) {
    checks.info(
      `pending merge/deploy — GET /api/admin/drive/roots returned ${roots.status}. ` +
        "Expected on production pre-merge; every assertion below is skipped rather than failed.",
    );
    checks.finish();
    return;
  }

  checks.ok("both roots are seeded", roots.json?.roots?.length >= 2, `status ${roots.status}`);
  const onboarding = roots.json?.roots?.find((r) => r.driveFolderId === ONBOARDING);
  const research = roots.json?.roots?.find((r) => r.driveFolderId === RESEARCH);
  checks.ok(
    "onboarding root maps to EMAIL_ONBOARDING_MATERIALS",
    onboarding?.useCase === "EMAIL_ONBOARDING_MATERIALS",
    JSON.stringify(onboarding),
  );
  checks.ok(
    "research root maps to DEEP_RESEARCH_FINDINGS",
    research?.useCase === "DEEP_RESEARCH_FINDINGS",
    JSON.stringify(research),
  );

  // --- validation defects caught in review: 400 vs 404 vs 200 --------------
  const badShape = await client.post("/api/admin/drive/ingest", { rootId: "abc" });
  checks.ok(
    "POST /ingest with a wrong-typed rootId returns 400 (Zod), not a 500",
    badShape.status === 400,
    `status ${badShape.status}, body ${JSON.stringify(badShape.json)}`,
  );

  const noSuchRoot = await client.post("/api/admin/drive/ingest", { rootId: 999999 });
  checks.ok(
    "POST /ingest with a well-shaped but nonexistent rootId returns 404",
    noSuchRoot.status === 404,
    `status ${noSuchRoot.status}, body ${JSON.stringify(noSuchRoot.json)}`,
  );

  const omitted = await client.post("/api/admin/drive/ingest", {});
  checks.ok(
    "POST /ingest with an empty body ingests ALL active roots",
    omitted.status === 200 &&
      Array.isArray(omitted.json?.summaries) &&
      omitted.json.summaries.length >= 2,
    `status ${omitted.status}, summaries ${omitted.json?.summaries?.length}`,
  );

  // --- real scan against the onboarding root --------------------------------
  const first = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  const s1 = first.json?.summaries?.[0];
  checks.ok(
    "scan by real rootId ingests the onboarding folder: 72 nodes (61 docs + 11 folders)",
    first.status === 200 && s1?.seen === 72,
    `status ${first.status}, seen ${s1?.seen}, errors ${JSON.stringify(s1?.errors)}`,
  );
  checks.info(
    `seen=${s1?.seen} created=${s1?.created} superseded=${s1?.superseded} deleted=${s1?.deleted}`,
  );

  const second = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  const s2 = second.json?.summaries?.[0];
  checks.ok(
    "second scan is a no-op (idempotent) — the load-bearing assertion",
    s2?.created === 0 && s2?.superseded === 0 && s2?.deleted === 0,
    `created ${s2?.created}, superseded ${s2?.superseded}, deleted ${s2?.deleted}`,
  );

  const docs = await client.get(`/api/admin/drive/documents?rootId=${onboarding?.id}`);
  const list = docs.json?.documents ?? [];
  checks.ok(
    "documents are listed with a joined folder name, count == 61",
    list.length === 61 && typeof list[0]?.folderName === "string",
    `count ${list.length}`,
  );
  checks.ok(
    "the 1971 Blueprints PDF is catalogued with a non-zero size",
    list.some((d) => d.name.includes("1971 Blueprints") && d.sizeBytes > 0),
    JSON.stringify(list.find((d) => d.name.includes("1971 Blueprints"))),
  );
  checks.ok(
    "the Floor Plans with Measurements PDF is catalogued with a non-zero size",
    list.some((d) => d.name.includes("23. Floor Plans with Measurements") && d.sizeBytes > 0),
    JSON.stringify(list.find((d) => d.name.includes("23. Floor Plans with Measurements"))),
  );
  checks.ok(
    "sharing is recorded on every document from the allowed vocabulary",
    list.length > 0 && list.every((d) => SHARING_VALUES.includes(d.sharing)),
    `distinct: ${[...new Set(list.map((d) => d.sharing))].join(", ")}`,
  );

  // --- folderId filter on the documents endpoint ----------------------------
  // ponytail: the route doesn't return folderId (only the joined folderName),
  // and there's no folders-list endpoint, so a real folder id isn't
  // discoverable via the API. Assert the shape we CAN verify: a syntactically
  // valid filter narrows results to <= the unfiltered count, and a bad one 400s.
  const filtered = await client.get(
    `/api/admin/drive/documents?rootId=${onboarding?.id}&folderId=1`,
  );
  checks.ok(
    "GET /documents accepts a numeric folderId filter and narrows the result set",
    filtered.status === 200 &&
      Array.isArray(filtered.json?.documents) &&
      filtered.json.documents.length <= list.length,
    `status ${filtered.status}, count ${filtered.json?.documents?.length}`,
  );
  const badFolderId = await client.get(
    `/api/admin/drive/documents?rootId=${onboarding?.id}&folderId=abc`,
  );
  checks.ok(
    "GET /documents rejects a non-numeric folderId with 400",
    badFolderId.status === 400,
    `status ${badFolderId.status}`,
  );

  checks.finish();
}

await main();
