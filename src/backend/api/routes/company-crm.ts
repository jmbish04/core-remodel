/**
 * @fileoverview Company CRM — notes + todos (0013 roadmap P3-03 / P3-04)
 *
 * Mounts at `/api/companies` (see src/backend/api/index.ts), gated end-to-end
 * by `requireAccessAuth` — this is admin-only CRM data, no public read surface.
 *
 *   GET    /api/companies/notes/tags                  Distinct tags across ALL non-deleted notes
 *   GET    /api/companies/:companyId/notes           List notes (isDeleted=false, newest first)
 *   GET    /api/companies/:companyId/notes/:id        One note
 *   POST   /api/companies/:companyId/notes            Create a note
 *   PATCH  /api/companies/:companyId/notes/:id        Partial update
 *   DELETE /api/companies/:companyId/notes/:id        Soft-delete
 *
 *   GET    /api/companies/:companyId/todos            List todos (isDeleted=false, newest first, ?status=)
 *   GET    /api/companies/:companyId/todos/:id         One todo
 *   POST   /api/companies/:companyId/todos             Create a todo
 *   PATCH  /api/companies/:companyId/todos/:id         Partial update (incl. status transitions)
 *   DELETE /api/companies/:companyId/todos/:id         Soft-delete
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).
 *   - `drizzle(c.env.DB)` for every DB client — no global mutable state.
 *   - `content` is a JSON string of PlateJS Slate nodes; validated as a string
 *     that JSON.parses to an array, but stored/returned as the raw string —
 *     the frontend owns Slate (de)serialization.
 *   - `tagsJson` (DB column, JSON string) <-> `tags` (wire field, string[]) on
 *     BOTH company notes and company todos.
 *   - `dueDate` (DB column, Date | null) <-> wire field epoch-ms number | null.
 *   - Single company-existence lookup per request; 404s if missing.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { companies } from "@backend/db/schema/directory/companies";
import { companyNotes } from "@backend/db/schema/directory/company_notes";
import { companyTodos } from "@backend/db/schema/directory/company_todos";
import type {
  CompanyNote,
  CompanyNoteInsert,
} from "@backend/db/schema/directory/company_notes";
import type {
  CompanyTodo,
  CompanyTodoInsert,
} from "@backend/db/schema/directory/company_todos";

export const companyCrmRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Shared error envelope ────────────────────────────────────────────────────

const errorSchema = z.object({
  error: z.string(),
});

// ─── Param schemas ────────────────────────────────────────────────────────────

const companyIdParamSchema = z.object({
  companyId: z.string().regex(/^\d+$/, "companyId must be numeric"),
});

const noteIdParamSchema = companyIdParamSchema.extend({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

const todoIdParamSchema = companyIdParamSchema.extend({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

const todoStatusValues = ["open", "in_progress", "blocked", "done"] as const;
type TodoStatus = (typeof todoStatusValues)[number];

const todoListQuerySchema = z.object({
  status: z.enum(todoStatusValues).optional(),
});

// ─── Content validation ───────────────────────────────────────────────────────

/** `content` must be a string that JSON.parses to an array (PlateJS Slate nodes). */
const slateContentSchema = z.string().refine(
  (val) => {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed);
    } catch {
      return false;
    }
  },
  { message: "content must be a JSON string of an array (PlateJS Slate nodes)" },
);

// ─── Request body schemas ─────────────────────────────────────────────────────

/** Max number of tags retained per note (extras beyond this are dropped). */
const NOTE_TAGS_MAX = 20;

/** Array of trimmed, non-empty, deduped strings — capped at NOTE_TAGS_MAX. */
const noteTagsSchema = z.array(z.string().min(1)).max(NOTE_TAGS_MAX).optional();

const createNoteSchema = z.object({
  title: z.string().min(1),
  content: slateContentSchema,
  tags: noteTagsSchema,
});

const updateNoteSchema = z.object({
  title: z.string().min(1).optional(),
  content: slateContentSchema.optional(),
  tags: noteTagsSchema,
});

