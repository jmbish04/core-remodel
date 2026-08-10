/**
 * @fileoverview Admin surface for the Drive ingestion service: list/add roots,
 * trigger a scan by hand, and read the catalogue.
 */
import { driveDocuments, driveFolders, driveRoots, driveUseCases } from "@backend/db";
import {
  ingestAllActiveRoots,
  ingestDriveFolder,
  ScanInProgressError,
} from "@backend/services/google/drive-ingest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

export const driveIngestRouter = new Hono<{ Bindings: Env }>();

/** Hand-written Zod (never drizzle-zod — it breaks the esbuild build). */
const createRootSchema = z.object({
  // Drive file ids are base64url-ish. Validate the charset HERE, at the trust
  // boundary: the id is interpolated straight into the Drive `q` parameter
  // (`'<id>' in parents`), so an unvalidated quote or space would rewrite that
  // query rather than fail.
  driveFolderId: z.string().regex(/^[A-Za-z0-9_-]{10,}$/, "not a Drive folder id"),
  label: z.string().min(1),
  useCaseKey: z.enum(["EMAIL_ONBOARDING_MATERIALS", "DEEP_RESEARCH_FINDINGS"]),
});

/** Omitted rootId means "ingest every active root" — see the handler below. */
const ingestBodySchema = z.object({
  rootId: z.number().int().positive().optional(),
});

driveIngestRouter.get("/roots", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: driveRoots.id,
      driveFolderId: driveRoots.driveFolderId,
      label: driveRoots.label,
      isActive: driveRoots.isActive,
      lastScannedAt: driveRoots.lastScannedAt,
      useCase: driveUseCases.key,
    })
    .from(driveRoots)
    .innerJoin(driveUseCases, eq(driveRoots.useCaseId, driveUseCases.id));
  return c.json({ roots: rows });
});

driveIngestRouter.post("/roots", async (c) => {
  const parsed = createRootSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const db = drizzle(c.env.DB);
  const [useCase] = await db
    .select()
    .from(driveUseCases)
    .where(eq(driveUseCases.key, parsed.data.useCaseKey))
    .limit(1);
  if (!useCase) return c.json({ error: `unknown use case ${parsed.data.useCaseKey}` }, 400);
  const [row] = await db
    .insert(driveRoots)
    .values({
      driveFolderId: parsed.data.driveFolderId,
      label: parsed.data.label,
      useCaseId: useCase.id,
    })
    .returning({ id: driveRoots.id });
  return c.json({ id: row?.id }, 201);
});

/**
 * Trigger a scan.
 *
 * ponytail: the scan runs SYNCHRONOUSLY inside this request. Known ceiling —
 * a Worker allows ~1000 subrequests per invocation, and a scan costs one
 * Drive `files.list` per folder plus one export per Google-native file with no
 * `driveModifiedAt` short-circuit. The two configured roots are 72 and 87
 * nodes, so this is comfortably fine today and a request is far the simplest
 * thing that works. A root over ~1000 files WILL blow the subrequest limit and
 * fail the scan wholesale, not partially. Upgrade path when that day comes:
 * move the body of `ingestDriveFolder` into a Cloudflare Workflow (one step per
 * folder page) and make this route enqueue it and return 202 — the scan lease
 * added below already makes a long-running background scan safe to overlap
 * with the cron.
 */
driveIngestRouter.post("/ingest", async (c) => {
  const parsed = ingestBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { rootId } = parsed.data;

  if (rootId === undefined) {
    return c.json({ summaries: await ingestAllActiveRoots(c.env) });
  }

  // A syntactically valid id for a root that doesn't exist is a distinct
  // failure from malformed input — check first so it 404s instead of letting
  // ingestDriveFolder's throw fall through to the app's generic 500.
  const db = drizzle(c.env.DB);
  const [root] = await db
    .select({ id: driveRoots.id })
    .from(driveRoots)
    .where(eq(driveRoots.id, rootId))
    .limit(1);
  if (!root) return c.json({ error: `no drive root with id ${rootId}` }, 404);

  try {
    return c.json({ summaries: [await ingestDriveFolder(c.env, rootId)] });
  } catch (err) {
    // Another scan (the 11:00 cron, or a second click) holds this root's lease.
    // That is a conflict, not a server fault.
    if (err instanceof ScanInProgressError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

driveIngestRouter.get("/documents", async (c) => {
  const db = drizzle(c.env.DB);
  const rootId = Number(c.req.query("rootId"));
  if (!Number.isFinite(rootId)) return c.json({ error: "rootId is required" }, 400);

  const folderIdParam = c.req.query("folderId");
  let folderId: number | undefined;
  if (folderIdParam !== undefined) {
    folderId = Number(folderIdParam);
    if (!Number.isFinite(folderId)) return c.json({ error: "folderId must be numeric" }, 400);
  }

  const conditions = [
    eq(driveDocuments.rootId, rootId),
    eq(driveDocuments.isActive, true),
    eq(driveDocuments.isDeleted, false),
  ];
  if (folderId !== undefined) conditions.push(eq(driveDocuments.folderId, folderId));

  // Folder NAME comes from a join — it is never denormalized onto the doc row.
  const rows = await db
    .select({
      id: driveDocuments.id,
      // The row's own Drive id. Returned so a caller (and the QC harness) can
      // check the one-live-row-per-Drive-id invariant from outside.
      driveId: driveDocuments.driveId,
      name: driveDocuments.name,
      mimeType: driveDocuments.mimeType,
      sizeBytes: driveDocuments.sizeBytes,
      webViewUrl: driveDocuments.webViewUrl,
      sharing: driveDocuments.sharing,
      // The document's own FK, not a copy of another table's data — fine to
      // return alongside the joined folderName.
      folderId: driveDocuments.folderId,
      folderName: driveFolders.name,
    })
    .from(driveDocuments)
    .innerJoin(driveFolders, eq(driveDocuments.folderId, driveFolders.id))
    .where(and(...conditions));
  return c.json({ documents: rows });
});
