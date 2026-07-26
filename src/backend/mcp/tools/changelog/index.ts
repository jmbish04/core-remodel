import type { RemodelTool } from "../../types";

import { submitFeatureProposal } from "./submit_feature_proposal";
import { getFeatureProposal } from "./get_feature_proposal";
import { listFeatureProposals } from "./list_feature_proposals";
import { updatePlanTaskTool } from "./update_plan_task";

export const changelogTools: RemodelTool[] = [
  submitFeatureProposal,
  getFeatureProposal,
  listFeatureProposals,
  updatePlanTaskTool,
];