const createTodoSchema = z.object({
  title: z.string().min(1),
  content: slateContentSchema.optional().nullable(),
  status: z.enum(todoStatusValues).optional().default("open"),
  /** Epoch ms; converted to a Date for storage. */
  dueDate: z.number().int().optional().nullable(),
  owner: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

const updateTodoSchema = z.object({
  title: z.string().min(1).optional(),
  content: slateContentSchema.optional().nullable(),
  status: z.enum(todoStatusValues).optional(),
  dueDate: z.number().int().optional().nullable(),
  owner: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

// ─── Response schemas ─────────────────────────────────────────────────────────

const noteSchema = z.object({
  id: z.number(),
  companyId: z.number(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  isDeleted: z.boolean(),
  createdAt: z.union([z.date(), z.number()]).nullable(),
  updatedAt: z.union([z.date(), z.number()]).nullable(),
});

const todoSchema = z.object({
  id: z.number(),
  companyId: z.number(),
  title: z.string(),
  content: z.string().nullable(),
  status: z.enum(todoStatusValues),
  dueDate: z.number().nullable(),
  owner: z.string().nullable(),
  tags: z.array(z.string()),
  isDeleted: z.boolean(),
  createdAt: z.union([z.date(), z.number()]).nullable(),
  updatedAt: z.union([z.date(), z.number()]).nullable(),
});

// ─── Serialization helpers ─────────────────────────────────────────────────────

function toEpochMs(value: Date | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

/** Parse a `tagsJson` DB column into a `tags: string[]` wire value ([] when null/invalid). */
function parseTagsJson(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Trim, drop empties, dedupe, and cap at NOTE_TAGS_MAX — used on every write path. */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= NOTE_TAGS_MAX) break;
  }
  return out;
}

function serializeNote(row: CompanyNote) {
  const { tagsJson, ...rest } = row;
  return {
    ...rest,
    tags: parseTagsJson(tagsJson),
    createdAt: toEpochMs(row.createdAt),
    updatedAt: toEpochMs(row.updatedAt),
  };
}

function serializeTodo(row: CompanyTodo) {
  const { tagsJson, dueDate, createdAt, updatedAt, status, ...rest } = row;
  return {
    ...rest,
    status: status as TodoStatus,
    dueDate: toEpochMs(dueDate),
    tags: parseTagsJson(tagsJson),
    createdAt: toEpochMs(createdAt),
    updatedAt: toEpochMs(updatedAt),
  };
}

// ─── Company-existence guard ──────────────────────────────────────────────────

async function requireCompany(
  db: ReturnType<typeof drizzle>,
  companyId: number,
): Promise<boolean> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return Boolean(company);
}

// ════════════════════════════════════════════════════════════════════════════
// NOTES
// ════════════════════════════════════════════════════════════════════════════

// ─── GET /notes/tags — distinct tags across ALL non-deleted company notes ────
//
// Registered BEFORE the `/{companyId}/notes...` param routes. Final path is a
// 2-segment literal (`/notes/tags`) that can never collide with the 2- or
// 3-segment `{companyId}`-prefixed routes below (segment 2 there is always the
// literal "notes"/"todos", never "tags" as segment 1) — safe either way, but
// registration order is kept literal-first per convention.

companyCrmRouter.openapi(
  createRoute({
    method: "get",
    path: "/notes/tags",
    operationId: "listCompanyNoteTags",
    tags: ["Company CRM"],
    summary: "List distinct tags across all non-deleted company notes",
    responses: {
      200: {
        description: "Distinct company note tags (sorted)",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), tags: z.array(z.string()) }),
          },
        },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    try {
      const rows = await db
        .select({ tagsJson: companyNotes.tagsJson })
        .from(companyNotes)
        .where(and(eq(companyNotes.isDeleted, false), isNotNull(companyNotes.tagsJson)));

      const tagSet = new Set<string>();
      for (const row of rows) {
        for (const tag of parseTagsJson(row.tagsJson)) tagSet.add(tag);
      }

      return c.json({ success: true as const, tags: [...tagSet].sort() }, 200);
    } catch (err) {
      console.error("[company-crm] GET /notes/tags error:", err);
      return c.json({ error: "Failed to list note tags" }, 500);
    }
  },
);

// ─── GET /:companyId/notes — list ─────────────────────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "get",
    path: "/{companyId}/notes",
    operationId: "listCompanyNotes",
    tags: ["Company CRM"],
    summary: "List notes for a company (isDeleted=false, newest-updated first)",
    request: {
      params: companyIdParamSchema,
    },
    responses: {
      200: {
        description: "Company notes",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), notes: z.array(noteSchema) }),
          },
        },
      },
      404: {
        description: "Company not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const rows = await db
        .select()
        .from(companyNotes)
        .where(and(eq(companyNotes.companyId, companyIdNum), eq(companyNotes.isDeleted, false)))
        .orderBy(desc(companyNotes.updatedAt));

      return c.json({ success: true as const, notes: rows.map(serializeNote) }, 200);
    } catch (err) {
      console.error("[company-crm] GET /:companyId/notes error:", err);
      return c.json({ error: "Failed to list notes" }, 500);
    }
  },
);

