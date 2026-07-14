import { type RemodelTool } from "../../types";

import { listAllowedComponents } from "./list_allowed_components";
import { createArtifact } from "./create_artifact";
import { listArtifacts } from "./list_artifacts";
import { getArtifact } from "./get_artifact";
import { updateArtifact } from "./update_artifact";
import { setArtifactStatus } from "./set_artifact_status";

export const artifactTools: RemodelTool[] = [
  listAllowedComponents,
  createArtifact,
  listArtifacts,
  getArtifact,
  updateArtifact,
  setArtifactStatus,
];
