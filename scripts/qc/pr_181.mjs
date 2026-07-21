#!/usr/bin/env node
/**
 * @fileoverview QC for PR #181 — material taxonomy + the MCP surface for it.
 *
 * Migrations: 0120_numerous_legion (material_categories, material_subcategories)
 *
 * Run:  pnpm run test:pr 181
 *       pnpm run test:pr 181 -- --preview
 *
 * `material_schedule_items` carried only a free-text title, so "does a toilet
 * already exist in this project?" was unanswerable — which blocks any reasoning
 * over an inbound receipt ("3 toilets arrived; how many toilet materials exist;
 * which rooms lack one"). This adds the category/subcategory mapping and the
 * MCP tools an agent needs to read the vocabulary, tag a material, and read the
 * tags back.
 *
 * MCP tools are exercised through the legacy JSON-RPC shim at /api/mcp
 * (tools/call), which is the only HTTP-reachable path to them.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

/** Call an MCP tool through the JSON-RPC shim; returns the parsed tool result. */
async function callTool(name, args = {}) {
  const r = await client.post("/api/mcp", {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e6),
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (r.status !== 200) return { httpStatus: r.status, error: r.text?.slice(0, 200) };
  const text = r.json?.result?.content?.[0]?.text;
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON tool output — leave null, callers assert on it */
  }
  return { httpStatus: 200, isError: Boolean(r.json?.result?.isError), parsed, raw: text };
}

async function main() {
  console.log(`\nPR #181 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Migration 0120 landed ─────────────────────────────────────────────────
  // The list endpoint joins the new mapping tables; a 500 here means unapplied.
  const list = await client.get("/api/materials");
  checks.ok(
    "GET /api/materials → 200 (migration 0120 applied)",
    list.status === 200,
    `got ${list.status}${list.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );

  // ── The vocabulary is discoverable ────────────────────────────────────────
  // Without this an agent cannot know "Toilet" is a valid type at all.
  const vocab = await callTool("list_material_categories");
  checks.ok("list_material_categories → 200", vocab.httpStatus === 200, `got ${vocab.httpStatus}`);
  checks.ok("tool did not error", !vocab.isError, String(vocab.raw).slice(0, 160));

  const cats = vocab.parsed?.categories ?? vocab.parsed?.items ?? [];
  checks.ok("categories returned", Array.isArray(cats) && cats.length > 0, `got ${cats.length}`);

  const plumbing = cats.find((c) => String(c.name).toLowerCase() === "plumbing");
  checks.ok("`plumbing` category present", Boolean(plumbing), cats.map((c) => c.name).join(","));

  const subs = plumbing?.subcategories ?? [];
  checks.info(`plumbing subcategories: ${subs.map((s) => s.name).join(", ") || "(none)"}`);
  checks.ok(
    "plumbing has subcategories (it had ZERO before this PR)",
    subs.length > 0,
    "no subcategories — the seed did not run",
  );

  const toilet = subs.find((s) => String(s.name).toLowerCase() === "toilet");
  checks.ok("`Toilet` subcategory exists — the type the receipt deduction needs", Boolean(toilet), subs.map((s) => s.name).join(","));

  // ── Rooms carry a floor NAME, not just an id ──────────────────────────────
  // "Upper Level" vs "Lower Level" is what separates the upstairs hall bath
  // from the downstairs guest bath — decisive when placing a toilet.
  const rooms = await callTool("list_rooms", { q: "bath" });
  checks.ok("list_rooms → 200", rooms.httpStatus === 200, `got ${rooms.httpStatus}`);
  const roomItems = rooms.parsed?.items ?? [];
  checks.ok("bathrooms found", roomItems.length > 0, `got ${roomItems.length}`);
  for (const r of roomItems) checks.info(`  ${r.id} · ${r.roomName} · ${r.floorName ?? "(no floor)"}`);
  checks.ok(
    "rooms carry floorName (joined, not a stored column)",
    roomItems.length > 0 && roomItems.every((r) => "floorName" in r),
    "floorName absent from at least one room",
  );
  checks.ok(
    "only ACTIVE rooms are listed — 3 bathrooms, not the 9 rows in the table",
    roomItems.length === 3,
    `got ${roomItems.length}; inactive duplicates are leaking into deduction`,
  );

  // ── An invalid taxonomy id must be REJECTED, never written ────────────────
  // A hallucinated id reaching a FK column is the failure this guards.
  const bad = await callTool("create_material", {
    title: "QC probe — should never persist",
    roomId: roomItems[0]?.id ?? 1,
    categoryIds: [999999],
  });
  checks.ok(
    "create_material rejects an unknown category id",
    bad.isError === true || /unknown or inactive/i.test(String(bad.raw)),
    String(bad.raw).slice(0, 160),
  );

  const afterBad = await client.get("/api/materials?search=QC probe");
  checks.ok(
    "the rejected material was NOT created (no orphan)",
    (afterBad.json?.materials ?? []).length === 0,
    `${(afterBad.json?.materials ?? []).length} probe rows found`,
  );

  // ── Round trip: create tagged, read the tags back ─────────────────────────
  const bathId = roomItems[0]?.id;
  if (bathId && plumbing && toilet) {
    const made = await callTool("create_material", {
      title: `QC toilet ${Date.now()}`,
      roomId: bathId,
      categoryIds: [plumbing.id],
      subcategoryIds: [toilet.id],
    });
    checks.ok("create_material with valid tags succeeds", !made.isError, String(made.raw).slice(0, 160));

    const newId = made.parsed?.material?.id ?? made.parsed?.id;
    if (newId) {
      const got = await callTool("get_material", { id: newId });
      const gotCats = got.parsed?.categories ?? got.parsed?.material?.categories ?? [];
      const gotSubs = got.parsed?.subcategories ?? got.parsed?.material?.subcategories ?? [];
      checks.ok("the category reads back", gotCats.some((c) => c.id === plumbing.id), JSON.stringify(gotCats));
      checks.ok("the subcategory reads back", gotSubs.some((s) => s.id === toilet.id), JSON.stringify(gotSubs));
      checks.ok(
        "tags carry a NAME resolved by join, not a stored column",
        gotCats.every((c) => typeof c.name === "string"),
        JSON.stringify(gotCats),
      );
      checks.info(`created material ${newId} — delete it by hand if this run is repeated often`);
    } else {
      checks.info("could not read the new material id from the tool result — round-trip checks skipped");
    }
  } else {
    checks.info("missing a bathroom / plumbing / Toilet — round-trip checks skipped");
  }

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
