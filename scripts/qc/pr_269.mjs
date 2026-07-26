#!/usr/bin/env node
/**
 * QC for PR #269 — phase-grouped, live-updating preview changelog tasks.
 * Run: node scripts/qc/pr_269.mjs --preview   (or bare for prod)
 *
 * Self-contained: files a QC proposal with multi-phase tasks, drives the surface
 * this PR added/changed over HTTP, and tears the rows back out of D1 afterward.
 *
 * Proves:
 *  1. A proposal seeds plan_tasks carrying phase + sortOrder (so the frontend can
 *     group + order them) and prNumber (null until set).
 *  2. GET /proposals/:slug returns those live tasks with the new fields.
 *  3. PATCH /api/admin/plans/tasks/:id accepts prNumber + the `in_review` status
 *     (both were missing before) and persists them.
 *  4. The live status is reflected on the next proposal read (the "follow along"
 *     path — a poll/WS refetch sees exactly this).
 *  5. The /api/realtime/plans gateway → EstimateCollabHub DO is reachable, and a
 *     PATCH fans a poke out to a connected websocket (the realtime path), when a
 *     WebSocket client is available in the runtime.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_269 (changelog live phases) against ${BASE}\n`);

const SLUG = "__qc_pr269__";

/** Run one SQL statement against remote D1, return result rows. */
function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

try {
  // ── 1. File the proposal with multi-phase tasks ───────────────────────────
  const filed = await c.post("/api/changelog/proposals", {
    slug: SLUG,
    title: "QC — live phases",
    summary: "QC proposal exercising phase grouping + live task progress.",
    area: "changelog",
    tasks: [
      { taskKey: "QC-P0-01", title: "infra task", workstream: "infra", phase: 0, sortOrder: 0 },
      { taskKey: "QC-P1-02", title: "api task",   workstream: "api",   phase: 1, sortOrder: 1 },
      { taskKey: "QC-P1-01", title: "api task a",  workstream: "api",   phase: 1, sortOrder: 0 },
      { taskKey: "QC-P2-01", title: "ui task",    workstream: "frontend", phase: 2, sortOrder: 0 },
    ],
  });
  check("POST /proposals returns 2xx", filed.status === 200 || filed.status === 201, `status=${filed.status} ${filed.text?.slice(0, 160)}`);
  check("seeded 4 plan_tasks", filed.json?.tasksSeeded === 4, `tasksSeeded=${filed.json?.tasksSeeded}`);

  // ── 2. GET the bundle → live tasks carry phase + sortOrder + prNumber ──────
  const got = await c.get(`/api/changelog/proposals/${SLUG}`);
  check("GET /proposals/:slug returns 200", got.status === 200, `status=${got.status}`);
  const tasks = got.json?.tasks ?? [];
  check("bundle returns 4 tasks", tasks.length === 4, `got ${tasks.length}`);
  const p1 = tasks.filter((t) => t.phase === 1);
  check("tasks carry a numeric phase", tasks.every((t) => typeof t.phase === "number"), JSON.stringify(tasks.map((t) => [t.taskKey, t.phase])));
  check("phase 1 has two tasks (grouping input)", p1.length === 2, `p1=${p1.length}`);
  check("tasks carry sortOrder", tasks.every((t) => typeof t.sortOrder === "number"), JSON.stringify(tasks.map((t) => [t.taskKey, t.sortOrder])));
  check("prNumber is null before any PR", tasks.every((t) => t.prNumber == null), JSON.stringify(tasks.map((t) => [t.taskKey, t.prNumber])));

  const target = tasks.find((t) => t.taskKey === "QC-P1-01");
  check("target task has a numeric id", Number.isFinite(target?.id), `id=${target?.id}`);

  // ── 5a. Open a websocket to the plan room BEFORE the PATCH (poke round-trip) ─
  let pokePromise = null;
  let ws = null;
  if (typeof globalThis.WebSocket === "function" && target) {
    const wsUrl = `${BASE.replace(/^http/, "ws")}/api/realtime/plans?room=${encodeURIComponent(`plan:${SLUG}`)}`;
    ws = new globalThis.WebSocket(wsUrl);
    pokePromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ received: false }), 6000);
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data === "string" && ev.data !== "pong") {
          clearTimeout(timer);
          resolve({ received: true, data: ev.data });
        }
      });
    });
    await new Promise((r) => {
      ws.addEventListener("open", r);
      ws.addEventListener("error", r);
      setTimeout(r, 3000);
    });
  } else {
    info("no global WebSocket in this runtime — skipping the live poke round-trip");
  }

  // ── 3. PATCH the task: in_review + prNumber (both new to this endpoint) ────
  const patched = await c.req("PATCH", `/api/admin/plans/tasks/${target.id}`, {
    body: { status: "in_review", prNumber: 269 },
  });
  check("PATCH returns 200", patched.status === 200, `status=${patched.status} ${patched.text?.slice(0, 160)}`);
  check("PATCH accepts in_review status", patched.json?.task?.status === "in_review", JSON.stringify(patched.json?.task));
  check("PATCH persists prNumber", patched.json?.task?.prNumber === 269, JSON.stringify(patched.json?.task));

  // ── 4. Live status reflected on the next read ─────────────────────────────
  const reread = await c.get(`/api/changelog/proposals/${SLUG}`);
  const t2 = (reread.json?.tasks ?? []).find((t) => t.taskKey === "QC-P1-01");
  check("re-read shows in_review + PR #269 (the follow-along path)", t2?.status === "in_review" && t2?.prNumber === 269, JSON.stringify(t2));

  // ── 5b. The websocket received the poke ───────────────────────────────────
  if (pokePromise) {
    const poke = await pokePromise;
    check("websocket received a realtime poke after the PATCH", poke.received === true, poke.data ? poke.data.slice(0, 160) : "(no message within 6s)");
    try { ws.close(); } catch { /* noop */ }
  }

  // ── 5c. DO health endpoint reachable through the gateway ───────────────────
  const health = await c.get(`/api/realtime/plans/health?room=${encodeURIComponent(`plan:${SLUG}`)}`);
  check("/api/realtime/plans → DO health reachable", health.status === 200 && health.json?.status === "ok", `status=${health.status} ${health.text?.slice(0, 120)}`);
} finally {
  // Cleanup: remove the QC proposal, plan, tasks, and staged entry.
  d1(`DELETE FROM plan_tasks WHERE plan_slug = '${SLUG}';`);
  d1(`DELETE FROM plans WHERE slug = '${SLUG}';`);
  d1(`DELETE FROM changelog_proposals WHERE slug = '${SLUG}';`);
  d1(`DELETE FROM changelog_entries WHERE slug = '${SLUG}';`);
  info(`cleaned up QC proposal '${SLUG}' (proposal, plan, tasks, entry)`);
}

process.exit(summary().failed === 0 ? 0 : 1);
