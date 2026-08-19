import {
  listingPhotos,
  renderCampaignAngles,
  renderCampaignSessions,
  renderCampaigns,
  renderSessions,
} from "@backend/db";
/**
 * @fileoverview Multi-room render campaign service.
 *
 * A campaign groups many (room, listing-photo) angles under one design brief
 * and tracks their rendering as a durable Cloudflare Workflow. The service
 * creates the campaign/angle/session rows and hands execution to
 * `RenderCampaignWorkflow`.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { RemodelDb } from "../../mcp/types";

export interface CampaignAngleInput {
  roomId: number;
  listingPhotoId: number;
  isHero?: boolean;
}

export interface CreateCampaignInput {
  name: string;
  prompt: string;
  designConfig?: Record<string, unknown> | null;
  angles: CampaignAngleInput[];
}

export interface CampaignDetail {
  campaign: typeof renderCampaigns.$inferSelect;
  angles: (typeof renderCampaignAngles.$inferSelect)[];
  sessions: (typeof renderCampaignSessions.$inferSelect)[];
}

/** Resolve blank-canvas URLs for the angles that belong to a campaign. */
export async function resolveCampaignAngleUrls(
  db: RemodelDb,
  angles: CampaignAngleInput[],
): Promise<
  {
    roomId: number;
    listingPhotoId: number;
    isHero: boolean;
    url: string;
  }[]
