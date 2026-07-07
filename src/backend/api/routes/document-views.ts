/**
 * @fileoverview Document saved-views API — `/api/document-views` (Phase 2, P2-02).
 *
 * NOTE on mount path: the roadmap brief originally named this
 * `/api/documents/views`, but `/api/documents` is already mounted to the
 * unrelated PlateJS rich-text notes router (`src/backend/api/routes/documents.ts`,
 * see `src/backend/api/index.ts:144`). To avoid colliding with that domain,
 * this router is mounted at the distinct top-level path `/api/document-views`
 * (see `src/backend/api/index.ts`).
 *
 * Endpoints:
 *   GET    /api/document-views          list views (public callers: visibility="public" only)
 *   GET    /api/document-views/:slug    one view + its resolved member documents
 *   POST   /api/document-views          create a view (guarded)
 *   PATCH  /api/document-views/:id      update a view (guarded)
 *   DELETE /api/document-views/:id      delete a view (guarded)
 *
 * View-visibility precedence rule (see document_saved_views.ts schema comment):
 * a `visibility: "public"` view exposes its member documents even when an
 * individual document's own `visibility` is `"private"`. A `visibility: "private"`
 * view is admin-only regardless of member document visibility.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { documentEntityAssociations, documentSavedViews, supportingDocuments } from "@backend/db";
import {
  escapeLikeTerm,
  likeEscaped,
  selectDocumentsByIds,
} from "@backend/services/documents/db-helpers";
import { isRequestAuthenticated, requireAccessAuth } from "@backend/utils/access";

export const documentViewsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Shared Zod schemas (hand-written — Zod v4, no drizzle-zod per house rule)
// ---------------------------------------------------------------------------

const ViewKind = z.enum(["static", "dynamic"]);
const ViewVisibility = z.enum(["private", "public"]);

const DocumentFiltersSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    sourceType: z.string().optional(),
    docType: z.string().optional(),
    visibility: ViewVisibility.optional(),
    entityType: z.enum(["company", "brand", "product", "showroom", "permit", "floor"]).optional(),
    entityId: z.string().optional(),
    search: z.string().optional(),
  })
  .strict();

const DocumentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: z.string(),
  mimeType: z.string().nullable(),
  docType: z.string().nullable(),
  visibility: z.enum(["private", "public"]),
  tags: z.array(z.string()),
  r2Url: z.string().nullable(),
  externalUrl: z.string().nullable(),
  description: z.string().nullable(),
  extractionStatus: z.string(),
  createdAt: z.number().nullable(),
});

const ViewSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: ViewKind,
  filtersJson: z.string().nullable(),
  docIdsJson: z.string().nullable(),
  visibility: ViewVisibility,
  sortOrder: z.number().int(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
});

const ViewWithDocsSchema = ViewSchema.extend({
  documents: z.array(DocumentSummarySchema),
});

const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }),
});

const CreateViewBodySchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
    name: z.string().min(1),
    description: z.string().optional(),
    kind: ViewKind,
    filters: DocumentFiltersSchema.optional(),
    docIds: z.array(z.string()).optional(),
    visibility: ViewVisibility.optional().default("private"),
    sortOrder: z.number().int().optional().default(0),
  })
  .strict();

const UpdateViewBodySchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    kind: ViewKind.optional(),
    filters: DocumentFiltersSchema.optional(),
    docIds: z.array(z.string()).optional(),
    visibility: ViewVisibility.optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

const MutationResponseSchema = z.object({
  success: z.literal(true),
  view: ViewSchema,
  warnings: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Filters = z.infer<typeof DocumentFiltersSchema>;

function parseFilters(raw: string | null): Filters {
  if (!raw) return {};
  try {
    const parsed = DocumentFiltersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function parseDocIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseTagsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toDocumentSummary(row: typeof supportingDocuments.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.sourceType,
    mimeType: row.mimeType,
    docType: row.docType,
    visibility: (row.visibility as "private" | "public") || "private",
    tags: parseTagsJson(row.tagsJson),
    r2Url: row.r2Url,
    externalUrl: row.externalUrl,
    description: row.description,
    extractionStatus: row.extractionStatus,
    createdAt: row.datetimeCreated ? Math.floor(new Date(row.datetimeCreated).getTime() / 1000) : null,
  };
}

/**
 * Resolves the member documents for a view given its kind/filters/docIds,
 * applying the view-visibility precedence rule: if the view itself is
 * public, ALL member docs are returned regardless of the document's own
 * visibility; if the view is private, member docs are only returned to
 * authenticated callers (the caller-level visibility gate is applied by
 * the route handler before calling this, via the `viewIsExposed` check).
 */
