import {
  listingPhotos,
  renderCampaignAngles,
  renderCampaigns,
  renderCanvases,
  renderSessions,
} from "@backend/db";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
/**
 * @fileoverview Durable Workflow for multi-room, multi-angle render campaigns.
 *
 * Processes every enrolled angle sequentially: the hero angle is rendered first,
 * then each remaining angle receives the hero canvas as a ReferenceImage so the
 * model keeps materials/layout consistent across rooms. Survives isolate churn
 * and redeploys because each angle is a Workflow step whose result is persisted.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { runStage } from "./stage-runner";

export interface RenderCampaignWorkflowParams {
  campaignId: string;
}

interface AngleWithUrl {
  id: number;
  roomId: number;
  listingPhotoId: number;
  isHero: boolean;
  sortOrder: number;
  sessionId: string;
  url: string;
}

function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

export class RenderCampaignWorkflow extends WorkflowEntrypoint<Env, RenderCampaignWorkflowParams> {
  async run(
    event: WorkflowEvent<RenderCampaignWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ campaignId: string; done: number; failed: number }> {
    const { campaignId } = event.payload;
    const db = drizzle(this.env.DB);

    // 1. Load and lock the campaign into "running".
    const campaign = await step.do("load-campaign", async () => {
      const row = await db
        .select()
        .from(renderCampaigns)
        .where(eq(renderCampaigns.id, campaignId))
        .get();
      if (!row) throw new Error(`Campaign ${campaignId} not found`);
      return row;
    });

    await step.do("mark-running", async () => {
      await db
        .update(renderCampaigns)
        .set({ status: "running", datetimeLastModified: new Date() })
        .where(eq(renderCampaigns.id, campaignId))
        .run();
      return { status: "running" };
    });

    // 2. Resolve all angles with their blank-canvas URLs and session ids.
    const angles = await step.do("load-angles", async () => {
      const rows = await db
        .select()
        .from(renderCampaignAngles)
        .where(eq(renderCampaignAngles.campaignId, campaignId))
        .orderBy(renderCampaignAngles.sortOrder)
        .all();

      const photoIds = [
        ...new Set(rows.map((r) => r.listingPhotoId).filter((id): id is number => id != null)),
      ];
      const photos =
        photoIds.length > 0
          ? await db.select().from(listingPhotos).where(inArray(listingPhotos.id, photoIds)).all()
          : [];
      const photoById = new Map(photos.map((p) => [p.id, p]));

      const out: AngleWithUrl[] = [];
      for (const r of rows) {
        if (r.status === "skipped") continue;
        if (!r.sessionId || r.listingPhotoId == null) continue;
        const lp = photoById.get(r.listingPhotoId);
        if (!lp) continue;
        const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
        if (!token) continue;
        out.push({
          id: r.id,
          roomId: r.roomId ?? lp.roomId ?? 0,
          listingPhotoId: r.listingPhotoId,
          isHero: r.isHero,
          sortOrder: r.sortOrder,
          sessionId: r.sessionId,
          url: deliveryUrlFromToken(token),
        });
      }
      // Hero first, then existing sort order.
      out.sort((a, b) => {
        if (a.isHero && !b.isHero) return -1;
        if (!a.isHero && b.isHero) return 1;
        return a.sortOrder - b.sortOrder;
      });
      return out;
    });

    if (angles.length === 0) {
      await step.do("mark-done-empty", async () => {
        await db
          .update(renderCampaigns)
          .set({ status: "done", datetimeLastModified: new Date() })
          .where(eq(renderCampaigns.id, campaignId))
          .run();
        return { status: "done" };
      });
      return { campaignId, done: 0, failed: 0 };
    }

    // 3. Render the hero angle first and capture its delivery URL.
    let heroDeliveryUrl: string | undefined;
    const hero = angles[0];

    const heroResult = await step.do(`render-hero:${hero.listingPhotoId}`, async () => {
      await db
        .update(renderCampaignAngles)
        .set({ status: "running", datetimeLastModified: new Date() })
        .where(eq(renderCampaignAngles.id, hero.id))
        .run();

      try {
        const canvas = await runStage({
          env: this.env,
          sessionId: hero.sessionId,
          type: "stage_3_LP_finish",
          inputImageUrl: hero.url,
          prompt: campaign.prompt ?? "Render this room with the selected design.",
          listingPhotoId: hero.listingPhotoId,
          roomId: hero.roomId,
        });

        await db
          .update(renderCampaignAngles)
          .set({
            status: canvas.status,
            canvasId: canvas.id,
            datetimeLastModified: new Date(),
          })
          .where(eq(renderCampaignAngles.id, hero.id))
          .run();

        return {
          ok: true as const,
          canvasId: canvas.id,
          deliveryUrl: canvas.outputDeliveryUrl,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(renderCampaignAngles)
          .set({ status: "failed", error: message, datetimeLastModified: new Date() })
          .where(eq(renderCampaignAngles.id, hero.id))
          .run();
        return { ok: false as const, error: message };
      }
    });

    if (heroResult.ok && heroResult.deliveryUrl) {
      heroDeliveryUrl = heroResult.deliveryUrl;
      await step.do("set-hero-canvas", async () => {
        await db
          .update(renderSessions)
          .set({ heroCanvasId: heroResult.canvasId, datetimeLastModified: new Date() })
          .where(eq(renderSessions.id, hero.sessionId))
          .run();
        return { heroCanvasId: heroResult.canvasId };
      });
    }

    // 4. Render remaining angles sequentially, referencing the hero output.
    let done = heroResult.ok ? 1 : 0;
    let failed = heroResult.ok ? 0 : 1;

    for (const angle of angles.slice(1)) {
      const result = await step.do(`render-angle:${angle.listingPhotoId}`, async () => {
        await db
          .update(renderCampaignAngles)
          .set({ status: "running", datetimeLastModified: new Date() })
          .where(eq(renderCampaignAngles.id, angle.id))
          .run();

        try {
          const references = heroDeliveryUrl
            ? [
                {
                  url: heroDeliveryUrl,
                  label:
                    "the same design (hero render) — match materials, layout, and fixtures exactly",
                },
              ]
            : undefined;

          const canvas = await runStage({
            env: this.env,
            sessionId: angle.sessionId,
            type: "stage_3_LP_finish",
            inputImageUrl: angle.url,
            prompt: `${campaign.prompt ?? "Render this room with the selected design."}\n\nThis is the SAME home design shown in the reference image — render it from THIS camera angle, matching the reference's materials, layout, cabinetry, and fixtures exactly. Keep this room's real walls, windows, and openings unchanged.`,
            listingPhotoId: angle.listingPhotoId,
            roomId: angle.roomId,
            references,
          });

          await db
            .update(renderCampaignAngles)
            .set({
              status: canvas.status,
              canvasId: canvas.id,
              datetimeLastModified: new Date(),
            })
            .where(eq(renderCampaignAngles.id, angle.id))
            .run();

          return { ok: true as const, canvasId: canvas.id };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .update(renderCampaignAngles)
            .set({ status: "failed", error: message, datetimeLastModified: new Date() })
            .where(eq(renderCampaignAngles.id, angle.id))
            .run();
          return { ok: false as const, error: message };
        }
      });

      if (result.ok) {
        done += 1;
      } else {
        failed += 1;
      }
    }

    // 5. Finalize campaign status.
    await step.do("finalize-campaign", async () => {
      const status = failed > 0 && done === 0 ? "failed" : "done";
      await db
        .update(renderCampaigns)
        .set({
          status,
          completedAngles: done,
          failedAngles: failed,
          datetimeLastModified: new Date(),
        })
        .where(eq(renderCampaigns.id, campaignId))
        .run();
      return { status, done, failed };
    });

    return { campaignId, done, failed };
  }
}
