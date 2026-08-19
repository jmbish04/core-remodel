/**
 * Tool registry — the single source of truth for what the renovation-studio MCP
 * server exposes. Add a tool = drop a file in this dir and add one line here.
 *
 * Order is the wire order returned by `tools/list`.
 */
import { addMeasurement } from "./add_measurement";
import { createChangelogEntry } from "./create_changelog_entry";
import { createRenderSession } from "./create_render_session";
import { createShowroomContact } from "./create_showroom_contact";
import { generateMoodBoardTool } from "./generate_mood_board";
import { getDeepResearchContext } from "./get_deep_research_context";
import { getMeasurementCoverageTool } from "./get_measurement_coverage";
import { highlightWall } from "./highlight_wall";
import { listFailedBusinessCards } from "./list_failed_business_cards";
import { listMeasurementsTool } from "./list_measurements";
import { listMoodBoards } from "./list_mood_boards";
import { listRoomAngles } from "./list_room_angles";
import { listRooms } from "./list_rooms";
import { listShowroomContacts } from "./list_showroom_contacts";
import { recordDeepResearchProgress } from "./record_deep_research_progress";
import { recordDeepResearchSource } from "./record_deep_research_source";
import { resolveBusinessCard } from "./resolve_business_card";
import { runRenderStage } from "./run_render_stage";
import { setShowroomAddress } from "./set_showroom_address";
import { setShowroomHours } from "./set_showroom_hours";
import { setShowroomLinks } from "./set_showroom_links";

import type { ToolDef } from "../types";

export const TOOLS: ToolDef[] = [
  createRenderSession,
  listRoomAngles,
  runRenderStage,
  generateMoodBoardTool,
  listMoodBoards,
  // --- 0006 measurement bridge: live floor-plan "touch" + master measurements ---
  listRooms,
  highlightWall,
  addMeasurement,
  listMeasurementsTool,
  getMeasurementCoverageTool,
  // --- Deep Research bridge (also callable by scoped research tokens) ---
  getDeepResearchContext,
  recordDeepResearchProgress,
  recordDeepResearchSource,
  // --- Showroom contacts / changelog / address / links / hours + business cards ---
  createShowroomContact,
  createChangelogEntry,
  setShowroomAddress,
  setShowroomLinks,
  setShowroomHours,
  listShowroomContacts,
  listFailedBusinessCards,
  resolveBusinessCard,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
