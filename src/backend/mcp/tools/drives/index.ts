/**
 * @fileoverview MCP tools — Showroom Drive Lists domain (aggregated).
 *
 * Lets Claude build and reason about showroom "drive sheets": an ordered set of
 * showroom stops for a day of visits. `create_drive_list` makes a drive appear
 * on the `/admin/shopping/drives` landing page (openable in the drive viewport);
 * `list_drive_lists` / `get_drive_list` read prior drives with their check-off
 * progress; and `analyze_drive_coverage` cross-references stops that were left
 * unvisited on a drive against the registered showrooms' real visit signal — so
 * the agent can spot showrooms skipped on a drive but visited later, and surface
 * registered showrooms not yet on any drive as candidates for the next one.
 *
 * Registry contract (0015): hand-written Zod v4, annotations, examples.
 */
import { type RemodelTool } from "../../types";

import { listDriveLists } from "./list_drive_lists";
import { getDriveList } from "./get_drive_list";
import { createDriveListTool } from "./create_drive_list";
import { updateDriveListTool } from "./update_drive_list";
import { updateDriveStopTool } from "./update_drive_stop";
import { addDriveStopsTool } from "./add_drive_stops";
import { removeDriveStopTool } from "./remove_drive_stop";
import { analyzeDriveCoverage } from "./analyze_drive_coverage";
import { planDriveRoute } from "./plan_drive_route";

export const driveTools: RemodelTool[] = [
  listDriveLists,
  getDriveList,
  createDriveListTool,
  updateDriveListTool,
  updateDriveStopTool,
  addDriveStopsTool,
  removeDriveStopTool,
  analyzeDriveCoverage,
  planDriveRoute,
];
