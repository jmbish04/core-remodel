#!/usr/bin/env node
/**
 * @fileoverview QC — PR #342, 0043 Phase 4: Pascal Layout Studio.
 *
 * Read-only by design: the branch preview shares durable project data, so this
 * proves the new product surface, page shell, OpenAPI entries, and MCP catalog
 * without creating or renaming a real scene.
 *
 *   pnpm run test:pr 342 -- --preview
 *   pnpm run test:pr 342
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const client = createClient();
const checks = createChecks();

console.log(`\nQC pr_342 — Pascal Layout Studio\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  const page = await client.get("/admin/pascal");
  checks.ok("GET /admin/pascal → 200", page.status === 200, `→ ${page.status}`);
  checks.ok(
    "Layout Studio page mounts the Pascal island",
    page.text.includes("Layout Studio") && page.text.includes("PascalLayoutStudioApp"),
    "missing page title or island bundle",
  );

  const index = await client.get("/api/pascal/v1/projects");
  checks.ok("GET /api/pascal/v1/projects → 200", index.status === 200, `→ ${index.status}`);
  checks.ok(
    "project index returns projects + canonical scopes",
    Array.isArray(index.json?.projects) &&
      Array.isArray(index.json?.scopes?.floors) &&
      Array.isArray(index.json?.scopes?.rooms),
    "unexpected response shape",
  );
  checks.info(
    `projects=${index.json?.projects?.length ?? 0}, floors=${index.json?.scopes?.floors?.length ?? 0}, rooms=${index.json?.scopes?.rooms?.length ?? 0}`,
  );

  const firstProject = index.json?.projects?.[0];
  if (firstProject?.id) {
    const detail = await client.get(
      `/api/pascal/v1/projects/${encodeURIComponent(firstProject.id)}/studies`,
    );
    checks.ok("project study hierarchy → 200", detail.status === 200, `→ ${detail.status}`);
    checks.ok(
      "hierarchy returns project, studies, and enriched variants",
      detail.json?.project?.id === firstProject.id &&
        Array.isArray(detail.json?.studies) &&
        Array.isArray(detail.json?.variants),
      "unexpected response shape",
    );
  } else {
    checks.info("No Pascal project exists; the page empty-state is the correct healthy path.");
  }

  const openapi = await client.get("/openapi.json");
  const operationIds = new Set(
    Object.values(openapi.json?.paths ?? {}).flatMap((path) =>
      Object.values(path ?? {}).map((operation) => operation?.operationId).filter(Boolean),
    ),
  );
  for (const operationId of [
    "pascalListProjects",
    "pascalListProjectStudies",
    "pascalCreateProjectStudy",
    "pascalGenerateStudyVariant",
    "pascalCompareVariants",
    "pascalCaptureSceneScreenshot",
    "pascalUpdateSceneStatus",
  ]) {
    checks.ok(`OpenAPI includes ${operationId}`, operationIds.has(operationId));
  }

  const catalog = await client.get("/api/mcp-docs");
  const toolNames = new Set((catalog.json?.tools ?? []).map((tool) => tool.name));
  for (const toolName of [
    "generate_floorplan_variant",
    "compare_layout_variants",
    "capture_scene_screenshot",
    "get_variant_editor_link",
  ]) {
    checks.ok(`/connect/tools catalog includes ${toolName}`, toolNames.has(toolName));
  }
} catch (error) {
  checks.ok(
    "QC completed without an unhandled error",
    false,
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
}

checks.finish();
