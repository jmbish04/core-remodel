import { asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  planningEpics,
  planningLogs,
  planningParticipants,
  planningTaskUpdateImages,
  planningTaskUpdates,
  planningTasks,
} from "@backend/db";
import { transcribeAudioBase64 } from "@backend/services/estimate-intake";
import { ensurePlanningSeed } from "@backend/services/planning-seed";

const planningRouter = new Hono<{ Bindings: Env }>();

type TaskStatus = "pending" | "in_progress" | "blocked" | "delayed" | "done";

const TASK_STATUS_SET = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "blocked",
  "delayed",
  "done",
]);

function parseJsonArray<T = unknown>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function coerceTaskStatus(value: unknown): TaskStatus {
  const status = typeof value === "string" ? value.trim() : "";
  if (TASK_STATUS_SET.has(status as TaskStatus)) {
    return status as TaskStatus;
  }
  return "pending";
}

function blobFromBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

async function storeAudioNote(
  env: Env,
  base64Audio: string,
  keyPrefix: string,
  mimeType: string,
): Promise<string> {
  const key = `${keyPrefix}/${crypto.randomUUID()}.webm`;
  const bytes = blobFromBase64(base64Audio);
  await env.ARTIFACTS_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: mimeType || "audio/webm" },
  });
  return key;
}

async function loadTaskDetail(env: Env, taskId: string) {
  const db = drizzle(env.DB);
  const task = await db.select().from(planningTasks).where(eq(planningTasks.id, taskId)).get();
  if (!task) return null;

  const updates = await db
    .select()
    .from(planningTaskUpdates)
    .where(eq(planningTaskUpdates.taskId, taskId))
    .orderBy(desc(planningTaskUpdates.datetimeCreated))
    .all();

  const updateIds = updates.map((row) => row.id);
  const updateImages =
    updateIds.length > 0
      ? await db
          .select()
          .from(planningTaskUpdateImages)
          .where(inArray(planningTaskUpdateImages.taskUpdateId, updateIds))
          .all()
      : [];

  const imageIdsByUpdateId = new Map<string, string[]>();
  for (const row of updateImages) {
    const items = imageIdsByUpdateId.get(row.taskUpdateId) || [];
    items.push(row.imageId);
    imageIdsByUpdateId.set(row.taskUpdateId, items);
  }

  return {
    ...task,
    supportParticipantIds: parseJsonArray<number>(task.supportParticipantIds),
    consultedParticipantIds: parseJsonArray<number>(task.consultedParticipantIds),
    informedParticipantIds: parseJsonArray<number>(task.informedParticipantIds),
    dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
    updates: updates.map((update) => ({
      ...update,
      photoImageIds: imageIdsByUpdateId.get(update.id) || [],
    })),
  };
}

