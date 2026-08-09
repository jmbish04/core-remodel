/**
 * @fileoverview Admin surface for the Drive ingestion service: list/add roots,
 * trigger a scan by hand, and read the catalogue.
 */
import { driveDocuments, driveFolders, driveRoots, driveUseCases } from "@backend/db";
import { ingestAllActiveRoots, ingestDriveFolder } from "@backend/services/google/drive-ingest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

export const driveIngestRouter = new Hono<{ Bindings: Env }>();

/** Hand-written Zod (never drizzle-zod — it breaks the esbuild build). */
const createRootSchema = z.object({
  driveFolderId: z.string().min(10),
  label: z.string().min(1),
  useCaseKey: z.enum(["EMAIL_ONBOARDING_MATERIALS", "DEEP_RESEARCH_FINDINGS"]),
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

driveIngestRouter.post("/ingest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rootId?: number };
  const summaries = body.rootId
    ? [await ingestDriveFolder(c.env, body.rootId)]
    : await ingestAllActiveRoots(c.env);
  return c.json({ summaries });
});

driveIngestRouter.get("/documents", async (c) => {
  const db = drizzle(c.env.DB);
  const rootId = Number(c.req.query("rootId"));
  if (!Number.isFinite(rootId)) return c.json({ error: "rootId is required" }, 400);
  // Folder NAME comes from a join — it is never denormalized onto the doc row.
  const rows = await db
    .select({
      id: driveDocuments.id,
      name: driveDocuments.name,
      mimeType: driveDocuments.mimeType,
      sizeBytes: driveDocuments.sizeBytes,
      webViewUrl: driveDocuments.webViewUrl,
      sharing: driveDocuments.sharing,
      folderName: driveFolders.name,
    })
    .from(driveDocuments)
    .innerJoin(driveFolders, eq(driveDocuments.folderId, driveFolders.id))
    .where(
      and(
        eq(driveDocuments.rootId, rootId),
        eq(driveDocuments.isActive, true),
        eq(driveDocuments.isDeleted, false),
      ),
    );
  return c.json({ documents: rows });
});
