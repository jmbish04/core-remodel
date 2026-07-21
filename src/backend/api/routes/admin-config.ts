import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { projectSystemVariables } from "@backend/db";
import { probePropertyRecords } from "@backend/services/dbi/permits-sync";
import { getDeviceLandingPath, setDeviceLandingPath } from "@backend/services/device-preferences";
import {
  getDeviceIdFromRequest,
  isRequestAuthenticated,
  isSafeInternalPath,
  setDeviceCookie,
} from "@backend/utils/access";

export const adminConfigRouter = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const db = drizzle(c.env.DB);
    const variables = await db.select().from(projectSystemVariables).all();
    return c.json({ variables });
  })
  // This device's landing preference. GET ensures the device cookie exists and
  // returns the active landing path; PUT saves it. `isAdmin` gates the admin
  // landing options in the UI (this route is already admin-gated, so it's true).
  .get("/device", async (c) => {
    let deviceId = getDeviceIdFromRequest(c.req.raw);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      setDeviceCookie(c, deviceId);
    }
    const landingPath = await getDeviceLandingPath(c.env, deviceId);
    const isAdmin = await isRequestAuthenticated(c.req.raw, c.env);
    return c.json({ deviceId, landingPath, isAdmin });
  })
  .put(
    "/device",
    zValidator("json", z.object({ landingPath: z.string().nullable() })),
    async (c) => {
      let deviceId = getDeviceIdFromRequest(c.req.raw);
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        setDeviceCookie(c, deviceId);
      }
      const { landingPath } = c.req.valid("json");
      // Normalize: only accept a safe in-app path (not the login page); anything
      // else — including "/" — clears the preference (home / no redirect).
      const normalized =
        landingPath && landingPath !== "/" && isSafeInternalPath(landingPath) ? landingPath : null;
      await setDeviceLandingPath(c.env, deviceId, normalized);
      return c.json({ ok: true, landingPath: normalized });
    },
  )
  // "Test SODA" — run the property query (no writes) and report matched counts
  // per permit dataset, so the saved address/block/lot can be verified.
  .post("/soda-test", async (c) => {
    try {
      const result = await probePropertyRecords(c.env);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "SODA probe failed" }, 502);
    }
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        variables: z.array(
          z.object({
            variableKey: z.string(),
            valueText: z.string(),
            unit: z.string().nullable().optional(),
            category: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
            mappingRefKey: z.string().nullable().optional(),
          })
        ),
      })
    ),
    async (c) => {
      const db = drizzle(c.env.DB);
      const { variables } = c.req.valid("json");

      // `db.batch()`, NOT `db.transaction()`. D1 rejects SQL `BEGIN` outright
      // (error 7500 — "please use the state.storage.transaction() ... APIs
      // instead"), and drizzle's D1 driver implements `.transaction()` by
      // issuing raw `begin`/`commit` as separate statements. So a
      // `db.transaction()` here threw on its FIRST statement and this endpoint
      // never saved anything — the config page looked like it worked because
      // the form falls back to client-side defaults on reload.
      // `batch()` is D1's real atomic primitive: one all-or-nothing unit.
      const upserts = variables.map((variable) => {
        const mappingRefKey = variable.mappingRefKey || variable.variableKey;
        return db
          .insert(projectSystemVariables)
          .values({
            variableKey: variable.variableKey,
            valueText: variable.valueText,
            unit: variable.unit || null,
            category: variable.category || null,
            description: variable.description || null,
            mappingRefKey,
          })
          .onConflictDoUpdate({
            target: projectSystemVariables.variableKey,
            set: {
              valueText: variable.valueText,
              unit: variable.unit || null,
              category: variable.category || null,
              description: variable.description || null,
              mappingRefKey,
            },
          });
      });

      // batch() requires at least one statement; an empty save is a no-op.
      if (upserts.length > 0) {
        await db.batch(upserts as [(typeof upserts)[number], ...(typeof upserts)[number][]]);
      }

      const updated = await db.select().from(projectSystemVariables).all();
      return c.json({ success: true, variables: updated });
    }
  );
