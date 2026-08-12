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
import { changelogTools } from "./changelog";
import { driveTools } from "./drives";
import { emailTools } from "./email";
import { legacyTools } from "./legacy";
import { materialTools } from "./materials";
import { memoryTools } from "./memory";
import { opsTools } from "./ops";
import { pascalTools } from "./pascal";
import { priceObservationTools } from "./price_observations";
import { productPhotoTools } from "./product_photos";
import { productTools } from "./products";
import { renderTools } from "./render";
import { roomTools } from "./rooms";
import { showroomTools } from "./showrooms";
import { teslaTools } from "./tesla";
import { visitTools } from "./visits";
import { workflowTools } from "./workflow";

/** All tool groups, in the order they appear on the docs page. */
export const ALL_TOOL_GROUPS: RemodelTool[] = [
  ...roomTools,
  ...budgetTools,
  ...analyticsTools,
  ...materialTools,
  ...renderTools,
  ...showroomTools,
  ...driveTools,
  ...teslaTools,
  ...visitTools,
  ...brandTools,
  ...productTools,
  ...productPhotoTools,
  ...priceObservationTools,
  ...workflowTools,
  ...artifactTools,
  ...opsTools,
  ...changelogTools,
  ...memoryTools,
  ...pascalTools,
  ...legacyTools,
  ...emailTools,
];
