/**
 * @fileoverview `pascal` MCP tool domain (0043) — projects, studies, variants, and
 * full-fidelity scene reads for the Vercel Pascal floorplan editor. Category `render`.
 */
import type { RemodelTool } from "../../types";
import { captureSceneScreenshotTool } from "./capture_scene_screenshot";
import { compareLayoutVariants } from "./compare_layout_variants";
import { createRenderProject } from "./create_render_project";
import { createStudyTool } from "./create_study";
import { editSceneNodes } from "./edit_scene_nodes";
import { generateFloorplanVariant } from "./generate_floorplan_variant";
import { getRenderContext } from "./get_render_context";
import { getRenderStatus } from "./get_render_status";
import { getSceneGraph } from "./get_scene_graph";
import { getVariantEditorLink } from "./get_variant_editor_link";
import { listStudiesTool } from "./list_studies";
import { listVariantsTool } from "./list_variants";
import { putSceneGraph } from "./put_scene_graph";

export const pascalTools: RemodelTool[] = [
  createRenderProject,
  createStudyTool,
  getRenderContext,
  getSceneGraph,
  generateFloorplanVariant,
  editSceneNodes,
  putSceneGraph,
  compareLayoutVariants,
  captureSceneScreenshotTool,
  listStudiesTool,
  listVariantsTool,
  getVariantEditorLink,
  getRenderStatus,
];
