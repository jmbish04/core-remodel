/**
 * @fileoverview Shared Pascal product workflows used by both MCP tools and the
 * Phase-4 admin REST surface. Keeping orchestration here prevents the browser UI
 * from growing a second implementation of generation, comparison, or capture.
 */
import { drizzle } from "drizzle-orm/d1";

import { proposeEdits } from "./ai-edit";
import { applyNodeOps } from "./edit";
import { generateSeedGraph } from "./generator";
import { createVariant, getStudy, listVariants } from "./product";
import {
  parseGraphJson,
  sceneRenderingMetadataSchema,
  type SceneGraph,
  type SceneRenderingMetadata,
} from "./shapes";
import {
  getLatestSnapshot,
  getProject,
  loadScene,
  PascalStoreError,
  type PascalVariantRow,
} from "./store";

export interface GenerateProductVariantInput {
  studyId: string;
  name: string;
  fromVariantId?: string;
  intent?: string;
}

export interface GenerateProductVariantResult {
  row: PascalVariantRow;
  roomCount?: number;
  note?: string;
  branchedFrom?: string;
  intentApplied?: number;
  intentRationale?: string;
}

function parseRenderingEvidence(raw: string | null): SceneRenderingMetadata | null {
  if (!raw) return null;
  try {
    const parsed = sceneRenderingMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Generate a measured base or a child variant with validated AI node edits. */
export async function generateProductVariant(
  env: Env,
  input: GenerateProductVariantInput,
): Promise<GenerateProductVariantResult> {
  const study = await getStudy(env, input.studyId);
  if (!study) throw new PascalStoreError("not_found", `Unknown studyId '${input.studyId}'`);
  const project = await getProject(env, study.projectId);
  if (!project) {
    throw new PascalStoreError("not_found", `Study '${input.studyId}' has no project`);
  }

  const generatedAt = new Date().toISOString();
  let graph: SceneGraph;
  let rendering: SceneRenderingMetadata;
  let parentSceneId: string | null = null;
  let extra: Omit<GenerateProductVariantResult, "row"> = {};

  if (input.fromVariantId) {
    const parent = await loadScene(env, input.fromVariantId);
    if (!parent) {
      throw new PascalStoreError("not_found", `Unknown fromVariantId '${input.fromVariantId}'`);
    }
    if (parent.projectId !== project.id) {
      throw new PascalStoreError("invalid", "The source variant belongs to a different project");
    }
    graph = parseGraphJson(parent.graphJson);
    const inheritedRendering = parseRenderingEvidence(parent.renderingJson);
    rendering = {
      coreRemodelProjectId: project.coreRemodelProjectId,
      variant: null,
      measurements: inheritedRendering?.measurements ?? [],
      confidence: inheritedRendering?.confidence ?? null,
      provenance: {
        source: "pascal",
        generatedAt,
        sourceRevision: inheritedRendering?.provenance.sourceRevision ?? null,
        requestId: inheritedRendering?.provenance.requestId ?? null,
      },
    };
    parentSceneId = input.fromVariantId;
    extra = { branchedFrom: input.fromVariantId };
  } else {
    const seed = await generateSeedGraph(drizzle(env.DB), {
      coreRemodelProjectId: project.coreRemodelProjectId,
      scopeType: project.scopeType,
      floorId: project.floorId,
      roomId: project.roomId,
      generatedAt,
    });
    if (seed.roomCount === 0) {
      throw new PascalStoreError(
        "invalid",
        `No active rooms found for project scope (${project.scopeType})`,
      );
    }
    graph = seed.graph;
    rendering = seed.rendering;
    extra = { roomCount: seed.roomCount, note: seed.note };
  }

  if (input.intent?.trim()) {
    const boundsNote = rendering.measurements
      .map((measurement) => `${measurement.kind}=${measurement.value}${measurement.unit}`)
      .join(", ");
    const plan = await proposeEdits(env, {
      graph,
      intent: input.intent.trim(),
      boundsNote,
    });
    let intentApplied = 0;
    let intentRationale = plan.rationale;
    if (plan.ops.length > 0) {
      try {
        graph = applyNodeOps(graph, plan.ops);
        intentApplied = plan.ops.length;
      } catch (error) {
        intentRationale =
          `${error instanceof PascalStoreError ? error.message : "Invalid AI edits"} — ` +
          "variant created without the intent edits.";
      }
    }
    extra = { ...extra, intentApplied, intentRationale };
  }

  const row = await createVariant(env, {
    studyId: input.studyId,
    projectId: project.id,
    name: input.name,
    graph,
    rendering,
    parentSceneId,
  });
  return { row, ...extra };
}

export interface PascalVariantComparison {
  id: string;
  name: string;
  version: number;
  nodeCount: number;
  status: "draft" | "active" | "archived";
  parentSceneId: string | null;
  confidence: number | null;
  measurements: SceneRenderingMetadata["measurements"];
  thumbnailUrl: string | null;
  editorUrl: string;
}

function editorBase(env: Env): string {
  return (
    (env as { PASCAL_EDITOR_URL?: string }).PASCAL_EDITOR_URL ?? "https://3d-remodel.vercel.app"
  );
}

/** Return the same side-by-side evidence used by compare_layout_variants. */
export async function compareProductVariants(
  env: Env,
  input: { studyId?: string; variantIds?: string[] },
): Promise<PascalVariantComparison[]> {
  const rows = input.variantIds?.length
    ? (await Promise.all(input.variantIds.map((id) => loadScene(env, id)))).filter(
        (row): row is PascalVariantRow => row != null,
      )
    : input.studyId
      ? await listVariants(env, { studyId: input.studyId })
      : [];

  return Promise.all(
    rows.map(async (row) => {
      const snapshot = await getLatestSnapshot(env, row.id);
      let rendering: SceneRenderingMetadata | null = null;
      try {
        rendering = row.renderingJson
          ? (JSON.parse(row.renderingJson) as SceneRenderingMetadata)
          : null;
      } catch {
        rendering = null;
      }
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        nodeCount: row.nodeCount,
        status: row.status,
        parentSceneId: row.parentSceneId,
        confidence: rendering?.confidence ?? null,
        measurements: rendering?.measurements ?? [],
        thumbnailUrl: snapshot?.imageUrl ?? row.thumbnailUrl ?? null,
        editorUrl: `${editorBase(env).replace(/\/$/, "")}/scene/${encodeURIComponent(row.id)}`,
      };
    }),
  );
}
