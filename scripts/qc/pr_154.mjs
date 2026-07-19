#!/usr/bin/env node
/**
 * @fileoverview QC for PR #154 — showroom soft delete (`is_active`).
 *
 * Branch: claude/showroom-soft-delete (stacked on claude/showroom-touch-ux)
 * Migrations: 0113_dapper_white_queen (showroom_stores.is_active, default 1)
 *
 * Run:  pnpm run test:pr 154
 *
 * The point of this PR is a FILTER, and a filter is exactly the kind of change
 * that passes a green suite while being completely broken — assert that a list
 * endpoint returns 200 and you have proved nothing. So the real check here is
 * behavioural and destructive-looking: soft-delete a live showroom, prove it
 * disappears from every list surface, then restore it.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 * Against the CURRENTLY DEPLOYED worker, `DELETE /:id` is still a HARD delete.
 * Firing it blind would destroy a real showroom and cascade its notes, photos,
 * ratings and price history. So the harness GATES on `POST /:id/restore`
 * existing (404 ⇒ this PR is not deployed yet) and refuses to run the delete
 * cycle until it does. The restore also runs in a `finally`, and the script
 * prints the manual restore command if anything goes wrong.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

/** Pull the id set out of whichever shape an endpoint returns. */
const idsOf = (payload, key = "stores") => {
  const list = Array.isArray(payload) ? payload : (payload?.[key] ?? []);
  return new Set(list.map((r) => r.id ?? r.storeId).filter((v) => v != null));
};