async function resolveViewDocuments(
  db: ReturnType<typeof drizzle>,
  view: typeof documentSavedViews.$inferSelect,
): Promise<(typeof supportingDocuments.$inferSelect)[]> {
  if (view.kind === "static") {
    const docIds = parseDocIds(view.docIdsJson);
    if (docIds.length === 0) return [];
    // Chunked — docIds is user-authored and D1 caps bound params at 100.
    return selectDocumentsByIds(db, docIds);
  }

  // dynamic
  const filters = parseFilters(view.filtersJson);
  const conditions = [eq(supportingDocuments.isActive, true)];

  if (filters.sourceType) {
    conditions.push(eq(supportingDocuments.sourceType, filters.sourceType));
  }
  if (filters.docType) {
    conditions.push(eq(supportingDocuments.docType, filters.docType));
  }
  if (filters.visibility) {
    conditions.push(eq(supportingDocuments.visibility, filters.visibility));
  }
  if (filters.search) {
    const likePattern = `%${escapeLikeTerm(filters.search)}%`;
    conditions.push(
      or(
        likeEscaped(supportingDocuments.title, likePattern),
        likeEscaped(supportingDocuments.description, likePattern),
        likeEscaped(supportingDocuments.extractedText, likePattern),
      )!,
    );
  }

  let rows = await db
    .select()
    .from(supportingDocuments)
    .where(and(...conditions))
    .all();

  if (filters.tags && filters.tags.length > 0) {
    const wantedTags = new Set(filters.tags);
    rows = rows.filter((row) => parseTagsJson(row.tagsJson).some((t) => wantedTags.has(t)));
  }

  if (filters.entityType && filters.entityId) {
    const assocRows = await db
      .select({ documentId: documentEntityAssociations.documentId })
      .from(documentEntityAssociations)
      .where(
        and(
          eq(documentEntityAssociations.entityType, filters.entityType),
          eq(documentEntityAssociations.entityId, filters.entityId),
        ),
      )
      .all();
    const allowedIds = new Set(assocRows.map((r) => r.documentId));
    rows = rows.filter((row) => allowedIds.has(row.id));
  }

  return rows;
}

/**
 * Amber warning rules for POST/PATCH responses:
 * (a) dynamic public view whose filters don't pin visibility:"public" —
 *     may expose private documents.
 * (b) static public view containing docs with visibility:"private" — lists
 *     which titles.
 */
async function buildWarnings(
  db: ReturnType<typeof drizzle>,
  view: typeof documentSavedViews.$inferSelect,
): Promise<string[]> {
  const warnings: string[] = [];
  if (view.visibility !== "public") return warnings;

  if (view.kind === "dynamic") {
    const filters = parseFilters(view.filtersJson);
    if (filters.visibility !== "public") {
      warnings.push(
        "Dynamic public view does not filter to public documents — private documents may be exposed",
      );
    }
  } else {
    const docIds = parseDocIds(view.docIdsJson);
    if (docIds.length > 0) {
      // Chunked — docIds is user-authored and D1 caps bound params at 100.
      const rows = await selectDocumentsByIds(db, docIds);
      const privateTitles = rows.filter((r) => r.visibility === "private").map((r) => r.title);
      if (privateTitles.length > 0) {
        warnings.push(
          `Static public view contains private documents: ${privateTitles.join(", ")}`,
        );
      }
    }
  }

  return warnings;
}

function serializeView(row: typeof documentSavedViews.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind as "static" | "dynamic",
    filtersJson: row.filtersJson,
    docIdsJson: row.docIdsJson,
    visibility: row.visibility as "private" | "public",
    sortOrder: row.sortOrder,
    createdAt: row.createdAt ? Math.floor(new Date(row.createdAt).getTime() / 1000) : null,
    updatedAt: row.updatedAt ? Math.floor(new Date(row.updatedAt).getTime() / 1000) : null,
  };
}

// ---------------------------------------------------------------------------
// GET / — list views
// ---------------------------------------------------------------------------

documentViewsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "listDocumentViews",
    summary: "List document saved views",
    tags: ["document-views"],
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              count: z.number().int(),
              views: z.array(ViewWithDocsSchema),
            }),
          },
        },
        description: "List of views (with resolved member documents)",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const authenticated = await isRequestAuthenticated(c.req.raw, c.env);

      const rows = authenticated
        ? await db.select().from(documentSavedViews).all()
        : await db
            .select()
            .from(documentSavedViews)
            .where(eq(documentSavedViews.visibility, "public"))
            .all();

      const views = await Promise.all(
        rows.map(async (row) => {
          const docs = await resolveViewDocuments(db, row);
          // Precedence rule: a public view exposes member docs regardless of
          // their own visibility; a private view (only reachable here by an
          // authenticated caller) exposes everything it resolves to.
          return {
            ...serializeView(row),
            documents: docs.map(toDocumentSummary),
          };
        }),
      );

      return c.json({ success: true as const, count: views.length, views }, 200);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to list document views",
            details: error instanceof Error ? error.message : "Unknown error",
          },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:slug — one view + resolved docs
// ---------------------------------------------------------------------------

