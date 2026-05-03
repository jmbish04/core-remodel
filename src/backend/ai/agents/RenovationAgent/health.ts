import type { RenovationAgent } from "./index";
import { getAgentByName } from "agents";

interface ModuleResult {
  status: string;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Agent RPC health check — verifies the RenovationAgent Durable Object is
 * reachable and can respond to RPC calls.
 */
export async function checkRenovationAgentRPC(env: Env): Promise<ModuleResult> {
  const start = Date.now();
  try {
    const stub = await getAgentByName<Env, RenovationAgent>(env.RENOVATION_AGENT as any, "global");
    const result = await stub.healthProbe();
    if (!result || typeof result !== "object" || !("status" in result)) {
      throw new Error("Invalid response from agent");
    }
    return result as ModuleResult;
  } catch (e) {
    return {
      status: "fail",
      latencyMs: Date.now() - start,
      error: `RenovationAgent RPC failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
