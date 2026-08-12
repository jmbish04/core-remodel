import type { RemodelTool } from "../../types";

import { getEmailInstructionsTool } from "./get_email_instructions";
import { resolveRecipientTool } from "./resolve_recipient";
import { updateEmailInstructionsTool } from "./update_email_instructions";

export const emailTools: RemodelTool[] = [
  resolveRecipientTool,
  getEmailInstructionsTool,
  updateEmailInstructionsTool,
];
