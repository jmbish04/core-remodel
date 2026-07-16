import { artifactRevisions, artifacts } from "@backend/db";
import { eq, like } from "drizzle-orm";
import { z } from "zod";

import { validateArtifactSource } from "../../artifacts/validate";
import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { studioUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

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
  db: import("../../types").RemodelDb,
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

export const createArtifact = defineTool({
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
});
