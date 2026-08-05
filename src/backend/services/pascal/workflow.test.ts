/** Runnable Pascal workflow boundary checks: `npx tsx src/backend/services/pascal/workflow.test.ts`. */
import assert from "node:assert/strict";

import { PascalStoreError } from "./store";
import { assertSourceVariant } from "./workflow";

assert.throws(
  () => assertSourceVariant(null, "scene-missing", "project-a"),
  (error) => error instanceof PascalStoreError && error.code === "not_found",
  "a missing branch source must be rejected",
);

assert.throws(
  () => assertSourceVariant({ projectId: "project-b" }, "scene-b", "project-a"),
  (error) => error instanceof PascalStoreError && error.code === "invalid",
  "a source from another project must be rejected",
);

assert.doesNotThrow(
  () => assertSourceVariant({ projectId: "project-a" }, "scene-a", "project-a"),
  "a source in the study project is valid",
);

console.log("pascal-workflow: all assertions passed ✓");