// ─── GET /:companyId/notes/:id — one ──────────────────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "get",
    path: "/{companyId}/notes/{id}",
    operationId: "getCompanyNote",
    tags: ["Company CRM"],
    summary: "Get one company note",
    request: {
      params: noteIdParamSchema,
    },
    responses: {
      200: {
        description: "Company note",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), note: noteSchema }),
          },
        },
      },
      404: {
        description: "Company or note not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [row] = await db
        .select()
        .from(companyNotes)
        .where(
          and(
            eq(companyNotes.id, idNum),
            eq(companyNotes.companyId, companyIdNum),
            eq(companyNotes.isDeleted, false),
          ),
        )
        .limit(1);

      if (!row) return c.json({ error: "Note not found" }, 404);
      return c.json({ success: true as const, note: serializeNote(row) }, 200);
    } catch (err) {
      console.error("[company-crm] GET /:companyId/notes/:id error:", err);
      return c.json({ error: "Failed to get note" }, 500);
    }
  },
);

// ─── POST /:companyId/notes — create ──────────────────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "post",
    path: "/{companyId}/notes",
    operationId: "createCompanyNote",
    tags: ["Company CRM"],
    summary: "Create a company note",
    request: {
      params: companyIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: createNoteSchema } },
      },
    },
    responses: {
      201: {
        description: "Note created",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), note: noteSchema }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Company not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const values: CompanyNoteInsert = {
        companyId: companyIdNum,
        title: body.title,
        content: body.content,
        tagsJson: body.tags !== undefined ? JSON.stringify(normalizeTags(body.tags)) : null,
      };

      const [inserted] = await db.insert(companyNotes).values(values).returning();
      return c.json({ success: true as const, note: serializeNote(inserted) }, 201);
    } catch (err) {
      console.error("[company-crm] POST /:companyId/notes error:", err);
      return c.json({ error: "Failed to create note" }, 500);
    }
  },
);

// ─── PATCH /:companyId/notes/:id — partial update ─────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "patch",
    path: "/{companyId}/notes/{id}",
    operationId: "updateCompanyNote",
    tags: ["Company CRM"],
    summary: "Partially update a company note",
    request: {
      params: noteIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: updateNoteSchema } },
      },
    },
    responses: {
      200: {
        description: "Note updated",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), note: noteSchema }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Company or note not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [existing] = await db
        .select({ id: companyNotes.id })
        .from(companyNotes)
        .where(
          and(
            eq(companyNotes.id, idNum),
            eq(companyNotes.companyId, companyIdNum),
            eq(companyNotes.isDeleted, false),
          ),
        )
        .limit(1);

      if (!existing) return c.json({ error: "Note not found" }, 404);

      const update: Partial<CompanyNoteInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) update.title = body.title;
      if (body.content !== undefined) update.content = body.content;
      if (body.tags !== undefined) {
        const normalized = normalizeTags(body.tags);
        update.tagsJson = normalized.length > 0 ? JSON.stringify(normalized) : null;
      }

      const [updated] = await db
        .update(companyNotes)
        .set(update)
        .where(eq(companyNotes.id, idNum))
        .returning();

      return c.json({ success: true as const, note: serializeNote(updated) }, 200);
    } catch (err) {
      console.error("[company-crm] PATCH /:companyId/notes/:id error:", err);
      return c.json({ error: "Failed to update note" }, 500);
    }
  },
);

