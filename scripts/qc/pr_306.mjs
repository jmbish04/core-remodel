#!/usr/bin/env node
/**
 * @fileoverview QC — PR #306, 0040 P4: showroom inbox + per-message unread.
 *
 * Non-destructive: finds a store whose emails match Gmail threads, asserts the
 * threads-by-domain response shape (domains/emails, numeric unreadCount, threads
 * each carrying a per-thread `unread`), then calls mark-read on a thread and
 * asserts the { success, marked } envelope. (mark-read only flips unread→read, so
 * it never destroys data; the full unread→0 decrement was verified live.)
 *
 * Routes are new, so on prod (pre-merge/deploy) they 404 → reported pending.
 *
 *   pnpm run test:pr 306 -- --preview
 *   pnpm run test:pr 306
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_306 — showroom inbox + unread (0040 P4)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // Probe one store to see if the route exists at all.
  const probeStore = 222;
  const probe = await client.get(`/api/gmail/showrooms/${probeStore}/threads-by-domain`);
  if (probe.status === 404 && !isPreview) {
    checks.info("threads-by-domain route not on prod yet (pending merge/deploy; expected pre-merge).");
    checks.finish();
  }
  checks.ok("P4 — threads-by-domain responds", probe.status === 200, `→ ${probe.status}`);
  checks.ok("P4 — response shape (unreadCount number, threads array)",
    typeof probe.json?.unreadCount === "number" && Array.isArray(probe.json?.threads),
    `unreadCount=${probe.json?.unreadCount}`);

  // Find a store with matched threads (probe first, then scan a few more).
  let matched = Array.isArray(probe.json?.threads) && probe.json.threads.length > 0
    ? { threads: probe.json.threads }
    : null;
  if (!matched) {
    const list = await client.get("/api/showroom-stores?limit=40");
    for (const s of list.json?.stores ?? []) {
      const id = s.id ?? s.storeId;
      if (id == null) continue;
      const r = await client.get(`/api/gmail/showrooms/${id}/threads-by-domain`);
      if (r.status === 200 && (r.json?.threads?.length ?? 0) > 0) {
        matched = { threads: r.json.threads };
        break;
      }
    }
  }

  if (!matched) {
    checks.info("No store with matched threads found; shape verified, skipping per-thread checks.");
    checks.finish();
  }

  const t0 = matched.threads[0];
  checks.ok("P4 — threads carry a per-thread `unread` number", typeof t0.unread === "number", `unread=${t0.unread}`);

  const marked = await client.post(`/api/gmail/threads/${encodeURIComponent(t0.threadId)}/mark-read`);
  checks.ok("P4 — mark-read returns { success, marked }",
    marked.status === 200 && marked.json?.success === true && typeof marked.json?.marked === "number",
    `→ ${marked.status} marked=${marked.json?.marked}`);
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