> {
  if (angles.length === 0) return [];
  const photoIds = [...new Set(angles.map((a) => a.listingPhotoId))];
  const rows = await db
    .select()
    .from(listingPhotos)
    .where(inArray(listingPhotos.id, photoIds))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));

  const resolved = [];
  for (const a of angles) {
    const lp = byId.get(a.listingPhotoId);
    if (!lp) continue;
    const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
    if (!token) continue;
    resolved.push({
      roomId: a.roomId,
      listingPhotoId: a.listingPhotoId,
      isHero: a.isHero ?? false,
      url: token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`,
    });
  }
  return resolved;
}

/** Create a render campaign, its angles, per-room sessions, and start the workflow. */
export async function createCampaign(
  db: RemodelDb,
  env: Env,
  input: CreateCampaignInput,
): Promise<{ campaignId: string }> {
  const campaignId = crypto.randomUUID();
  const now = new Date();

  // Normalize: at most one hero; default to first angle if none marked.
  const hasHero = input.angles.some((a) => a.isHero);
  const normalizedAngles = input.angles.map((a, i) => ({
    ...a,
    isHero: hasHero ? a.isHero : i === 0,
  }));

  const resolved = await resolveCampaignAngleUrls(db, normalizedAngles);
  if (resolved.length === 0) {
    throw new Error("No resolvable angles — ensure listing photos exist and have blank canvases.");
  }

  // Sort: hero first, then by room/listing photo for deterministic order.
  resolved.sort((a, b) => {
    if (a.isHero && !b.isHero) return -1;
    if (!a.isHero && b.isHero) return 1;
    if (a.roomId !== b.roomId) return a.roomId - b.roomId;
    return a.listingPhotoId - b.listingPhotoId;
  });

  await db
    .insert(renderCampaigns)
    .values({
      id: campaignId,
      name: input.name,
      prompt: input.prompt,
      designConfig: input.designConfig ? JSON.stringify(input.designConfig) : null,
      status: "pending",
      totalAngles: resolved.length,
      completedAngles: 0,
      failedAngles: 0,
      datetimeCreated: now,
      datetimeLastModified: now,
    })
    .run();

  // One render session per distinct room.
  const roomIds = [...new Set(resolved.map((a) => a.roomId))];
  const sessionValues = roomIds.map((roomId) => ({
    id: crypto.randomUUID(),
    roomId,
    name: `${input.name} — room ${roomId}`,
    designConfig: input.designConfig ? JSON.stringify(input.designConfig) : null,
    datetimeCreated: now,
    datetimeLastModified: now,
  }));

  if (sessionValues.length > 0) {
    for (const chunk of _chunk(sessionValues, 20)) {
      await db.insert(renderSessions).values(chunk).run();
    }
  }

  const sessionByRoomId = new Map(sessionValues.map((s) => [s.roomId, s.id]));

  const angleRows = resolved.map((a, i) => ({
    campaignId,
    roomId: a.roomId,
    listingPhotoId: a.listingPhotoId,
    isHero: a.isHero,
    sortOrder: i,
    status: "pending" as const,
    sessionId: sessionByRoomId.get(a.roomId) ?? null,
  }));

  for (const chunk of _chunk(angleRows, 20)) {
    await db.insert(renderCampaignAngles).values(chunk).run();
  }

  const campaignSessionRows = sessionValues.map((s) => ({
    campaignId,
    sessionId: s.id,
    roomId: s.roomId,
    isHero: resolved.some((a) => a.roomId === s.roomId && a.isHero),
  }));

  for (const chunk of _chunk(campaignSessionRows, 20)) {
    await db.insert(renderCampaignSessions).values(chunk).run();
  }

  // Mark hero session on the campaign.
  const heroAngle = resolved.find((a) => a.isHero);
  const heroSessionId = heroAngle ? sessionByRoomId.get(heroAngle.roomId) : null;
  if (heroSessionId) {
    await db
      .update(renderCampaigns)
      .set({ heroSessionId, datetimeLastModified: new Date() })
      .where(eq(renderCampaigns.id, campaignId))
      .run();
  }

  // Start the durable workflow.
  const workflow = env.RENDER_CAMPAIGN_WORKFLOW;
  if (!workflow) {
    throw new Error("RENDER_CAMPAIGN_WORKFLOW binding is not configured");
  }
  await workflow.create({
    id: `render-campaign-${campaignId}`,
    params: { campaignId },
  });

  return { campaignId };
}

/** Fetch a campaign with all its angles and sessions. */
export async function getCampaign(
  db: RemodelDb,
  campaignId: string,
): Promise<CampaignDetail | null> {
  const campaign = await db
    .select()
    .from(renderCampaigns)
    .where(eq(renderCampaigns.id, campaignId))
    .get();
  if (!campaign) return null;

  const angles = await db
    .select()
    .from(renderCampaignAngles)
    .where(eq(renderCampaignAngles.campaignId, campaignId))
    .orderBy(renderCampaignAngles.sortOrder)
    .all();

  const sessions = await db
    .select()
    .from(renderCampaignSessions)
    .where(eq(renderCampaignSessions.campaignId, campaignId))
    .all();

  return { campaign, angles, sessions };
}

/** List campaigns newest first. */
export async function listCampaigns(
  db: RemodelDb,
  limit = 50,
  offset = 0,
): Promise<(typeof renderCampaigns.$inferSelect)[]> {
  return db
    .select()
    .from(renderCampaigns)
    .orderBy(renderCampaigns.datetimeCreated)
    .limit(limit)
    .offset(offset)
    .all();
}

/** Cancel pending angles and pause the campaign. */
export async function cancelCampaign(
  db: RemodelDb,
  campaignId: string,
): Promise<{ paused: number }> {
  const now = new Date();
  const pending = await db
    .select()
    .from(renderCampaignAngles)
    .where(
      and(
        eq(renderCampaignAngles.campaignId, campaignId),
        eq(renderCampaignAngles.status, "pending"),
      ),
    )
    .all();

  if (pending.length > 0) {
    const ids = pending.map((p) => p.id);
    for (const chunk of _chunk(ids, 20)) {
      await db
        .update(renderCampaignAngles)
        .set({ status: "skipped", datetimeLastModified: now })
        .where(inArray(renderCampaignAngles.id, chunk))
        .run();
    }
  }

  await db
    .update(renderCampaigns)
    .set({ status: "paused", datetimeLastModified: now })
    .where(eq(renderCampaigns.id, campaignId))
    .run();

  return { paused: pending.length };
}

function _chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
