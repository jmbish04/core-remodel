/**
 * @fileoverview Barrel of every tool-domain array. `registry.ts` concatenates
 * these into the canonical tool list. Add a new domain by importing its array
 * here and spreading it into `ALL_TOOL_GROUPS` (order = docs-page order).
 */
import type { RemodelTool } from "../types";
import { analyticsTools } from "./analytics";
import { artifactTools } from "./artifacts";
import { brandTools } from "./brands";
import { budgetTools } from "./budget";
import { driveTools } from "./drives";
import { legacyTools } from "./legacy";
import { materialTools } from "./materials";
import { memoryTools } from "./memory";
import { opsTools } from "./ops";
import { priceObservationTools } from "./price_observations";
import { productTools } from "./products";
import { productPhotoTools } from "./product_photos";
import { roomTools } from "./rooms";
import { showroomTools } from "./showrooms";
import { workflowTools } from "./workflow";

/** All tool groups, in the order they appear on the docs page. */
export const ALL_TOOL_GROUPS: RemodelTool[] = [
  ...roomTools,
  ...budgetTools,
  ...analyticsTools,
  ...materialTools,
  ...showroomTools,
  ...driveTools,
  ...brandTools,
  ...productTools,
  ...productPhotoTools,
  ...priceObservationTools,
  ...workflowTools,
  ...artifactTools,
  ...opsTools,
  ...memoryTools,
  ...legacyTools,
];
