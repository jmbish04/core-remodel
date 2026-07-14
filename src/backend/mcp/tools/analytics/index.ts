import type { RemodelTool } from "../../types";

import { getBudgetReport } from "./get_budget_report";
import { getReallocationOptions } from "./get_reallocation_options";

export const analyticsTools: RemodelTool[] = [getBudgetReport, getReallocationOptions];
