/**
 * @fileoverview Per-device preferences (D1). The app has no accounts, so a
 * device — identified by the `remodel_device` cookie — is the unit of
 * preference. Currently: the default landing page the app root redirects to.
 *
 * Read by the Worker at the root (`getDeviceLandingPath`) and written by the
 * `/api/admin/config/device` API.
 */
import { devicePreferences } from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Look up a device's chosen landing path (null = none/home). */
export async function getDeviceLandingPath(env: Env, deviceId: string): Promise<string | null> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ landingPath: devicePreferences.landingPath })
    .from(devicePreferences)
    .where(eq(devicePreferences.deviceId, deviceId))
    .limit(1);
  return row?.landingPath ?? null;
}

/** Upsert a device's landing path (pass null to clear → home/no redirect). */
export async function setDeviceLandingPath(
  env: Env,
  deviceId: string,
  landingPath: string | null,
): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .insert(devicePreferences)
    .values({ deviceId, landingPath, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: devicePreferences.deviceId,
      set: { landingPath, updatedAt: new Date() },
    })
    .run();
}