// ─── DELETE /:companyId/notes/:id — soft-delete ───────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "delete",
    path: "/{companyId}/notes/{id}",
    operationId: "deleteCompanyNote",
    tags: ["Company CRM"],
    summary: "Soft-delete a company note",
    request: {
      params: noteIdParamSchema,
    },
    responses: {
      200: {
        description: "Note soft-deleted",
        content: {
          "application/json": { schema: z.object({ success: z.literal(true) }) },
        },
      },
      404: {
        description: "Company or note not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [existing] = await db
        .select({ id: companyNotes.id })
        .from(companyNotes)
        .where(
          and(
            eq(companyNotes.id, idNum),
            eq(companyNotes.companyId, companyIdNum),
            eq(companyNotes.isDeleted, false),
          ),
        )
        .limit(1);

      if (!existing) return c.json({ error: "Note not found" }, 404);

      await db
        .update(companyNotes)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(companyNotes.id, idNum));

      return c.json({ success: true as const }, 200);
    } catch (err) {
      console.error("[company-crm] DELETE /:companyId/notes/:id error:", err);
      return c.json({ error: "Failed to delete note" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TODOS
// ════════════════════════════════════════════════════════════════════════════

// ─── GET /:companyId/todos — list (supports ?status=) ─────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "get",
    path: "/{companyId}/todos",
    operationId: "listCompanyTodos",
    tags: ["Company CRM"],
    summary: "List todos for a company (isDeleted=false, newest-updated first, ?status= filter)",
    request: {
      params: companyIdParamSchema,
      query: todoListQuerySchema,
    },
    responses: {
      200: {
        description: "Company todos",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), todos: z.array(todoSchema) }),
          },
        },
      },
      404: {
        description: "Company not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const { status } = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const conditions = [
        eq(companyTodos.companyId, companyIdNum),
        eq(companyTodos.isDeleted, false),
      ];
      if (status) conditions.push(eq(companyTodos.status, status));

      const rows = await db
        .select()
        .from(companyTodos)
        .where(and(...conditions))
        .orderBy(desc(companyTodos.updatedAt));

      return c.json({ success: true as const, todos: rows.map(serializeTodo) }, 200);
    } catch (err) {
      console.error("[company-crm] GET /:companyId/todos error:", err);
      return c.json({ error: "Failed to list todos" }, 500);
    }
  },
);

// ─── GET /:companyId/todos/:id — one ──────────────────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "get",
    path: "/{companyId}/todos/{id}",
    operationId: "getCompanyTodo",
    tags: ["Company CRM"],
    summary: "Get one company todo",
    request: {
      params: todoIdParamSchema,
    },
    responses: {
      200: {
        description: "Company todo",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), todo: todoSchema }),
          },
        },
      },
      404: {
        description: "Company or todo not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [row] = await db
        .select()
        .from(companyTodos)
        .where(
          and(
            eq(companyTodos.id, idNum),
            eq(companyTodos.companyId, companyIdNum),
            eq(companyTodos.isDeleted, false),
          ),
        )
        .limit(1);

      if (!row) return c.json({ error: "Todo not found" }, 404);
      return c.json({ success: true as const, todo: serializeTodo(row) }, 200);
    } catch (err) {
      console.error("[company-crm] GET /:companyId/todos/:id error:", err);
      return c.json({ error: "Failed to get todo" }, 500);
    }
  },
);

