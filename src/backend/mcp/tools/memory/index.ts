import type { RemodelTool } from "../../types";

import { writeAgentMemory } from "./write_agent_memory";
import { listAgentMemory } from "./list_agent_memory";
import { readAgentMemory } from "./read_agent_memory";
import { updateAgentMemory } from "./update_agent_memory";
import { deleteAgentMemory } from "./delete_agent_memory";
import { flushAgentMemory } from "./flush_agent_memory";

export const memoryTools: RemodelTool[] = [
  writeAgentMemory,
  listAgentMemory,
  readAgentMemory,
  updateAgentMemory,
  deleteAgentMemory,
  flushAgentMemory,
];
