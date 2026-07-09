/**
 * @fileoverview MCP tools — Artifact Studio domain (0016).
 *
 * Lets Claude export a chat-built artifact (report / interactive app /
 * dashboard) onto the Worker, then list, view, and revise it. The artifact is a
 * single TSX module that default-exports a React component, composed ONLY from
 * the allow-listed shadcn scope (see `../artifacts/scope.ts`) — enforced by the
 * `../artifacts/validate.ts` validator at submit time and by a sandboxed
 * iframe + scoped module loader at render time.
 *
 * Registry contract (0015): hand-written Zod v4, annotations, examples.
 */
import { artifactRevisions, artifacts } from "@backend/db";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";

import { ALLOWED_COMPONENTS, ALLOWED_LIBS } from "../artifacts/scope";
import { validateArtifactSource } from "../artifacts/validate";
import { toolError } from "../format";
import { looseObject, urlField } from "../schemas";
import { studioUrl } from "../urls";
import { defineTool, READ_ONLY, WRITE, type RemodelTool } from "../types";

/** Kebab-case a title into a URL slug base (letters/digits/hyphens only). */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "artifact";
}

/**
 * Find a slug not already taken (appends -2, -3, … on collision). Queries only
 * the exact slug first, then just the `base-%` family on collision — never the
 * whole table.
 */