// ─── POST /:companyId/todos — create ──────────────────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "post",
    path: "/{companyId}/todos",
    operationId: "createCompanyTodo",
    tags: ["Company CRM"],
    summary: "Create a company todo",
    request: {
      params: companyIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: createTodoSchema } },
      },
    },
    responses: {
      201: {
        description: "Todo created",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), todo: todoSchema }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Company not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const values: CompanyTodoInsert = {
        companyId: companyIdNum,
        title: body.title,
        content: body.content ?? null,
        status: body.status ?? "open",
        dueDate: body.dueDate !== undefined && body.dueDate !== null ? new Date(body.dueDate) : null,
        owner: body.owner ?? null,
        tagsJson: JSON.stringify(body.tags ?? []),
      };

      const [inserted] = await db.insert(companyTodos).values(values).returning();
      return c.json({ success: true as const, todo: serializeTodo(inserted) }, 201);
    } catch (err) {
      console.error("[company-crm] POST /:companyId/todos error:", err);
      return c.json({ error: "Failed to create todo" }, 500);
    }
  },
);

// ─── PATCH /:companyId/todos/:id — partial update (incl. status) ──────────────

companyCrmRouter.openapi(
  createRoute({
    method: "patch",
    path: "/{companyId}/todos/{id}",
    operationId: "updateCompanyTodo",
    tags: ["Company CRM"],
    summary: "Partially update a company todo (including status transitions)",
    request: {
      params: todoIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: updateTodoSchema } },
      },
    },
    responses: {
      200: {
        description: "Todo updated",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), todo: todoSchema }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      404: {
        description: "Company or todo not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [existing] = await db
        .select({ id: companyTodos.id })
        .from(companyTodos)
        .where(
          and(
            eq(companyTodos.id, idNum),
            eq(companyTodos.companyId, companyIdNum),
            eq(companyTodos.isDeleted, false),
          ),
        )
        .limit(1);

      if (!existing) return c.json({ error: "Todo not found" }, 404);

      const update: Partial<CompanyTodoInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) update.title = body.title;
      if (body.content !== undefined) update.content = body.content;
      if (body.status !== undefined) update.status = body.status;
      if (body.dueDate !== undefined) {
        update.dueDate = body.dueDate === null ? null : new Date(body.dueDate);
      }
      if (body.owner !== undefined) update.owner = body.owner;
      if (body.tags !== undefined) update.tagsJson = JSON.stringify(body.tags);

      const [updated] = await db
        .update(companyTodos)
        .set(update)
        .where(eq(companyTodos.id, idNum))
        .returning();

      return c.json({ success: true as const, todo: serializeTodo(updated) }, 200);
    } catch (err) {
      console.error("[company-crm] PATCH /:companyId/todos/:id error:", err);
      return c.json({ error: "Failed to update todo" }, 500);
    }
  },
);

// ─── DELETE /:companyId/todos/:id — soft-delete ───────────────────────────────

companyCrmRouter.openapi(
  createRoute({
    method: "delete",
    path: "/{companyId}/todos/{id}",
    operationId: "deleteCompanyTodo",
    tags: ["Company CRM"],
    summary: "Soft-delete a company todo",
    request: {
      params: todoIdParamSchema,
    },
    responses: {
      200: {
        description: "Todo soft-deleted",
        content: {
          "application/json": { schema: z.object({ success: z.literal(true) }) },
        },
      },
      404: {
        description: "Company or todo not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId, id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);
    const idNum = Number(id);

    try {
      if (!(await requireCompany(db, companyIdNum))) {
        return c.json({ error: "Company not found" }, 404);
      }

      const [existing] = await db
        .select({ id: companyTodos.id })
        .from(companyTodos)
        .where(
          and(
            eq(companyTodos.id, idNum),
            eq(companyTodos.companyId, companyIdNum),
            eq(companyTodos.isDeleted, false),
          ),
        )
        .limit(1);

      if (!existing) return c.json({ error: "Todo not found" }, 404);

      await db
        .update(companyTodos)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(companyTodos.id, idNum));

      return c.json({ success: true as const }, 200);
    } catch (err) {
      console.error("[company-crm] DELETE /:companyId/todos/:id error:", err);
      return c.json({ error: "Failed to delete todo" }, 500);
    }
  },
);
