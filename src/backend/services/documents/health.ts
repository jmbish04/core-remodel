/**
 * @fileoverview Health probes for the documents module (supporting documents:
 * PDFs, screenshots, contracts, invoices, plans).
 *
 * The module has two halves that fail independently: the R2 bucket that holds
 * the bytes (`ARTIFACTS_BUCKET`, written by fetch-remote.ts, read by
 * extraction.ts) and the `supporting_documents` row that points at them. A row
 * with a null `r2_object_key` and no `external_url` is a document that exists in
 * the list and 404s when opened — the exact failure these probes catch.
 *
 * Cost discipline: R2 is probed with `head` + a `list({ limit: 1 })`. Never
 * enumerate the bucket, never `get` an object body, never run the extraction model.
 */
import {
  defineProbe,
  degraded,
  failure,
  ok,
  scalar,
  tableExists,
  type HealthProbe,
} from "@backend/services/health/types";

const FILE = "src/backend/services/documents/health.ts";

/** Below this the document library looks unseeded rather than merely small. */
const DOCUMENT_COUNT_FLOOR = 5;

/** Failed extractions above this count means the parse pipeline needs attention. */
const EXTRACTION_FAILED_DEGRADED_AT = 10;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "documents_r2_bucket_reachable",
    displayName: "Documents R2 bucket reachable",
    description:
      "Proves ARTIFACTS_BUCKET is bound and answers, using a `head` of a sentinel key plus a " +
      "`list({ limit: 1 })`. Both are bounded Class-B operations; the bucket is never enumerated.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["r2"],
    whatSuccessMeans:
      "ARTIFACTS_BUCKET is bound and reachable, so uploads can be stored (fetch-remote.ts `put`) and " +
      "extraction can read them back (extraction.ts `get`). Document download links resolve.",
    whatFailureMeans:
      "Every document upload fails and every existing document 404s on open. Extraction also fails, so " +
      "`extraction_status` starts filling with 'failed'. The binding is either absent from wrangler.jsonc " +
      "or points at a bucket that no longer exists on the account.",
    troubleshootingSteps:
      "1. Confirm the `r2_buckets` entry with binding `ARTIFACTS_BUCKET` exists in wrangler.jsonc. " +
      "2. Confirm the bucket still exists: `npx wrangler r2 bucket list`. " +
      "3. If the bucket_name in wrangler.jsonc is not in that list, it was renamed or deleted — the objects " +
      "are gone and every r2_object_key in supporting_documents is now dangling. " +
      "4. Redeploy after fixing config: `pnpm run deploy` from `main`. " +
      "5. Verify a real download at https://core-remodel.hacolby.workers.dev/admin/documents",
    devOpsPlaybook:
      "Binding/config fault — fix wrangler.jsonc, merge, `pnpm run deploy`, then confirm with " +
      "`npx wrangler deployments list | tail -20`. Previews share production's R2 bucket by id, so a " +
      "preview failing here means the config is wrong, not that the preview is isolated. If the bucket was " +
      "genuinely deleted, do not mass-delete the D1 rows — they still carry title, extracted text and " +
      "associations that are worth keeping while you decide.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!env.ARTIFACTS_BUCKET) {
        return failure(
          "ARTIFACTS_BUCKET binding is absent. Document uploads, downloads and text extraction are all " +
            "broken. Check `r2_buckets` in wrangler.jsonc.",
        );
      }
      // `head` on a key that need not exist: proves reachability, transfers no body.
      await env.ARTIFACTS_BUCKET.head("health/probe");
      const listing = await env.ARTIFACTS_BUCKET.list({ limit: 1 });
      return ok(
        `ARTIFACTS_BUCKET answered head + list(limit:1); ${listing.objects.length} object sampled` +
          `${listing.truncated ? " (bucket has more)" : ""}.`,
      );
    },
  }),

  defineProbe({
    name: "documents_storage_pointer_integrity",
    displayName: "Document storage-pointer integrity",
    description:
      "Counts active supporting_documents rows that have neither an r2_object_key nor an external_url — " +
      "documents with no retrievable bytes anywhere.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every active document row points at something: an object in R2, or an external URL. Clicking any " +
      "document in the library retrieves content.",
    whatFailureMeans:
      "Rows exist that list fine but 404 on open. This happens when an upload's D1 insert succeeded and the " +
      "R2 `put` did not (D1 has no transactions, so the two are not atomic — the insert-then-store path relies " +
      "on a compensating delete that evidently did not fire), or when a row was created by a metadata-only " +
      "import that was supposed to be followed by a byte fetch that never ran.",
    troubleshootingSteps:
      "1. List them: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, title, source_type, datetime_created FROM supporting_documents WHERE is_active = 1 AND (r2_object_key IS NULL OR r2_object_key = '') AND (external_url IS NULL OR external_url = '') LIMIT 25\"`. " +
      "2. Check whether they cluster in time — a burst means one broken upload run, not a chronic bug. " +
      "3. Re-upload the bytes if the source is still available; otherwise soft-delete by setting `is_active = 0` " +
      "rather than hard-deleting (associations and extracted text stay recoverable). " +
      "4. Fix the writer: src/backend/services/documents/fetch-remote.ts does the R2 `put`; confirm its failure " +
      "path deletes the D1 row it just wrote. 5. Re-run this probe.",
    devOpsPlaybook:
      "Not urgent unless the count is climbing — a climbing count means the upload path is actively producing " +
      "broken rows, so fix the writer before cleaning data. Any cleanup here is a data change: record the before/" +
      "after counts in the changelog entry. Never use raw `wrangler d1 execute --file` to bulk-mutate; go through " +
      "a migration or an explicit, reviewed one-off.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "supporting_documents"))) {
        return failure(
          "Table supporting_documents does not exist on this D1 — every /api/supporting-documents route " +
            "will 500. Run `pnpm run migrate:remote`.",
        );
      }
      const active = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE is_active = 1",
      );
      const noBytes = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE is_active = 1 " +
          "AND (r2_object_key IS NULL OR r2_object_key = '') " +
          "AND (external_url IS NULL OR external_url = '')",
      );
      const details = `${noBytes} of ${active} active document(s) have neither an r2_object_key nor an external_url.`;
      return noBytes > 0 ? degraded(details) : ok(details);
    },
  }),

  defineProbe({
    name: "documents_association_integrity",
    displayName: "Document association integrity",
    description:
      "Counts document_entity_associations rows whose document_id no longer resolves to a " +
      "supporting_documents row, plus rows with an empty entity_type/entity_id.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every association points at a real document and names a real entity, so the 'documents for this room / " +
      "company / estimate' panels return complete lists.",
    whatFailureMeans:
      "Orphaned associations mean the `ON DELETE CASCADE` on document_id did not run (rows inserted against a " +
      "document id that never existed, or a table rebuilt with FKs effectively off). Associations with a blank " +
      "entity_type or entity_id are worse — they are a caller writing a placeholder instead of rejecting a " +
      "request with a missing parent, which is the single most repeated data bug in this repo.",
    troubleshootingSteps:
      "1. List orphans: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT a.id, a.document_id, a.entity_type, a.entity_id FROM document_entity_associations a LEFT JOIN supporting_documents d ON d.id = a.document_id WHERE d.id IS NULL LIMIT 25\"`. " +
      "2. Orphans are safe to delete — the document they described is gone. " +
      "3. For blank entity_type/entity_id, find the writer (grep `document_entity_associations` under " +
      "src/backend/api/routes/) and make it return 400 when the parent is missing rather than inserting a placeholder. " +
      "4. Re-run this probe after both fixes.",
    devOpsPlaybook:
      "Low urgency, high signal: a non-zero count here is almost always a writer bug rather than corruption. Fix " +
      "the writer, ship it, then clean the rows in the same PR and note the counts in the changelog entry.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      const haveAssoc = await tableExists(env.DB, "document_entity_associations");
      const haveDocs = await tableExists(env.DB, "supporting_documents");
      if (!haveAssoc || !haveDocs) {
        return failure(
          `Missing table(s): ${!haveAssoc ? "document_entity_associations " : ""}${!haveDocs ? "supporting_documents" : ""}`.trim() +
            " — run `pnpm run migrate:remote`.",
        );
      }
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM document_entity_associations");
      const orphans = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM document_entity_associations a " +
          "LEFT JOIN supporting_documents d ON d.id = a.document_id WHERE d.id IS NULL",
      );
      const blank = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM document_entity_associations " +
          "WHERE entity_type IS NULL OR entity_type = '' OR entity_id IS NULL OR entity_id = ''",
      );
      const details = `${total} association(s); ${orphans} orphaned (document gone), ${blank} with a blank entity_type/entity_id.`;
      return orphans > 0 || blank > 0 ? degraded(details) : ok(details);
    },
  }),

  defineProbe({
    name: "documents_extraction_pipeline",
    displayName: "Document extraction pipeline",
    description:
      "Buckets supporting_documents by extraction_status, surfacing 'failed' rows and a pending backlog. " +
      "Extraction (env.AI.toMarkdown) is what fills extracted_text for keyword search and embeddings.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `Fewer than ${EXTRACTION_FAILED_DEGRADED_AT} documents in extraction_status='failed' and no large ` +
      "pending backlog. Document text search returns real results because extracted_text is populated.",
    whatFailureMeans:
      "Documents are in the library but not searchable. A pile of 'failed' means the parse step is erroring — " +
      "PDF parsing on Workers must go through env.AI.toMarkdown (native parsers like @llamaindex/liteparse " +
      "cannot run here), so a recent change to that path is the first suspect. A pending backlog that never " +
      "drains means the extraction job stopped being triggered at all.",
    troubleshootingSteps:
      "1. Get the breakdown from the details string, then list failures: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, title, source_type, mime_type FROM supporting_documents WHERE extraction_status = 'failed' LIMIT 25\"`. " +
      "2. Look for a single mime_type dominating — that points at one parser path, not a systemic outage. " +
      "3. Watch a live re-extraction with `npx wrangler tail` while re-uploading one failing document. " +
      "4. Check src/backend/services/documents/extraction.ts — it `get`s the object from ARTIFACTS_BUCKET first, " +
      "so a failing documents_r2_bucket_reachable probe explains this one entirely; fix that first. " +
      "5. Re-extract only the failed ids, not the whole library.",
    devOpsPlaybook:
      "Re-extraction runs Workers AI and costs money per document — never mass-retry as a first move. Fix one " +
      "document end to end, confirm extracted_text is populated, then batch the rest. Never degrade a failed " +
      "parse to an empty result silently; if you touch extraction.ts, keep the error written to the row so this " +
      "probe can still see it.",
    isBillingRisk: true,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "supporting_documents"))) {
        return failure(
          "Table supporting_documents does not exist on this D1 — run `pnpm run migrate:remote`.",
        );
      }
      const failed = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE extraction_status = 'failed'",
      );
      const pending = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE extraction_status = 'pending'",
      );
      const processing = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE extraction_status = 'processing'",
      );
      const complete = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE extraction_status = 'complete'",
      );
      const details =
        `extraction_status — failed: ${failed}, pending: ${pending}, processing: ${processing}, complete: ${complete}.`;
      if (failed >= EXTRACTION_FAILED_DEGRADED_AT) {
        return degraded(
          `${details} ${failed} failures is at or above the ${EXTRACTION_FAILED_DEGRADED_AT} threshold.`,
        );
      }
      if (processing > 0 && complete === 0) {
        return degraded(`${details} Rows are stuck in 'processing' with nothing ever completing.`);
      }
      return ok(details);
    },
  }),

  defineProbe({
    name: "documents_library_population",
    displayName: "Document library population",
    description:
      "Sanity floor on supporting_documents: the table exists and holds at least a handful of active rows.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `supporting_documents exists with at least ${DOCUMENT_COUNT_FLOOR} active row(s). /admin/documents and ` +
      "the per-entity document panels have content to show.",
    whatFailureMeans:
      "A missing table means an unapplied migration and 500s on every /api/supporting-documents route. A count " +
      "that collapsed to near zero means rows were destroyed — on D1 a drizzle column-drop rebuilds the table " +
      "and fires ON DELETE CASCADE on the way through, and `PRAGMA foreign_keys=OFF` is a no-op in wrangler, so " +
      "child data can be wiped by what looked like a harmless schema tweak.",
    troubleshootingSteps:
      "1. Missing table → `pnpm run migrate:remote`, then verify: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT COUNT(*) FROM supporting_documents\"`. " +
      "2. Count collapsed → check the migrations applied since the last known-good count (the changelog entry " +
      "for the most recent documents PR records it) and look for a table rebuild. " +
      "3. Check whether the rows were soft-deleted instead: `SELECT COUNT(*) FROM supporting_documents WHERE is_active = 0`. " +
      "4. Inspect https://core-remodel.hacolby.workers.dev/admin/documents",
    devOpsPlaybook:
      "If the count really dropped, treat it as data loss: stop deploying, capture counts, and identify the " +
      "migration. The safe pattern for a destructive D1 schema change is backup → rebuild → restore; if that was " +
      "skipped, the R2 objects usually still exist even when the rows do not, so recovery is possible from the bucket.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "supporting_documents"))) {
        return failure(
          "Table supporting_documents does not exist on this D1 — run `pnpm run migrate:remote` and verify " +
            "the table exists on remote before deploying code that reads it.",
        );
      }
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM supporting_documents");
      const active = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM supporting_documents WHERE is_active = 1",
      );
      const details = `${total} document row(s), ${active} active.`;
      return active < DOCUMENT_COUNT_FLOOR
        ? degraded(`${details} Below the expected floor of ${DOCUMENT_COUNT_FLOOR} active documents.`)
        : ok(details);
    },
  }),
];
