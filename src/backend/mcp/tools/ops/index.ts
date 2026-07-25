import type { RemodelTool } from "../../types";

import { exportConversation } from "./export_conversation";
import { reportBug } from "./report_bug";
import { listAgentIssues } from "./list_agent_issues";
import { resolveAgentIssue } from "./resolve_agent_issue";
import { requestFeature } from "./request_feature";
import { listFeatureRequests } from "./list_feature_requests";
import { getRecentActivity } from "./get_recent_activity";
import { runHealthSessionTool } from "./run_health_session";
import { getHealthResultsTool } from "./get_health_results";

export const opsTools: RemodelTool[] = [
  exportConversation,
  reportBug,
  listAgentIssues,
  resolveAgentIssue,
  requestFeature,
  listFeatureRequests,
  getRecentActivity,
  runHealthSessionTool,
  getHealthResultsTool,
];
