import type { RemodelTool } from "../../types";

import { submitFeatureProposal } from "./submit_feature_proposal";
import { getFeatureProposal } from "./get_feature_proposal";
import { listFeatureProposals } from "./list_feature_proposals";

export const changelogTools: RemodelTool[] = [
  submitFeatureProposal,
  getFeatureProposal,
  listFeatureProposals,
];
