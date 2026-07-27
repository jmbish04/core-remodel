/**
 * @fileoverview MCP tools — Visit Logs domain (0032 V2b), aggregated.
 *
 * Full CRUD over `showroom_visit_log` — the receipts drawer — plus the two
 * convenience verbs the voice loop leans on: `stage_showroom_visit` (AI_STAGED
 * draft from a note) and `finalize_visit_log` (mark SUBMITTED). Every tool goes
 * through `services/showroom/visit-log.ts`, the SAME service the REST routes call,
 * so MCP and REST stay in lockstep.
 *
 * Registry contract (0015): hand-written Zod v4, annotations, examples, url fields.
 */
import { type RemodelTool } from "../../types";

import { listVisitLogsTool } from "./list_visit_logs";
import { getVisitLogTool } from "./get_visit_log";
import { createVisitLogTool } from "./create_visit_log";
import { updateVisitLogTool } from "./update_visit_log";
import { deleteVisitLogTool } from "./delete_visit_log";
import { stageShowroomVisitTool } from "./stage_showroom_visit";
import { finalizeVisitLogTool } from "./finalize_visit_log";

export const visitTools: RemodelTool[] = [
  listVisitLogsTool,
  getVisitLogTool,
  createVisitLogTool,
  updateVisitLogTool,
  deleteVisitLogTool,
  stageShowroomVisitTool,
  finalizeVisitLogTool,
];
