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
  // 404 is the ONLY status that honestly means "this code isn't deployed
  // here yet" — gate on that exact value, not on "anything but 200". A 500
  // (broken route) or 401 (auth regression) on a target that's SUPPOSED to
  // have this surface must fail loudly, not be swallowed as "pending".
  if (roots.status === 404) {
    checks.info(
      "pending merge/deploy — GET /api/admin/drive/roots returned 404. Expected on " +
        "production pre-merge; every assertion below is skipped rather than failed.",
    );
    checks.finish();
    return;
  }
  if (
    !checks.ok(
      "GET /api/admin/drive/roots returns 200 (the surface is expected to exist on this target)",
      roots.status === 200,
      `status ${roots.status}, body ${JSON.stringify(roots.json)}`,
    )
  ) {
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

  const afterFirst = await client.get(`/api/admin/drive/documents?rootId=${onboarding?.id}`);
  const countAfterFirst = afterFirst.json?.documents?.length;

  const second = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  const s2 = second.json?.summaries?.[0];
  checks.ok(
    "second scan is a no-op (idempotent) — the load-bearing assertion",
    s2?.created === 0 && s2?.superseded === 0 && s2?.deleted === 0 && s2?.undeleted === 0,
    `created ${s2?.created}, superseded ${s2?.superseded}, deleted ${s2?.deleted}, undeleted ${s2?.undeleted}`,
  );

  const docs = await client.get(`/api/admin/drive/documents?rootId=${onboarding?.id}`);
  const list = docs.json?.documents ?? [];

  // --- Critical 1: one live row per Drive id, across repeated scans ---------
  // A delete-marked row used to be invisible to the next diff, so anything
  // that came back (an exclusion added then removed, a trash-then-restore)
  // was re-CREATED — a second is_active row for the same Drive id, silently,
  // because the drive_id indexes are non-unique. The catalogue must not grow
  // between two scans of an unchanged folder, and no Drive id may appear on
  // two live rows. A partial unique index now enforces the second half in D1;
  // this proves it end to end.
  checks.ok(
    "re-ingest does not grow the catalogue (no duplicate rows from a second scan)",
    countAfterFirst === list.length,
    `after first scan ${countAfterFirst}, after second ${list.length}`,
  );
  const driveIds = list.map((d) => d.driveId);
  const dupes = driveIds.filter((id, i) => driveIds.indexOf(id) !== i);
  checks.ok(
    "every live document row has a distinct Drive id (no duplicate active rows)",
    driveIds.length > 0 && driveIds.every(Boolean) && dupes.length === 0,
    `rows ${driveIds.length}, duplicated ids: ${[...new Set(dupes)].join(", ") || "none"}`,
  );
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
  // Real narrowing check, not a tautology: a bare AND-on-rootId would ALWAYS
  // satisfy "filtered <= unfiltered", so that alone proves nothing about
  // whether the filter does anything. Get a genuine folder id from the
  // unfiltered list (the route now selects driveDocuments.folderId — the
  // document's own FK, not a denormalized copy), then require the filtered
  // set to be a NON-EMPTY STRICT SUBSET: smaller than the total, and every
  // returned row actually belongs to the requested folder.
  const targetFolderId = list[0]?.folderId;
  const filtered = targetFolderId
    ? await client.get(
        `/api/admin/drive/documents?rootId=${onboarding?.id}&folderId=${targetFolderId}`,
      )
    : null;
  checks.ok(
    "GET /documents?folderId= returns only that folder's rows, and fewer than the unfiltered total",
    Boolean(targetFolderId) &&
      filtered.status === 200 &&
      Array.isArray(filtered.json?.documents) &&
      filtered.json.documents.length > 0 &&
      filtered.json.documents.length < list.length &&
      filtered.json.documents.every((d) => d.folderId === targetFolderId),
    `targetFolderId ${targetFolderId}, filtered ${filtered?.json?.documents?.length}/${list.length}, ` +
      `distinct folderIds in filtered: ${[...new Set((filtered?.json?.documents ?? []).map((d) => d.folderId))].join(", ")}`,
  );
  const badFolderId = await client.get(
    `/api/admin/drive/documents?rootId=${onboarding?.id}&folderId=abc`,
  );
  checks.ok(
    "GET /documents rejects a non-numeric folderId with 400",
    badFolderId.status === 400,
    `status ${badFolderId.status}`,
  );

  // --- charset validation on the Drive folder id ----------------------------
  // The id is interpolated into the Drive `q` parameter, so it is validated at
  // the entry point rather than escaped downstream.
  const badRoot = await client.post("/api/admin/drive/roots", {
    driveFolderId: "not a drive id' or '1'='1",
    label: "qc-invalid",
    useCaseKey: "DEEP_RESEARCH_FINDINGS",
  });
  checks.ok(
    "POST /roots rejects a driveFolderId with an illegal charset (400, no row created)",
    badRoot.status === 400,
    `status ${badRoot.status}, body ${JSON.stringify(badRoot.json)}`,
  );

  // --- concurrency: the scan lease -----------------------------------------
  // The 11:00 cron and a manual POST are the same unserialized path. Two
  // overlapping scans both read the pre-write snapshot and both insert. Fire
  // two at once: exactly one must take the lease, the other must get a 409.
  const [a, b] = await Promise.all([
    client.post("/api/admin/drive/ingest", { rootId: onboarding?.id }),
    client.post("/api/admin/drive/ingest", { rootId: onboarding?.id }),
  ]);
  const statuses = [a.status, b.status].sort();
  checks.ok(
    "two concurrent scans of one root: one 200, one 409 (the scan lease holds)",
    statuses[0] === 200 && statuses[1] === 409,
    `statuses ${statuses.join(", ")}`,
  );

  // The lease must be RELEASED, not left held — a stuck lease would block the
  // nightly cron for the whole staleness window.
  const afterConflict = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  checks.ok(
    "the lease is released when a scan finishes (the next scan runs, not 409)",
    afterConflict.status === 200,
    `status ${afterConflict.status}, body ${JSON.stringify(afterConflict.json).slice(0, 200)}`,
  );

  checks.finish();
}

await main();
