import type { RemodelTool } from "../../types";

import { cancelRenderCampaign } from "./cancel_render_campaign";
import { createRenderCampaign } from "./create_render_campaign";
import { getRenderCampaign } from "./get_render_campaign";
import { listRenderCampaigns } from "./list_render_campaigns";
import { runRoomLooks } from "./run_room_looks";

export const renderTools: RemodelTool[] = [
  createRenderCampaign,
  listRenderCampaigns,
  getRenderCampaign,
  cancelRenderCampaign,
  runRoomLooks,
];
