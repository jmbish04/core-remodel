/**
 * MCP request authentication.
 *
 * Two accepted identities:
 *   - worker: the shared WORKER_API_KEY bearer, or an already-authenticated
 *     app request (cookie/session via isRequestAuthenticated). Full tool access.
 *   - research: a scoped, expiring Deep Research token minted into CACHE. Limited
 *     to tools flagged `research: true`.
 */
import {
  researchMcpTokenKey,
  type DeepResearchMcpTokenRecord,
} from "@backend/services/gemini/deep-research";
import { isRequestAuthenticated } from "@backend/utils/access";

import type { McpAuthContext } from "./types";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim();
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice("bearer ".length).trim();
}

export async function authenticateMcpRequest(
  request: Request,
  env: Env,
): Promise<McpAuthContext | null> {
  const token = bearerToken(request);
  if (token) {
    const workerKey = (await env.WORKER_API_KEY.get())?.trim();
    if (workerKey && token === workerKey) {
      return { kind: "worker" };
    }

    if (env.CACHE) {
      const rawRecord = await env.CACHE.get(researchMcpTokenKey(token));
      if (rawRecord) {
        try {
          const record = JSON.parse(rawRecord) as DeepResearchMcpTokenRecord;
          if (new Date(record.expiresAt).getTime() > Date.now()) {
            return { kind: "research", token, scope: record.scope };
          }
        } catch {
          return null;
        }
      }
    }
  }

  if (await isRequestAuthenticated(request, env)) {
    return { kind: "worker" };
  }

  return null;
}
