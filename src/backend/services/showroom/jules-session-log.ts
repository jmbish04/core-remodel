import {
  julesClearanceSessions,
  type JulesClearanceStatus,
} from "@backend/db/schema/showroom/index";
/**
 * @fileoverview D1 logging for Jules clearance sweeps — records each run in
 * `jules_clearance_sessions` (our session_uuid + the Jules session id + outcome)
 * so a billed Jules run is auditable from D1, not just the DO's ephemeral KV.
 *
 * Every write is best-effort: a logging failure must never abort a sweep, so the
 * DO wraps these in try/catch. Keyed by `session_uuid` (never the autoincrement
 * id) so the DO can update by the value it already holds.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Insert the run row at job start (Jules session id not known yet). */
export async function startJulesSessionLog(
  env: Env,
  params: { sessionUuid: string; jobId: string; linksTotal: number },
): Promise<void> {
  await drizzle(env.DB).insert(julesClearanceSessions).values({
    sessionUuid: params.sessionUuid,
    jobId: params.jobId,
    linksTotal: params.linksTotal,
    status: "booting",
  });
}

/** Record the Jules API session id once the repoless VM session is created. */
export async function setJulesSessionId(
  env: Env,
  sessionUuid: string,
  julesSessionId: string,
): Promise<void> {
  await drizzle(env.DB)
    .update(julesClearanceSessions)
    .set({ julesSessionId, status: "running", updatedAt: new Date() })
    .where(eq(julesClearanceSessions.sessionUuid, sessionUuid));
}

/** Persist the final outcome (status + summary counts) when the sweep ends. */
export async function finishJulesSessionLog(
  env: Env,
  sessionUuid: string,
  status: JulesClearanceStatus,
  summary: {
    pages: number;
    recorded: number;
    unchanged: number;
    empty: number;
    errors: number;
    fallback: number;
  },
): Promise<void> {
  await drizzle(env.DB)
    .update(julesClearanceSessions)
    .set({ status, ...summary, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(julesClearanceSessions.sessionUuid, sessionUuid));
}