async function uniqueSlug(
  db: import("../types").RemodelDb,
  base: string,
): Promise<string> {
  const [exact] = await db
    .select({ slug: artifacts.slug })
    .from(artifacts)
    .where(eq(artifacts.slug, base))
    .limit(1);
  if (!exact) return base;

  const family = await db
    .select({ slug: artifacts.slug })
    .from(artifacts)
    .where(like(artifacts.slug, `${base}-%`))
    .all();
  const taken = new Set(family.map((r) => r.slug));
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export const artifactTools: RemodelTool[] = [
  defineTool({
    name: "list_allowed_components",
    category: "artifacts",
    title: "List allowed artifact components",
    description:
      "The scope catalog for building artifacts: every shadcn/ui component (with its import specifier + a usage " +
      "hint) and the sanctioned libraries an artifact may use. CALL THIS BEFORE writing an artifact so your imports " +
      "and styling pass validation the first time. Artifacts must compose these components on Monolith theme tokens " +
      "— never a bespoke UI lib, never hardcoded colors, never inline styles, never raw <button>/<input>/<select>.",
    inputShape: {},
    annotations: READ_ONLY,
    outputShape: {
      components: z.array(
        looseObject({
          name: z.string(),
          specifier: z.string(),
          hint: z.string(),
        }),
      ),
      libs: z.array(
        looseObject({
          name: z.string(),
          specifier: z.string(),
          hint: z.string(),
        }),
      ),
      rules: z.array(z.string()),
    },
    examples: [{ title: "Get the catalog", args: {} }],
    handler: async () => ({
      components: ALLOWED_COMPONENTS,
      libs: ALLOWED_LIBS,
      rules: [
        "export default a single React component.",
        "Import ONLY from the specifiers listed here.",
        "Style with Tailwind LAYOUT utilities (grid/flex/gap/spacing) + Monolith theme tokens (bg-card, bg-primary, text-foreground, text-muted-foreground, border-border).",
        "No inline style={{…}}, no <style>, no hardcoded colors (text-red-500, bg-[#fff]).",
        "Interactive/structural UI uses shadcn components; plain <div>/<span> for layout only.",
        "Wrap recharts in <ChartContainer> for the Monolith chart palette.",
        "Read-only data access via @/studio/data (no writes in v1).",
      ],
    }),
  }),

  defineTool({
    name: "create_artifact",
    category: "artifacts",
    title: "Create an artifact",
    description:
      "Export a new artifact onto the Worker (Studio). Pass `title`, `kind` (report|app|dashboard), and `sourceTsx` " +
      "— a single TSX module that `export default`s a React component built from the allowed shadcn scope (call " +
      "list_allowed_components first). Optionally add `description` and a `sourceConversation` note. The source is " +
      "validated against the import allow-list + style rules; on PASS it stores revision 1 and returns " +
      "{ ok:true, id, slug, url }. On FAIL it returns { ok:false, errors } — fix the listed issues and resubmit.",
    inputShape: {
      title: z.string().min(1).describe("Artifact title (required)"),
      kind: z
        .enum(["report", "app", "dashboard"])
        .optional()
        .describe("Artifact kind (default 'app')"),
      sourceTsx: z
        .string()
        .min(1)
        .describe("TSX module that default-exports a React component (required)"),
      description: z.string().optional().describe("Short description of what the artifact does"),
      sourceConversation: z
        .string()
        .optional()
        .describe("Freeform note on where this came from (the chat context)"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      id: z.number().int().optional().describe("The new artifact id (present when ok=true)"),
      slug: z.string().optional().describe("The artifact slug (present when ok=true)"),
      url: urlField.optional(),
      errors: z.array(z.string()).optional().describe("Validation failures (present when ok=false)"),
    },
    examples: [
      {
        title: "A tiny report",
        args: {
          title: "Closet budget summary",
          kind: "report",
          sourceTsx:
            'import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";\n' +
            "export default function ClosetBudget() {\n" +
            '  return (<Card><CardHeader><CardTitle>Closet budget</CardTitle></CardHeader>' +
            "<CardContent className=\"text-muted-foreground\">$4,200 estimated</CardContent></Card>);\n}",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const title = input.title?.trim();
      const sourceTsx = input.sourceTsx;
      if (!title) toolError("`title` is required and cannot be empty.");
      if (!sourceTsx?.trim()) toolError("`sourceTsx` is required and cannot be empty.");

      const validation = validateArtifactSource(sourceTsx);
      if (!validation.ok) {
        return { ok: false, errors: validation.errors };
      }

      const slug = await uniqueSlug(db, slugify(title));
      const [artifact] = await db
        .insert(artifacts)
        .values({
          slug,
          title,
          description: input.description,
          kind: input.kind ?? "app",
          sourceConversation: input.sourceConversation,
        })
        .returning({ id: artifacts.id });

      const [rev] = await db
        .insert(artifactRevisions)
        .values({
          artifactId: artifact.id,
          revisionNumber: 1,
          sourceTsx,
          importsJson: JSON.stringify(validation.imports),
          changeNote: "Initial revision",
        })
        .returning({ id: artifactRevisions.id });

      await db
        .update(artifacts)
        .set({ currentRevisionId: rev.id, updatedAt: new Date() })
        .where(eq(artifacts.id, artifact.id))
        .run();

      return { ok: true, id: artifact.id, slug, url: studioUrl(env, slug) };
    },
  }),

  defineTool({
    name: "list_artifacts",
    category: "artifacts",
    title: "List artifacts",
    description:
      "List exported artifacts (id, slug, title, kind, status, revisionCount, updatedAt) so you can see prior work " +
      "before revising it. Optional `kind` and `status` filters. Newest-updated first.",
    inputShape: {
      kind: z.enum(["report", "app", "dashboard"]).optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      count: z.number().int(),
      artifacts: z.array(
        looseObject({
          id: z.number().int(),
          slug: z.string(),
          title: z.string(),
          kind: z.string(),
          status: z.string(),
          revisionCount: z.number().int(),
          url: urlField,
        }),
      ),
    },
    examples: [
      { title: "All", args: {} },
      { title: "Published dashboards", args: { kind: "dashboard", status: "published" } },
    ],
    handler: async ({ env, db }, input) => {
      // Filter + count + order + limit in SQL (single query, left-join keeps
      // 0-revision artifacts).
      const conditions = [];
      if (input.kind) conditions.push(eq(artifacts.kind, input.kind));
      if (input.status) conditions.push(eq(artifacts.status, input.status));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: artifacts.id,
          slug: artifacts.slug,
          title: artifacts.title,
          description: artifacts.description,
          kind: artifacts.kind,
          status: artifacts.status,
          updatedAt: artifacts.updatedAt,
          revisionCount: sql<number>`count(${artifactRevisions.id})`,
        })
        .from(artifacts)
        .leftJoin(artifactRevisions, eq(artifacts.id, artifactRevisions.artifactId))
        .where(whereClause)
        .groupBy(artifacts.id)
        .orderBy(desc(artifacts.updatedAt))
        .limit(input.limit ?? 100)
        .all();

      return {
        count: rows.length,
        artifacts: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          description: r.description,
          kind: r.kind,
          status: r.status,
          revisionCount: Number(r.revisionCount),
          updatedAt: r.updatedAt,
          url: studioUrl(env, r.slug),
        })),
      };
    },
  }),

  defineTool({
    name: "get_artifact",
    category: "artifacts",
    title: "Get an artifact",
    description:
      "Full metadata + the current `sourceTsx` for one artifact (by `id` OR `slug`) so you can revise it. Pass an " +
      "optional `revision` number to fetch a specific historical version instead of the current one.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Artifact id"),
      slug: z.string().optional().describe("Artifact slug (alternative to id)"),
      revision: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Specific revisionNumber to fetch (defaults to current)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      id: z.number().int(),
      slug: z.string(),
      title: z.string(),
      kind: z.string(),
      status: z.string(),
      url: urlField,
      revisionNumber: z.number().int(),
      sourceTsx: z.string(),
      imports: z.array(z.string()),
      revisions: z.array(
        looseObject({
          n: z.number().int(),
          changeNote: z.string().nullable(),
        }),
      ),
    },
    examples: [
      { title: "By slug", args: { slug: "closet-budget-summary" } },
      { title: "Old revision", args: { id: 3, revision: 1 } },
    ],
    handler: async ({ env, db }, input) => {
      if (input.id == null && !input.slug) {
        toolError("Pass either `id` or `slug`.");
      }
      const [artifact] = await db
        .select()
        .from(artifacts)
        .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
        .limit(1);
      if (!artifact) {
        toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
      }

      const [revision] = await db
        .select()
        .from(artifactRevisions)
        .where(
          input.revision != null
            ? sql`${artifactRevisions.artifactId} = ${artifact.id} AND ${artifactRevisions.revisionNumber} = ${input.revision}`
            : eq(artifactRevisions.id, artifact.currentRevisionId ?? -1),
        )
        .limit(1);
      if (!revision) {
        toolError(
          input.revision != null
            ? `Revision ${input.revision} not found for this artifact.`
            : "Artifact has no current revision.",
        );
      }

      const allRevs = await db
        .select({ n: artifactRevisions.revisionNumber, changeNote: artifactRevisions.changeNote, createdAt: artifactRevisions.createdAt })
        .from(artifactRevisions)
        .where(eq(artifactRevisions.artifactId, artifact.id))
        .orderBy(desc(artifactRevisions.revisionNumber))
        .all();

      return {
        id: artifact.id,
        slug: artifact.slug,
        title: artifact.title,
        description: artifact.description,
        kind: artifact.kind,
        status: artifact.status,
        url: studioUrl(env, artifact.slug),
        revisionNumber: revision.revisionNumber,
        sourceTsx: revision.sourceTsx,
        entryExport: revision.entryExport,
        imports: revision.importsJson ? (JSON.parse(revision.importsJson) as string[]) : [],
        revisions: allRevs,
      };
    },
  }),

  defineTool({
    name: "update_artifact",
    category: "artifacts",
    title: "Update an artifact",
    description:
      "Store a NEW revision of an existing artifact (by `id` or `slug`) with revised `sourceTsx` and a `changeNote`. " +
      "Re-validates against the shadcn allow-list + style rules; on PASS it appends the revision, bumps the current " +
      "pointer, and returns { ok:true, revisionNumber, url }. On FAIL returns { ok:false, errors }. Old revisions " +
      "are retained (see get_artifact `revision`).",
    inputShape: {
      id: z.number().int().positive().optional().describe("Artifact id"),
      slug: z.string().optional().describe("Artifact slug (alternative to id)"),
      sourceTsx: z.string().min(1).describe("Revised TSX module (required)"),
      changeNote: z.string().optional().describe("What changed in this revision"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      id: z.number().int().optional().describe("The artifact id (present when ok=true)"),
      slug: z.string().optional().describe("The artifact slug (present when ok=true)"),
      revisionNumber: z.number().int().optional().describe("The newly stored revision number (present when ok=true)"),
      url: urlField.optional(),
      errors: z.array(z.string()).optional().describe("Validation failures (present when ok=false)"),
    },
    examples: [
      {
        title: "Revise",
        args: {
          slug: "closet-budget-summary",
          sourceTsx: "…revised source…",
          changeNote: "Added a second closet row.",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
      if (!input.sourceTsx?.trim()) toolError("`sourceTsx` is required and cannot be empty.");

      const [artifact] = await db
        .select()
        .from(artifacts)
        .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
        .limit(1);
      if (!artifact) {
        toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
      }

      const validation = validateArtifactSource(input.sourceTsx);
      if (!validation.ok) {
        return { ok: false, errors: validation.errors };
      }

      const [{ maxRev = 0 } = {}] = await db
        .select({ maxRev: sql<number>`max(${artifactRevisions.revisionNumber})` })
        .from(artifactRevisions)
        .where(eq(artifactRevisions.artifactId, artifact.id))
        .all();
      const revisionNumber = Number(maxRev) + 1;

      const [rev] = await db
        .insert(artifactRevisions)
        .values({
          artifactId: artifact.id,
          revisionNumber,
          sourceTsx: input.sourceTsx,
          importsJson: JSON.stringify(validation.imports),
          changeNote: input.changeNote ?? `Revision ${revisionNumber}`,
        })
        .returning({ id: artifactRevisions.id });

      await db
        .update(artifacts)
        .set({ currentRevisionId: rev.id, updatedAt: new Date() })
        .where(eq(artifacts.id, artifact.id))
        .run();

      return { ok: true, id: artifact.id, slug: artifact.slug, revisionNumber, url: studioUrl(env, artifact.slug) };
    },
  }),

  defineTool({
    name: "set_artifact_status",
    category: "artifacts",
    title: "Set artifact status",
    description:
      "Publish, archive, or draft an artifact (by `id` or `slug`). `archived` soft-hides it from the gallery; " +
      "`published` shows it; `draft` marks it a work-in-progress. Returns the new status.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Artifact id"),
      slug: z.string().optional().describe("Artifact slug (alternative to id)"),
      status: z.enum(["draft", "published", "archived"]).describe("New status"),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      id: z.number().int(),
      slug: z.string(),
      status: z.string(),
    },
    examples: [{ title: "Archive", args: { slug: "closet-budget-summary", status: "archived" } }],
    handler: async ({ db }, input) => {
      if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
      const [artifact] = await db
        .select({ id: artifacts.id, slug: artifacts.slug })
        .from(artifacts)
        .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
        .limit(1);
      if (!artifact) {
        toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
      }
      await db
        .update(artifacts)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(artifacts.id, artifact.id))
        .run();
      return { updated: true, id: artifact.id, slug: artifact.slug, status: input.status };
    },
  }),
];