documentViewsRouter.openapi(
  createRoute({
    method: "get",
    path: "/{slug}",
    operationId: "getDocumentView",
    summary: "Get a single document saved view by slug",
    tags: ["document-views"],
    request: {
      params: z.object({ slug: z.string() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ success: z.literal(true), view: ViewWithDocsSchema }) } },
        description: "The view and its resolved member documents",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "View not found (or not visible to this caller)",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const slug = c.req.param("slug");
      const authenticated = await isRequestAuthenticated(c.req.raw, c.env);

      const view = await db
        .select()
        .from(documentSavedViews)
        .where(eq(documentSavedViews.slug, slug))
        .get();

      if (!view || (!authenticated && view.visibility !== "public")) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Document view not found" } },
          404,
        );
      }

      const docs = await resolveViewDocuments(db, view);

      return c.json(
        {
          success: true as const,
          view: { ...serializeView(view), documents: docs.map(toDocumentSummary) },
        },
        200,
      );
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to load document view",
            details: error instanceof Error ? error.message : "Unknown error",
          },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// POST / — create a view (guarded)
// ---------------------------------------------------------------------------

documentViewsRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    operationId: "createDocumentView",
    summary: "Create a document saved view",
    tags: ["document-views"],
    middleware: [requireAccessAuth] as const,
    request: {
      body: {
        content: { "application/json": { schema: CreateViewBodySchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: MutationResponseSchema } },
        description: "View created",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid body / duplicate slug",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const body = c.req.valid("json");

      const existing = await db
        .select()
        .from(documentSavedViews)
        .where(eq(documentSavedViews.slug, body.slug))
        .get();
      if (existing) {
        return c.json(
          { error: { code: "DUPLICATE_SLUG", message: `A view with slug "${body.slug}" already exists` } },
          400,
        );
      }

      const now = new Date();
      const insertRows = await db
        .insert(documentSavedViews)
        .values({
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          kind: body.kind,
          filtersJson: body.filters ? JSON.stringify(body.filters) : null,
          docIdsJson: body.docIds && body.docIds.length > 0 ? JSON.stringify(body.docIds) : null,
          visibility: body.visibility ?? "private",
          sortOrder: body.sortOrder ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const insertResult = insertRows[0];
      if (!insertResult) {
        return c.json(
          { error: { code: "INTERNAL_ERROR", message: "Failed to create document view" } },
          500,
        );
      }

      const warnings = await buildWarnings(db, insertResult);

      return c.json(
        { success: true as const, view: serializeView(insertResult), warnings },
        201,
      );
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to create document view",
            details: error instanceof Error ? error.message : "Unknown error",
          },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id — update a view (guarded)
// ---------------------------------------------------------------------------

documentViewsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    operationId: "updateDocumentView",
    summary: "Update a document saved view",
    tags: ["document-views"],
    middleware: [requireAccessAuth] as const,
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: { "application/json": { schema: UpdateViewBodySchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: MutationResponseSchema } },
        description: "View updated",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid body / duplicate slug",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "View not found",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const id = c.req.valid("param").id;
      const body = c.req.valid("json");

      const existing = await db.select().from(documentSavedViews).where(eq(documentSavedViews.id, id)).get();
      if (!existing) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document view not found" } }, 404);
      }

      if (body.slug && body.slug !== existing.slug) {
        const slugTaken = await db
          .select()
          .from(documentSavedViews)
          .where(eq(documentSavedViews.slug, body.slug))
          .get();
        if (slugTaken) {
          return c.json(
            { error: { code: "DUPLICATE_SLUG", message: `A view with slug "${body.slug}" already exists` } },
            400,
          );
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.slug !== undefined) updates.slug = body.slug;
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;
      if (body.kind !== undefined) updates.kind = body.kind;
      if (body.filters !== undefined) updates.filtersJson = JSON.stringify(body.filters);
      if (body.docIds !== undefined) {
        updates.docIdsJson = body.docIds.length > 0 ? JSON.stringify(body.docIds) : null;
      }
      if (body.visibility !== undefined) updates.visibility = body.visibility;
      if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

      await db.update(documentSavedViews).set(updates).where(eq(documentSavedViews.id, id)).run();

      const updated = await db.select().from(documentSavedViews).where(eq(documentSavedViews.id, id)).get();
      if (!updated) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document view not found" } }, 404);
      }

      const warnings = await buildWarnings(db, updated);

      return c.json({ success: true as const, view: serializeView(updated), warnings }, 200);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to update document view",
            details: error instanceof Error ? error.message : "Unknown error",
          },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /:id — delete a view (guarded)
// ---------------------------------------------------------------------------

documentViewsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    operationId: "deleteDocumentView",
    summary: "Delete a document saved view",
    tags: ["document-views"],
    middleware: [requireAccessAuth] as const,
    request: {
      params: z.object({ id: z.coerce.number().int() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
        description: "View deleted",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "View not found",
      },
      500: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Server error",
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const id = c.req.valid("param").id;

      const existing = await db.select().from(documentSavedViews).where(eq(documentSavedViews.id, id)).get();
      if (!existing) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document view not found" } }, 404);
      }

      await db.delete(documentSavedViews).where(eq(documentSavedViews.id, id)).run();

      return c.json({ success: true as const }, 200);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to delete document view",
            details: error instanceof Error ? error.message : "Unknown error",
          },
        },
        500,
      );
    }
  },
);
