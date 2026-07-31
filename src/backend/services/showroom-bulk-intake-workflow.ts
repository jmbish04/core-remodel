/**
 * @fileoverview Durable bulk showroom-intake workflow.
 *
 * `bulk_import_showrooms_from_places` (MCP) accepts an ARRAY of Google place_ids,
 * writes one `queued` row per id into `showroom_bulk_intake_items`, kicks THIS
 * workflow, and returns immediately — so the calling AI model spends tokens on
 * ONE tool round-trip instead of one per store (the whole point: set-and-forget).
 *
 * The workflow then loops the batch server-side, running the EXACT single-store
 * intake per id (`intakeOnePlace`: Places Details → dedupe/adopt → insert → kick
 * ShowroomOnboardingWorkflow) and stamping each item's outcome. Per-item work is a
 * self-contained step that CATCHES its own error and records `failed` rather than
 * throwing — so one bad id never sinks the batch, and a step retry can never
 * double-run the intake (which would double-create a store / re-kick onboarding).
 *
 * `check_bulk_intake_status` reads the item rows back so a model can look in on a
 * running batch and spot one that got stuck.
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { showroomBulkIntakeItems } from "@backend/db/schema/showroom/index";
import { intakeOnePlace } from "@backend/mcp/tools/showrooms/_shared";

export interface ShowroomBulkIntakeParams {
  batchId: string;
  placeIds: string[];
}

export class ShowroomBulkIntakeWorkflow extends WorkflowEntrypoint<
  Env,
  ShowroomBulkIntakeParams
> {
  async run(event: WorkflowEvent<ShowroomBulkIntakeParams>, step: WorkflowStep) {
    const { batchId, placeIds } = event.payload;
    const env = this.env;
    const db = drizzle(env.DB);

    let done = 0;
    let failed = 0;

    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];

      // One durable step per item. It NEVER throws (catches internally + records
      // the outcome to D1), so it runs exactly once — no retry that would
      // double-create the store or re-kick onboarding.
      const match = and(
        eq(showroomBulkIntakeItems.batchId, batchId),
        eq(showroomBulkIntakeItems.placeId, placeId),
      );

      const outcome = await step.do(`intake-${i}-${placeId.slice(0, 24)}`, async () => {
        await db
          .update(showroomBulkIntakeItems)
          .set({ status: "processing", attempts: 1, updatedAt: new Date() })
          .where(match);

        try {
          const r = await intakeOnePlace(env, db, placeId);
          await db
            .update(showroomBulkIntakeItems)
            .set({
              status: "done",
              storeId: r.showroomId,
              resultStatus: r.status,
              error: null,
              updatedAt: new Date(),
            })
            .where(match);
          return "done" as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .update(showroomBulkIntakeItems)
            .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
            .where(match);
          return "failed" as const;
        }
      });

      if (outcome === "done") done++;
      else failed++;
    }

    return { batchId, total: placeIds.length, done, failed };
  }
}