async function main() {
  console.log(`\nPR #154 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── The column exists (migration 0113 applied to remote) ──────────────────
  // A 500 on the directory right after a schema PR means the migration did not
  // ride the build — that is the first thing to suspect, so name it.
  const stores = await client.get("/api/showroom-stores");
  checks.ok(
    "GET /api/showroom-stores → 200 (migration 0113 applied)",
    stores.status === 200,
    `got ${stores.status}${stores.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );
  const list = Array.isArray(stores.json) ? stores.json : (stores.json?.stores ?? []);
  checks.ok("directory returned real rows to assert against", list.length > 0, `got ${list.length}`);
  if (list.length === 0) return checks.finish();

  // ── Deploy gate ───────────────────────────────────────────────────────────
  // restore/ is new in this PR. If Hono 404s the route, the deployed worker is
  // still running the HARD delete and we must not touch DELETE at all.
  const victim = list.find((s) => s.name) ?? list[0];
  const probe = await client.post(`/api/showroom-stores/${victim.id}/restore`, {});
  const deployed = probe.status !== 404;
  checks.ok(
    "POST /:id/restore exists (this PR is deployed — safe to exercise DELETE)",
    deployed,
    probe.status === 404
      ? "404 — branch not deployed yet; the live DELETE is still a HARD delete, so the soft-delete cycle is SKIPPED"
      : `got ${probe.status}`,
  );

  if (!deployed) {
    checks.info("soft-delete cycle skipped — re-run once this branch is deployed");
    return checks.finish();
  }

  // Restore is idempotent on an already-active store, so the probe above was a
  // no-op. Confirm it reports the flag rather than just 200-ing.
  checks.ok(
    "restore reports isActive: true",
    probe.json?.isActive === true,
    JSON.stringify(probe.json),
  );

  // ── The real test: delete → assert absence everywhere → restore ───────────
  console.log(`\n  … soft-deleting "${victim.name}" (id ${victim.id}) — will be restored\n`);
  let deleted = false;
  try {
    const del = await client.req("DELETE", `/api/showroom-stores/${victim.id}`);
    checks.ok(`DELETE /api/showroom-stores/${victim.id} → 200`, del.status === 200, `got ${del.status}`);
    checks.ok("delete reports isActive: false (soft, not hard)", del.json?.isActive === false, JSON.stringify(del.json));
    deleted = del.status === 200;

    if (deleted) {
      // The row must SURVIVE — this is what separates soft from hard delete.
      const detail = await client.get(`/api/showroom-stores/${victim.id}`);
      checks.ok(
        "the row survives: GET /:id still returns it (soft delete, nothing erased)",
        detail.status === 200 && detail.json?.id === victim.id,
        `got ${detail.status}`,
      );
      checks.ok("…and it reports isActive: false", detail.json?.isActive === false, `isActive=${detail.json?.isActive}`);

      // …but it is gone from every list surface.
      const after = await client.get("/api/showroom-stores");
      const afterIds = idsOf(after.json);
      checks.ok(
        "directory no longer lists it",
        !afterIds.has(victim.id),
        `id ${victim.id} still present in ${afterIds.size} rows`,
      );
      checks.ok(
        "directory count dropped by exactly one",
        afterIds.size === list.length - 1,
        `before=${list.length} after=${afterIds.size}`,
      );

      // A filtered list must ALSO hide it — the directory applies its filters
      // through the same and(...), so a search hit here would mean the
      // isActive predicate got dropped when other conditions were present.
      const searched = await client.get(
        `/api/showroom-stores?search=${encodeURIComponent(victim.name.slice(0, 12))}`,
      );
      checks.ok(
        "a FILTERED directory query hides it too (predicate survives and(...))",
        !idsOf(searched.json).has(victim.id),
        "the soft-deleted store came back under a search filter",
      );

      // MCP list_showrooms — the agent-facing surface.
      const mcp = await client.post("/api/mcp/call", {
        name: "list_showrooms",
        arguments: {},
      });
      if (mcp.status === 200) {
        const text = typeof mcp.json === "string" ? mcp.json : JSON.stringify(mcp.json);
        checks.ok(
          "MCP list_showrooms hides it",
          !new RegExp(`"id":\\s*${victim.id}\\b`).test(text),
          `id ${victim.id} still in the MCP payload`,
        );
      } else {
        checks.info(`(MCP list_showrooms probe returned ${mcp.status} — skipped)`);
      }

      // The clearance feed joins showroom_stores; a deleted store's sales must
      // drop out with it.
      const sales = await client.get("/api/showroom-sales");
      if (sales.status === 200) {
        const saleStoreIds = new Set((sales.json?.items ?? []).map((i) => i.storeId));
        checks.ok(
          "sales/clearance feed hides its rows",
          !saleStoreIds.has(victim.id),
          `store ${victim.id} still has sale rows in the feed`,
        );
      }

      // placeId dedupe must STILL see it — the unique index does, so a create
      // with the same placeId has to 409 rather than blow up on a constraint.
      if (victim.placeId) {
        const exists = await client.get(
          `/api/showroom-stores/meta/place-exists?placeId=${encodeURIComponent(victim.placeId)}`,
        );
        checks.ok(
          "placeId dedupe STILL sees it (else a re-add hits a UNIQUE constraint)",
          exists.status === 200 && Boolean(exists.json?.exists),
          JSON.stringify(exists.json),
        );
      } else {
        checks.info("(victim has no placeId — dedupe check skipped)");
      }
    }
  } finally {
    if (deleted) {
      const restore = await client.post(`/api/showroom-stores/${victim.id}/restore`, {});
      checks.ok(
        `restored "${victim.name}" (id ${victim.id})`,
        restore.status === 200 && restore.json?.isActive === true,
        `got ${restore.status} — RESTORE MANUALLY: ` +
          `curl -X POST "${client.base}/api/showroom-stores/${victim.id}/restore"`,
      );
      const back = await client.get("/api/showroom-stores");
      checks.ok(
        "directory count is back to where it started",
        idsOf(back.json).size === list.length,
        `expected ${list.length}, got ${idsOf(back.json).size}`,
      );
    }
  }

  checks.finish();
}

main().catch((err) => {
  console.error("\nUnexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
