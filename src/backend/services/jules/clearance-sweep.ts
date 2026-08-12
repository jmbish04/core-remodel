/**
 * @fileoverview Kickoff for the weekly clearance sweep.
 *
 * PRIMARY path: hand the clearance links to the {@link JulesClearanceAgent} DO,
 * which stands up a repoless Jules session and batch-analyses the pages on its
 * own alarm loop (so the sweep is never bound by the `scheduled` wall). FALLBACK:
 * if no `JULES_API_KEY` is configured, run the inline Workers-AI sweep directly.
 *
 * A single DO instance (`idFromName("clearance-sweep")`) runs the sweep — the
 * weekly cadence means runs never overlap, so one instance is all we need.
 */
import { JulesClient } from "@backend/services/jules/client";
import {
  discoverClearanceLinks,
  type DiscoverySummary,
} from "@backend/services/showroom/clearance-discovery";
import { collectClearanceLinks, sweepShowroomSales } from "@backend/services/showroom/sales";

const SWEEP_SINGLETON = "clearance-sweep";

export interface ClearanceKickoff {
  /** "jules" when handed to the DO, "fallback" when run inline on Workers-AI. */
  mode: "jules" | "fallback";
  /** DO job id (jules mode) — poll the DO's /status?jobId= for progress. */
  jobId?: string;
  links: number;
  /** Present only in fallback mode (the inline sweep runs synchronously). */
  summary?: Awaited<ReturnType<typeof sweepShowroomSales>>;
  /** Present when discovery ran first (weekly cron / `discover:true`). */
  discovery?: DiscoverySummary;
}

export async function startClearanceSweep(
  env: Env,
  opts: { limit?: number; discover?: boolean } = {},
): Promise<ClearanceKickoff> {
  const limit = opts.limit ?? 40;

  // Discover new clearance links first (plain-fetch sitemap/homepage scan) so the
  // sweep this run picks up any newly-registered pages. Cheap and idempotent —
  // on by default for the weekly cron; skippable for a quick manual sweep.
  const discovery =
    opts.discover === false
      ? undefined
      : await discoverClearanceLinks(env).catch((err) => {
          console.error("[clearance] discovery failed (continuing to sweep):", err);
          return undefined;
        });

  // No Jules key → inline Workers-AI fallback sweep.
  const client = await JulesClient.fromEnv(env);
  if (!client) {
    const summary = await sweepShowroomSales(env, { limit });
    return { mode: "fallback", links: summary.pagesScanned, summary, discovery };
  }

  const links = await collectClearanceLinks(env, limit);
  if (links.length === 0) return { mode: "jules", links: 0, discovery };

  const stub = env.JULES_CLEARANCE_AGENT.get(env.JULES_CLEARANCE_AGENT.idFromName(SWEEP_SINGLETON));
  const res = await stub.fetch("https://do/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ links }),
  });
  const body = (await res.json().catch(() => ({}))) as { jobId?: string };
  return { mode: "jules", jobId: body.jobId, links: links.length, discovery };
}
