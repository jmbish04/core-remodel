/**
 * @fileoverview MCP tools — Tesla / Tessie domain (aggregated).
 *
 * Lets a model reach the car: is the integration configured and healthy
 * (`get_tesla_status`), where is it now (`get_vehicle_location`), what has it
 * been doing (`list_tesla_events`), and send it somewhere
 * (`send_vehicle_navigation` — the only write).
 *
 * Every tool degrades to a clear "not configured" error rather than an empty
 * result, because the credentials live in the Secrets Store and may simply be
 * absent in a given deployment. Configuration is managed at
 * /admin/config/integrations/tesla; secret VALUES are never exposed here.
 *
 * Registry contract (0015): hand-written Zod v4, annotations, examples.
 */
import { type RemodelTool } from "../../types";

import { getTeslaStatus } from "./get_tesla_status";
import { getVehicleLocation } from "./get_vehicle_location";
import { listTeslaEvents } from "./list_tesla_events";
import { reportLocation } from "./report_location";
import { sendDriveToTesla } from "./send_drive_to_tesla";
import { sendVehicleNavigation } from "./send_vehicle_navigation";

export const teslaTools: RemodelTool[] = [
  getTeslaStatus,
  getVehicleLocation,
  listTeslaEvents,
  reportLocation,
  sendVehicleNavigation,
  sendDriveToTesla,
];