planningRouter.get("/overview", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const [participants, epics, tasks, updates, logs] = await Promise.all([
      db
        .select()
        .from(planningParticipants)
        .where(eq(planningParticipants.isActive, true))
        .orderBy(asc(planningParticipants.displayName))
        .all(),
      db.select().from(planningEpics).orderBy(asc(planningEpics.phaseOrder)).all(),
      db
        .select()
        .from(planningTasks)
        .orderBy(asc(planningTasks.epicId), asc(planningTasks.taskOrder), asc(planningTasks.title))
        .all(),
      db
        .select()
        .from(planningTaskUpdates)
        .orderBy(desc(planningTaskUpdates.datetimeCreated))
        .limit(500)
        .all(),
      db
        .select()
        .from(planningLogs)
        .orderBy(desc(planningLogs.logDate), desc(planningLogs.datetimeCreated))
        .limit(100)
        .all(),
    ]);

    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    const updatesByTaskId = new Map<string, typeof updates>();
    for (const update of updates) {
      const next = updatesByTaskId.get(update.taskId) || [];
      next.push(update);
      updatesByTaskId.set(update.taskId, next);
    }

    const taskView = tasks.map((task) => {
      const taskUpdates = updatesByTaskId.get(task.id) || [];
      const latest = taskUpdates[0] || null;
      const supportIds = parseJsonArray<number>(task.supportParticipantIds);
      const consultedIds = parseJsonArray<number>(task.consultedParticipantIds);
      const informedIds = parseJsonArray<number>(task.informedParticipantIds);

      return {
        ...task,
        supportParticipantIds: supportIds,
        consultedParticipantIds: consultedIds,
        informedParticipantIds: informedIds,
        dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
        latestUpdate: latest
          ? {
              id: latest.id,
              status: latest.status,
              note: latest.note,
              transcript: latest.transcript,
              updateDate: latest.updateDate,
              source: latest.source,
              isDraft: Boolean(latest.isDraft),
              datetimeCreated: latest.datetimeCreated,
            }
          : null,
        rasci: {
          responsible:
            task.responsibleParticipantId
              ? participantById.get(task.responsibleParticipantId)?.displayName || null
              : null,
          accountable:
            task.accountableParticipantId
              ? participantById.get(task.accountableParticipantId)?.displayName || null
              : null,
          support: supportIds
            .map((id) => participantById.get(id)?.displayName || null)
            .filter((name): name is string => Boolean(name)),
          consulted: consultedIds
            .map((id) => participantById.get(id)?.displayName || null)
            .filter((name): name is string => Boolean(name)),
          informed: informedIds
            .map((id) => participantById.get(id)?.displayName || null)
            .filter((name): name is string => Boolean(name)),
        },
      };
    });

    return c.json({
      success: true,
      participants,
      epics,
      tasks: taskView,
      logs: logs.map((log) => ({
        ...log,
        content: (() => {
          try {
            return JSON.parse(log.content);
          } catch {
            return [];
          }
        })(),
      })),
      meta: {
        taskCount: tasks.length,
        openTaskCount: tasks.filter((task) => task.status !== "done").length,
        draftUpdateCount: updates.filter((update) => Boolean(update.isDraft)).length,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load planning overview",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.get("/tasks/:taskId", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const taskId = c.req.param("taskId");
    const detail = await loadTaskDetail(c.env, taskId);
    if (!detail) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json({ success: true, task: detail });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load task detail",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.post("/task-updates", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      taskId?: string;
      status?: string;
      note?: string;
      transcript?: string | null;
      source?: string | null;
      isDraft?: boolean;
      createdByParticipantId?: number | null;
      photoImageIds?: string[];
      audioBase64?: string | null;
      audioMimeType?: string | null;
      updateDate?: string | null;
    };

    const taskId = body.taskId?.trim() || "";
    if (!taskId) {
      return c.json({ error: "taskId is required" }, 400);
    }

    const existingTask = await db.select().from(planningTasks).where(eq(planningTasks.id, taskId)).get();
    if (!existingTask) {
      return c.json({ error: "Task not found" }, 404);
    }

    const status = coerceTaskStatus(body.status);
    const note = body.note?.trim() || null;
    const source = body.source?.trim() || "manual";
    const isDraft = Boolean(body.isDraft);
    const updateId = crypto.randomUUID();
    const updateDate = body.updateDate?.trim() || todayIsoDate();
    const photoImageIds = Array.isArray(body.photoImageIds)
      ? body.photoImageIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    let transcript = body.transcript?.trim() || null;
    let audioKey: string | null = null;
    const audioBase64 = body.audioBase64?.trim() || "";
    const audioMimeType = body.audioMimeType?.trim() || "audio/webm";

    if (audioBase64) {
      audioKey = await storeAudioNote(c.env, audioBase64, "planning/task-updates", audioMimeType);
      if (!transcript) {
        try {
          transcript = await transcribeAudioBase64(c.env, audioBase64);
        } catch {
          // non-blocking transcription failure
        }
      }
    }

    await db
      .insert(planningTaskUpdates)
      .values({
        id: updateId,
        taskId,
        updateDate,
        status,
        note,
        transcript,
        audioKey,
        audioMimeType,
        source,
        createdByParticipantId: body.createdByParticipantId || null,
        isDraft,
        metadata: photoImageIds.length > 0 ? JSON.stringify({ photoImageIds }) : null,
      })
      .run();

    if (photoImageIds.length > 0) {
      await db
        .insert(planningTaskUpdateImages)
        .values(
          photoImageIds.map((imageId) => ({
            taskUpdateId: updateId,
            imageId,
          })),
        )
        .run();
    }

    if (!isDraft) {
      await db
        .update(planningTasks)
        .set({
          status,
          datetimeUpdated: new Date(),
        })
        .where(eq(planningTasks.id, taskId))
        .run();
    }

    const detail = await loadTaskDetail(c.env, taskId);
    return c.json({
      success: true,
      task: detail,
      updateId,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create task update",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.post("/task-updates/:updateId/approve", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const updateId = c.req.param("updateId");
    const body = (await c.req.json().catch(() => ({}))) as {
      approvedByParticipantId?: number | null;
      applyTaskStatus?: boolean;
    };

    const updateRow = await db
      .select()
      .from(planningTaskUpdates)
      .where(eq(planningTaskUpdates.id, updateId))
      .get();

    if (!updateRow) {
      return c.json({ error: "Task update not found" }, 404);
    }

    await db
      .update(planningTaskUpdates)
      .set({
        isDraft: false,
        approvedByParticipantId: body.approvedByParticipantId || null,
        approvedAt: new Date(),
        datetimeUpdated: new Date(),
      })
      .where(eq(planningTaskUpdates.id, updateId))
      .run();

    if (body.applyTaskStatus !== false) {
      await db
        .update(planningTasks)
        .set({
          status: coerceTaskStatus(updateRow.status),
          datetimeUpdated: new Date(),
        })
        .where(eq(planningTasks.id, updateRow.taskId))
        .run();
    }

    const detail = await loadTaskDetail(c.env, updateRow.taskId);
    return c.json({
      success: true,
      task: detail,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to approve task update",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.post("/assistant/draft-update", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      taskId?: string;
      prompt?: string;
      audioBase64?: string | null;
    };

    const taskId = body.taskId?.trim() || "";
    if (!taskId) {
      return c.json({ error: "taskId is required" }, 400);
    }

    const task = await db.select().from(planningTasks).where(eq(planningTasks.id, taskId)).get();
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const prompt = body.prompt?.trim() || "";
    let transcript: string | null = null;
    if (body.audioBase64?.trim()) {
      try {
        transcript = await transcribeAudioBase64(c.env, body.audioBase64.trim());
      } catch {
        transcript = null;
      }
    }

    const combinedText = `${prompt} ${transcript || ""}`.toLowerCase();
    const suggestedStatus: TaskStatus = combinedText.includes("block")
      ? "blocked"
      : combinedText.includes("delay")
        ? "delayed"
        : combinedText.includes("done") || combinedText.includes("complete")
          ? "done"
          : combinedText.includes("start") || combinedText.includes("progress")
            ? "in_progress"
            : coerceTaskStatus(task.status);

    const suggestedNote = [
      "Assistant draft update generated from your prompt and voice memo.",
      prompt ? `Prompt: ${prompt}` : null,
      transcript ? `Transcript: ${transcript}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const updateId = crypto.randomUUID();
    await db
      .insert(planningTaskUpdates)
      .values({
        id: updateId,
        taskId,
        updateDate: todayIsoDate(),
        status: suggestedStatus,
        note: suggestedNote,
        transcript,
        source: "assistant_draft",
        isDraft: true,
      })
      .run();

    const detail = await loadTaskDetail(c.env, taskId);
    return c.json({
      success: true,
      updateId,
      suggestedStatus,
      suggestedNote,
      task: detail,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to draft assistant update",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.post("/transcribe", async (c) => {
  try {
    const body = (await c.req.json()) as {
      audioBase64?: string;
    };
    const audioBase64 = body.audioBase64?.trim() || "";
    if (!audioBase64) {
      return c.json({ error: "audioBase64 is required" }, 400);
    }
    const transcript = await transcribeAudioBase64(c.env, audioBase64);
    return c.json({
      success: true,
      transcript,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to transcribe audio",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.get("/logs", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const type = c.req.query("type")?.trim();
    const date = c.req.query("date")?.trim();
    const limit = Math.min(Math.max(Number(c.req.query("limit") || "60"), 1), 500);

    let rows: typeof planningLogs.$inferSelect[] = [];
    if (type && date) {
      rows = await db
        .select()
        .from(planningLogs)
        .where(eq(planningLogs.logType, type))
        .orderBy(desc(planningLogs.logDate), desc(planningLogs.datetimeCreated))
        .limit(limit)
        .all();
      rows = rows.filter((row) => row.logDate === date);
    } else if (type) {
      rows = await db
        .select()
        .from(planningLogs)
        .where(eq(planningLogs.logType, type))
        .orderBy(desc(planningLogs.logDate), desc(planningLogs.datetimeCreated))
        .limit(limit)
        .all();
    } else if (date) {
      rows = await db
        .select()
        .from(planningLogs)
        .where(eq(planningLogs.logDate, date))
        .orderBy(desc(planningLogs.logDate), desc(planningLogs.datetimeCreated))
        .limit(limit)
        .all();
    } else {
      rows = await db
        .select()
        .from(planningLogs)
        .orderBy(desc(planningLogs.logDate), desc(planningLogs.datetimeCreated))
        .limit(limit)
        .all();
    }

    return c.json({
      success: true,
      logs: rows.map((row) => ({
        ...row,
        content: (() => {
          try {
            return JSON.parse(row.content);
          } catch {
            return [];
          }
        })(),
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load planning logs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

planningRouter.post("/logs", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      logType?: string;
      logDate?: string;
      title?: string;
      content?: unknown;
      transcript?: string | null;
      audioBase64?: string | null;
      audioMimeType?: string | null;
      authorParticipantId?: number | null;
      taskUpdates?: Array<{
        taskId: string;
        status: string;
        note?: string;
        transcript?: string;
        photoImageIds?: string[];
      }>;
    };

    const logType = body.logType === "weekly" ? "weekly" : "daily";
    const logDate = body.logDate?.trim() || todayIsoDate();
    const title =
      body.title?.trim() || `${logType === "daily" ? "Daily" : "Weekly"} log - ${logDate}`;
    const content = body.content ?? [];
    const serializedContent =
      typeof content === "string" ? content : JSON.stringify(content);

    let transcript = body.transcript?.trim() || null;
    let audioKey: string | null = null;
    const audioBase64 = body.audioBase64?.trim() || "";
    const audioMimeType = body.audioMimeType?.trim() || "audio/webm";

    if (audioBase64) {
      audioKey = await storeAudioNote(c.env, audioBase64, "planning/logs", audioMimeType);
      if (!transcript) {
        try {
          transcript = await transcribeAudioBase64(c.env, audioBase64);
        } catch {
          // non-blocking transcription failure
        }
      }
    }

    const logId = crypto.randomUUID();
    await db
      .insert(planningLogs)
      .values({
        id: logId,
        logType,
        logDate,
        title,
        content: serializedContent,
        transcript,
        audioKey,
        audioMimeType,
        authorParticipantId: body.authorParticipantId || null,
      })
      .run();

    const taskUpdates = Array.isArray(body.taskUpdates) ? body.taskUpdates : [];
    for (const update of taskUpdates) {
      const taskId = String(update.taskId || "").trim();
      if (!taskId) continue;
      const task = await db.select().from(planningTasks).where(eq(planningTasks.id, taskId)).get();
      if (!task) continue;

      const updateId = crypto.randomUUID();
      const status = coerceTaskStatus(update.status);
      const note = (update.note || "").trim();

      await db
        .insert(planningTaskUpdates)
        .values({
          id: updateId,
          taskId,
          updateDate: logDate,
          status,
          note: note || null,
          transcript: update.transcript?.trim() || null,
          source: logType === "daily" ? "daily_log" : "weekly_log",
          isDraft: false,
          metadata: JSON.stringify({ parentLogId: logId }),
        })
        .run();

      const photoImageIds = Array.isArray(update.photoImageIds)
        ? update.photoImageIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
      if (photoImageIds.length > 0) {
        await db
          .insert(planningTaskUpdateImages)
          .values(
            photoImageIds.map((imageId) => ({
              taskUpdateId: updateId,
              imageId,
            })),
          )
          .run();
      }

      await db
        .update(planningTasks)
        .set({
          status,
          datetimeUpdated: new Date(),
        })
        .where(eq(planningTasks.id, taskId))
        .run();
    }

    const inserted = await db.select().from(planningLogs).where(eq(planningLogs.id, logId)).get();
    return c.json({
      success: true,
      log: inserted,
      appliedTaskUpdates: taskUpdates.length,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to save planning log",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { planningRouter };
