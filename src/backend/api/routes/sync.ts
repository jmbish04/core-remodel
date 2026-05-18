import { estimateSyncState, googleSheetSyncEvents } from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import {
  applyGoogleSheetsWorkbookPush,
  buildGoogleSheetsWorkbook,
  GOOGLE_SHEETS_WORKBOOK_TEMPLATE,
  REFERENCE_SHEET_FINDINGS,
} from "@backend/services/google-sheets-sync";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const syncRouter = new Hono<{ Bindings: Env }>();

async function getOrCreateSyncState(env: Env) {
  const db = drizzle(env.DB);
  let row = await db
    .select()
    .from(estimateSyncState)
    .where(eq(estimateSyncState.target, "google_sheets"))
    .get();

  if (!row) {
    const inserted = await db
      .insert(estimateSyncState)
      .values({
        target: "google_sheets",
        notes: "Initialized",
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .returning();
    row = inserted[0];
  }

  return row;
}

syncRouter.get("/google-sheets/template", async (c) => {
  try {
    const includeWorkbook = c.req.query("includeWorkbook") === "true";
    return c.json({
      template: GOOGLE_SHEETS_WORKBOOK_TEMPLATE,
      referenceSheets: REFERENCE_SHEET_FINDINGS,
      workbook: includeWorkbook ? await buildGoogleSheetsWorkbook(c.env) : null,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load Google Sheets template",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

syncRouter.get("/google-sheets/status", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const row = await getOrCreateSyncState(c.env);
    const recentEvents = await db
      .select()
      .from(googleSheetSyncEvents)
      .orderBy(desc(googleSheetSyncEvents.id))
      .limit(20)
      .all();

    return c.json({
      target: row.target,
      lastPullAt: row.lastPullAt,
      lastPushAt: row.lastPushAt,
      cursorValue: row.cursorValue,
      syncHash: row.syncHash,
      notes: row.notes,
      recentEvents,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load Google Sheets sync status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

syncRouter.post("/google-sheets/pull", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      notes?: string;
      cursorValue?: string;
      syncHash?: string;
      changedBy?: string;
      idempotencyKey?: string;
    };

    const db = drizzle(c.env.DB);
    const now = new Date();
    const state = await getOrCreateSyncState(c.env);
    const workbook = await buildGoogleSheetsWorkbook(c.env);
    const idempotencyKey =
      body.idempotencyKey?.trim() ||
      c.req.header("x-idempotency-key")?.trim() ||
      crypto.randomUUID();

    await db.insert(googleSheetSyncEvents).values({
      target: "google_sheets",
      direction: "pull",
      idempotencyKey,
      cursorValue: workbook.meta.cursor,
      syncHash: workbook.meta.syncHash,
      requestJson: JSON.stringify({
        notes: body.notes || null,
        changedBy: body.changedBy || null,
      }),
      resultJson: JSON.stringify({
        cursor: workbook.meta.cursor,
        syncHash: workbook.meta.syncHash,
        generatedAt: workbook.meta.generatedAt,
        source: workbook.meta.source,
      }),
      datetimeCreated: now,
    });

    const updated = await db
      .update(estimateSyncState)
      .set({
        lastPullAt: now,
        cursorValue: body.cursorValue?.trim() || workbook.meta.cursor,
        syncHash: body.syncHash?.trim() || workbook.meta.syncHash,
        notes: body.notes?.trim() || "Pulled workbook snapshot from D1",
        datetimeUpdated: now,
      })
      .where(eq(estimateSyncState.id, state.id))
      .returning();

    try {
      await publishRealtimeEvent(c.env, "home", {
        event: "sync.google_sheets.pull.completed",
        at: new Date().toISOString(),
        cursor: workbook.meta.cursor,
        syncHash: workbook.meta.syncHash,
      });
    } catch {
      // non-fatal
    }

    return c.json({
      success: true,
      mode: "pull",
      state: updated[0],
      template: GOOGLE_SHEETS_WORKBOOK_TEMPLATE,
      workbook,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to run Google Sheets pull sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

syncRouter.post("/google-sheets/push", async (c) => {
  try {
    const body = (await c.req.json()) as {
      idempotencyKey?: string;
      notes?: string;
      cursorValue?: string;
      syncHash?: string;
      changedBy?: string;
      changeSource?: string;
      workbook?: {
        tabs?: Record<string, Array<Record<string, unknown>>>;
        meta?: {
          cursor?: string;
          syncHash?: string;
        };
      };
    };

    const idempotencyKey = body.idempotencyKey?.trim() || c.req.header("x-idempotency-key")?.trim();
    if (!idempotencyKey) {
      return c.json(
        {
          error: "idempotencyKey is required",
        },
        400,
      );
    }

    const result = await applyGoogleSheetsWorkbookPush(c.env, {
      idempotencyKey,
      changedBy: body.changedBy?.trim() || null,
      changeSource: body.changeSource?.trim() || "google_sheets_push",
      workbook: body.workbook,
    });

    const db = drizzle(c.env.DB);
    const now = new Date();
    const state = await getOrCreateSyncState(c.env);

    const updated = await db
      .update(estimateSyncState)
      .set({
        lastPushAt: now,
        cursorValue:
          body.cursorValue?.trim() || body.workbook?.meta?.cursor?.trim() || state.cursorValue,
        syncHash: body.syncHash?.trim() || body.workbook?.meta?.syncHash?.trim() || state.syncHash,
        notes: body.notes?.trim() || "Applied Google Sheets push payload",
        datetimeUpdated: now,
      })
      .where(eq(estimateSyncState.id, state.id))
      .returning();

    try {
      await publishRealtimeEvent(c.env, "home", {
        event: "sync.google_sheets.push.applied",
        at: new Date().toISOString(),
        result,
      });
      await publishRealtimeEvent(c.env, "home", {
        event: "budget.sync.push.applied",
        at: new Date().toISOString(),
        result,
      });
    } catch {
      // non-fatal
    }

    return c.json({
      success: true,
      mode: "push",
      state: updated[0],
      result,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to run Google Sheets push sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { syncRouter };
