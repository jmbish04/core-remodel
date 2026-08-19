import type { RemodelTool } from "../../types";

import { createRenderSession } from "./create_render_session";
import { createRenderSessionFromImages } from "./create_render_session_from_images";
import { addRenderReferences } from "./add_render_references";
import { listRoomAngles } from "./list_room_angles";
import { runRenderStage } from "./run_render_stage";
import { generateMoodBoardTool } from "./generate_mood_board";
import { listMoodBoards } from "./list_mood_boards";
import { highlightWall } from "./highlight_wall";
import { addMeasurement } from "./add_measurement";
import { listMeasurementsTool } from "./list_measurements";
import { getMeasurementCoverageTool } from "./get_measurement_coverage";

export const legacyTools: RemodelTool[] = [
  createRenderSession,
  createRenderSessionFromImages,
  addRenderReferences,
  listRoomAngles,
  runRenderStage,
  generateMoodBoardTool,
  listMoodBoards,
  highlightWall,
  addMeasurement,
  listMeasurementsTool,
  getMeasurementCoverageTool,
];
