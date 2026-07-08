/**
 * @fileoverview Admin API for Artifact Studio (0016 §4.3).
 *
 * `GET/PATCH/DELETE /api/studio*` — admin-gated reads + mutations backing the
 * `/admin/studio` gallery and `/admin/studio/[slug]` viewer. Artifact CREATION
 * and REVISION happen through the MCP `artifacts` tools (from a chat), not here;
 * these routes cover browsing, renaming, publish/archive, delete, and an
 * open-counter bump.
 *
 * Mounted at `/api/studio` (NOT `/api/artifacts`, which already serves raw R2
 * objects by key). The `/studio-runtime` iframe does NOT fetch source through
 * this router — it is SSR'd with the source inlined (the same-site iframe
 * navigation carries the admin cookie), so artifact source is never exposed on
 * a public endpoint. A cookie-gated `GET /:slug/source` is provided for
 * debugging only.
 */
import { artifactRevisions, artifacts } from "@backend/db";
import { isRequestAuthenticated } from "@backend/utils/access";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const studioRouter = new Hono<{ Bindings: Env }>();

/** Gate every route behind the admin cookie / bearer auth. */
studioRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/studio — gallery list (id, slug, title, kind, status, counts). */
studioRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  // Single query: left-join the revision count so a 0-revision artifact still
  // shows (no second query + in-memory merge).
  const rows = await db
    .select({
      id: artifacts.id,
      slug: artifacts.slug,
      title: artifacts.title,
      description: artifacts.description,
      kind: artifacts.kind,
      status: artifacts.status,
      openCount: artifacts.openCount,
      updatedAt: artifacts.updatedAt,
      revisionCount: sql<number>`count(${artifactRevisions.id})`,
    })
    .from(artifacts)
    .leftJoin(artifactRevisions, eq(artifacts.id, artifactRevisions.artifactId))
    .groupBy(artifacts.id)
    .orderBy(desc(artifacts.updatedAt))
    .all();
  return c.json({
    count: rows.length,
    artifacts: rows.map((r) => ({ ...r, revisionCount: Number(r.revisionCount) })),
  });
});

/** GET /api/studio/:slug — metadata + selected revision + revision list. */
studioRouter.get("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.slug, slug)).limit(1);
  if (!artifact) return c.json({ error: "Not found" }, 404);

  const revisionParam = Number(c.req.query("revision"));
  const revisions = await db
    .select()
    .from(artifactRevisions)
    .where(eq(artifactRevisions.artifactId, artifact.id))
    .orderBy(desc(artifactRevisions.revisionNumber))
    .all();
  const current =
    Number.isFinite(revisionParam) && revisionParam > 0
      ? revisions.find((r) => r.revisionNumber === revisionParam)
      : (revisions.find((r) => r.id === artifact.currentRevisionId) ?? revisions[0]);

  return c.json({
    ...artifact,
    revision: current ?? null,
    revisions: revisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      changeNote: r.changeNote,
      createdAt: r.createdAt,
    })),
  });
});

/** GET /api/studio/:slug/source — raw TSX (cookie-gated, debug only). */
studioRouter.get("/:slug/source", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.slug, slug)).limit(1);
  if (!artifact) return c.json({ error: "Not found" }, 404);
  const [rev] = await db
    .select()
    .from(artifactRevisions)
    .where(eq(artifactRevisions.id, artifact.currentRevisionId ?? -1))
    .limit(1);
  return c.text(rev?.sourceTsx ?? "", 200, { "Content-Type": "text/plain; charset=utf-8" });
});

/** POST /api/studio/:slug/open — bump the open counter (usage stat). */
studioRouter.post("/:slug/open", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  await db
    .update(artifacts)
    .set({ openCount: sql`${artifacts.openCount} + 1` })
    .where(eq(artifacts.slug, slug))
    .run();
  return c.json({ ok: true });
});

/** PATCH /api/studio/:slug — rename / re-describe / set status. */
studioRouter.patch("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    status?: "draft" | "published" | "archived";
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (body.status) patch.status = body.status;
  if (Object.keys(patch).length === 1) return c.json({ error: "No fields to update" }, 400);

  const [existing] = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(eq(artifacts.slug, slug))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await db.update(artifacts).set(patch).where(eq(artifacts.slug, slug)).run();
  return c.json({ ok: true });
});

/** DELETE /api/studio/:slug — remove the artifact + its revisions (cascade). */
studioRouter.delete("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const [existing] = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(eq(artifacts.slug, slug))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await db.delete(artifacts).where(eq(artifacts.slug, slug)).run();
  return c.json({ ok: true });
});

export default studioRouter;
