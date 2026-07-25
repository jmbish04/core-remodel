#!/usr/bin/env node
/**
 * @fileoverview QC — PR #241, Tesla streaming-ingest lifecycle control (0023
 * ING-01/ING-03).
 *
 * Exercises the new admin control surface that gates whether the (future) stream
 * DO may run and how the poller falls back:
 *
 *   GET  /api/tesla/stream/control  → { control, shouldStream, shouldPoll }
 *   POST /api/tesla/stream/control  → set toggle / window / cadence (validated)
 *
 * The window + cadence are round-tripped and restored, and the inverted-window
 * rejection is asserted. These routes are NEW, so on prod (pre-merge) they 404 /
 * are absent — reported PENDING, not failed. Run both:
 *
 *   pnpm run test:pr 241 -- --preview   # this branch's preview worker (new surface)
 *   pnpm run test:pr 241                 # production — regression + PENDING report
 *
 * The activation time-gate (PATCH /api/drive-lists/:slug 409 outside 07:00–20:00)
 * is time-of-day dependent and needs a real drive, so it is smoke-tested manually
 * on the preview worker rather than asserted here (a QC run at 14:00 PT could not
 * observe the 409 branch without mutating a live drive).
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_241 — Tesla stream lifecycle control\n  target: ${resolveBase()}${
    onProd ? " (PROD — new routes report PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

// ── GET the control state ─────────────────────────────────────────────────────
const got = await client.get("/api/tesla/stream/control");

if (onProd && got.status === 404) {
  checks.info("PENDING: GET /api/tesla/stream/control not on prod yet (pending merge+deploy)");
} else {
  const ok = checks.ok(
    "GET /api/tesla/stream/control → 200 with control + decisions",
    got.status === 200 &&
      got.json?.control &&
      typeof got.json.control.enabled === "boolean" &&
      typeof got.json.control.windowStartHour === "number" &&
      typeof got.json.control.windowEndHour === "number" &&
      typeof got.json.control.pollFallbackSeconds === "number" &&
      typeof got.json.shouldStream === "boolean" &&
      typeof got.json.shouldPoll === "boolean",
    `→ ${got.status} ${JSON.stringify(got.json?.control ?? got.json)}`,
  );

  if (ok) {
    const original = got.json.control;

    // ── shouldStream / shouldPoll are mutually exclusive when a drive is active,
    //    and both false when none is (there's no active drive during a QC run). ──
    checks.ok(
      "shouldStream and shouldPoll are never both true",
      !(got.json.shouldStream && got.json.shouldPoll),
      `stream=${got.json.shouldStream} poll=${got.json.shouldPoll}`,
    );

    // ── The POST tests MUTATE live streaming-ingest config, which could transiently
    //    affect a real drive. So they run ONLY against a preview/isolated target,
    //    never production, and always restore the original state in a finally. ──
    if (onProd) {
      checks.info("SKIPPED on prod: mutating control POST tests (QC stays read-only against prod)");
    } else {
      try {
        // POST a valid window + cadence, expect it echoed back.
        const set = await client.post("/api/tesla/stream/control", {
          windowStartHour: 7,
          windowEndHour: 20,
          pollFallbackSeconds: 90,
        });
        checks.ok(
          "POST valid window (7–20) + cadence 90 → 200 echoes control",
          set.status === 200 &&
            set.json?.control?.windowStartHour === 7 &&
            set.json?.control?.windowEndHour === 20 &&
            set.json?.control?.pollFallbackSeconds === 90,
          `→ ${set.status} ${JSON.stringify(set.json?.control)}`,
        );

        // Inverted window must be rejected.
        const bad = await client.post("/api/tesla/stream/control", {
          windowStartHour: 20,
          windowEndHour: 7,
        });
        checks.ok(
          "POST inverted window (20–7) → 400 rejected",
          bad.status === 400,
          `→ ${bad.status} ${JSON.stringify(bad.json)}`,
        );
      } finally {
        // Always restore the original config, even if an assertion threw above.
        const restore = await client.post("/api/tesla/stream/control", {
          enabled: original.enabled,
          windowStartHour: original.windowStartHour,
          windowEndHour: original.windowEndHour,
          pollFallbackSeconds: original.pollFallbackSeconds,
        });
        checks.ok(
          "restored original control → 200 with original values",
          restore.status === 200 &&
            restore.json?.control?.windowStartHour === original.windowStartHour &&
            restore.json?.control?.windowEndHour === original.windowEndHour &&
            restore.json?.control?.pollFallbackSeconds === original.pollFallbackSeconds,
          `→ ${restore.status} ${JSON.stringify(restore.json?.control)}`,
        );
      }
    }
  }
}

checks.finish();
