/**
 * @fileoverview Shared helpers for the `pascal` MCP tool domain (0043).
 */
import type { pascalProjects, pascalStudies, pascalVariants } from "@backend/db";

const DEFAULT_EDITOR_URL = "https://3d-remodel.vercel.app";

export function editorBase(env: Env): string {
  return (env as { PASCAL_EDITOR_URL?: string }).PASCAL_EDITOR_URL ?? DEFAULT_EDITOR_URL;
}

export function sceneLink(env: Env, sceneId: string): string {
  return `${editorBase(env)}/scene/${sceneId}`;
}

const iso = (d: Date | number): string =>
  (d instanceof Date ? d : new Date(d * 1000)).toISOString();

export function projectDto(row: typeof pascalProjects.$inferSelect, env: Env) {
  return {
    id: row.id,
    name: row.name,
    coreRemodelProjectId: row.coreRemodelProjectId,
    scopeType: row.scopeType,
    floorId: row.floorId,
    roomId: row.roomId,
    editorUrl: `${editorBase(env)}/editor/${row.id}`,
    createdAt: iso(row.datetimeCreated),
  };
}

export function studyDto(row: typeof pascalStudies.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    descriptionMarkdown: row.descriptionMarkdown,
    createdAt: iso(row.datetimeCreated),
  };
}

export function variantDto(row: typeof pascalVariants.$inferSelect, env: Env) {
  return {
    id: row.id,
    name: row.name,
    studyId: row.studyId,
    projectId: row.projectId,
    parentSceneId: row.parentSceneId,
    version: row.version,
    status: row.status,
    published: row.published,
    nodeCount: row.nodeCount,
    thumbnailUrl: row.thumbnailUrl,
    editorUrl: sceneLink(env, row.id),
    createdAt: iso(row.datetimeCreated),
    updatedAt: iso(row.datetimeLastModified),
  };
}
