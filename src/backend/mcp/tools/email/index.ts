import type { RemodelTool } from "../../types";

import { resolveRecipientTool } from "./resolve_recipient";

export const emailTools: RemodelTool[] = [resolveRecipientTool];
