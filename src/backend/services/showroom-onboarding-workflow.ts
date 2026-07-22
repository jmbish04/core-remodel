/**
 * @fileoverview Durable showroom-onboarding workflow.
 *
 * MCP tool handlers have no `executionCtx.waitUntil`, so any enrichment they
 * leave un-awaited is cancelled when the request isolate finishes. Previously
 * `create_showroom` / `import_showroom_from_place` worked around this by AWAITING
 * the full enrichment inline (`Promise.allSettled(tasks)`) — which took ~25s+ and
 * routinely outran the MCP client/transport timeout (the tool errored while the
 * work completed server-side; a retry then hit placeId idempotency).
 *
 * This workflow moves that work off the request path: the tool inserts the store
 * row (`scrapeStatus: "pending"`), kicks this workflow, and returns immediately.
 * The workflow awaits the research / category / photo / brand pipeline durably.
 * The website scrape it triggers runs as its OWN {@link ShowroomScrapeWorkflow},
 * which owns the `scrapeStatus` lifecycle (pending → running → complete/failed) —
 * that column is the poll signal for `check_showroom_intake_status`. When there
 * is no website (nothing to scrape), we flip `scrapeStatus` to "complete" here so
 * the status resolves.
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { startRun } from "@backend/services/agent-runs";
import { ledgerSteps } from "@backend/services/agent-run-workflow";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { showroomStores } from "@backend/db/schema/showroom/index";
import {
  scheduleShowroomEnrichment,
  type EnrichmentInput,
} from "@backend/services/showroom/onboarding";

export interface ShowroomOnboardingParams {
  showroomId: number;
  enrichment: EnrichmentInput;
}

export class ShowroomOnboardingWorkflow extends WorkflowEntrypoint<
  Env,
  ShowroomOnboardingParams
> {
  async run(event: WorkflowEvent<ShowroomOnboardingParams>, rawStep: WorkflowStep) {
    const { showroomId, enrichment } = event.payload;
    const env = this.env;

    const run = await startRun(env, {
      agent: "showroom-onboarding",
      operation: "onboard_showroom",
      targetType: "showroom_store",
      targetId: String(showroomId),
      input: { showroomId },
      triggeredBy: "agent",
    });
    const step = ledgerSteps(rawStep, run);

    // scheduleShowroomEnrichment guards every unit internally, so allSettled
    // never rejects → this step succeeds and runs exactly once (no retry that
    // would double-insert photos/brands).
    await step.do("enrich", async () => {
      const tasks: Promise<unknown>[] = [];
      scheduleShowroomEnrichment(env, { id: showroomId }, enrichment, (p) =>
        tasks.push(p),
      );
      await Promise.allSettled(tasks);
    });

    // No website → no ShowroomScrapeWorkflow was kicked to own scrapeStatus, so
    // finalize the intake here (the enrichment above has already settled).
    if (!enrichment.websiteUrl) {
      await step.do("finalize-no-scrape", async () => {
        const db = drizzle(env.DB);
        await db
          .update(showroomStores)
          .set({ scrapeStatus: "complete", updatedAt: new Date() })
          .where(eq(showroomStores.id, showroomId));
      });
    }

    await run.succeed({ showroomId, hadWebsite: Boolean(enrichment.websiteUrl) });
  }
}
