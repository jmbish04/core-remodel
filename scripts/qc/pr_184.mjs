#!/usr/bin/env node
/**
 * @fileoverview QC for PR #184 — material taxonomy + the MCP surface for it.
 *
 * Migrations: 0120_numerous_legion (material_categories, material_subcategories)
 *
 * Run:  pnpm run test:pr 184
 *       pnpm run test:pr 184 -- --preview
 *
 * `material_schedule_items` carried only a free-text title, so "does a toilet
 * already exist in this project?" was unanswerable — which blocks any reasoning
 * over an inbound receipt ("3 toilets arrived; how many toilet materials exist;
 * which rooms lack one"). This adds the category/subcategory mapping, seeds the
 * plumbing vocabulary that did not exist, and exposes it to MCP.
 *
 * WHY NOT CALL THE MCP TOOLS DIRECTLY: registry tools live behind the
 * OAuth-gated /mcp transport, which a QC script cannot authenticate to. The
 * legacy /api/mcp JSON-RPC shim is a SEPARATE hardcoded surface of 21 tools —
 * AGENTS.md warns not to confuse the two — and it does not carry registry
 * tools. So registration is asserted via the public catalog (/api/mcp-docs,
 * generated FROM the registry) and the behaviour via the REST endpoints, which
 * run the same DB code the tools call.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

async function main() {
  console.log(`\nPR #184 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Migration 0120 landed ─────────────────────────────────────────────────
  const list = await client.get("/api/materials");
  checks.ok(
    "GET /api/materials → 200 (migration 0120 applied)",
    list.status === 200,
    `got ${list.status}${list.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );

  // ── The MCP tool is registered and documented ─────────────────────────────
  // /api/mcp-docs is generated from the registry, so presence here means the
  // tool is genuinely wired in — not merely present as a file on disk.
  const docs = await client.get("/api/mcp-docs", { auth: false });
  checks.ok("GET /api/mcp-docs → 200", docs.status === 200, `got ${docs.status}`);
  const tools = (docs.json?.groups ?? docs.json?.tools ?? []).flatMap((g) => g.tools ?? [g]);
  checks.info(`${tools.length} tools in the registry`);
  const vocabTool = tools.find((t) => t.name === "list_material_categories");
  checks.ok("list_material_categories is registered", Boolean(vocabTool), "absent from the catalog");
  checks.ok(
    "it carries a description and an example (a bare entry is a defect per AGENTS.md)",
    Boolean(vocabTool?.description) && (vocabTool?.examples?.length ?? 0) > 0,
    JSON.stringify({ desc: Boolean(vocabTool?.description), examples: vocabTool?.examples?.length }),
  );

  // ── The vocabulary exists ─────────────────────────────────────────────────
  // `plumbing` existed as a category but had ZERO subcategories, so there was
  // no "Toilet" to match a receipt line against.
  const cats = await client.get("/api/config/categories");
  checks.ok("GET /api/config/categories → 200", cats.status === 200, `got ${cats.status}`);
  const plumbing = (cats.json?.categories ?? []).find((c) => String(c.name).toLowerCase() === "plumbing");
  checks.ok("`plumbing` category present", Boolean(plumbing), (cats.json?.categories ?? []).map((c) => c.name).join(","));

  const allSubs = await client.get("/api/config/subcategories");
  const plumbingSubs = (allSubs.json?.subcategories ?? []).filter((s) => s.categoryId === plumbing?.id && s.isActive);
  checks.info(`plumbing subcategories: ${plumbingSubs.map((s) => s.name).join(", ") || "(none)"}`);
  checks.ok(
    "plumbing has subcategories (it had ZERO before this PR)",
    plumbingSubs.length > 0,
    "none — run POST /api/showroom-stores/seed",
  );

  const toilet = plumbingSubs.find((s) => String(s.name).toLowerCase() === "toilet");
  checks.ok("`Toilet` exists — the type the receipt deduction matches on", Boolean(toilet), plumbingSubs.map((s) => s.name).join(","));

  // ── Rooms: only the ACTIVE set, and each carries its floor ────────────────
  // The table holds 9 bath-ish rows across three seeding generations; only 3
  // are active. Deduction over the other 6 would place a toilet in a phantom
  // room, so this asserts the filter, not just the count.
  const catalog = await client.get("/api/rooms/catalog");
  checks.ok("GET /api/rooms/catalog → 200", catalog.status === 200, `got ${catalog.status}`);
  const baths = (catalog.json?.rooms ?? []).filter((r) => /bath/i.test(r.roomName || ""));
  for (const b of baths) checks.info(`  ${b.id} · ${b.roomName}`);
  checks.ok(
    "exactly 3 active bathrooms (9 rows exist; 6 are retired duplicates)",
    baths.length === 3,
    `got ${baths.length} — inactive rooms are leaking into deduction`,
  );

  // ── Taxonomy round trip: create tagged, read it back ──────────────────────
  let probeId = null;
  if (plumbing && toilet && baths.length > 0) {
    const made = await client.post("/api/materials", {
      title: `QC toilet ${Date.now()}`,
      roomId: baths[0].id,
    });
    checks.ok("POST /api/materials → 2xx", made.status >= 200 && made.status < 300, `got ${made.status}`);
    probeId = made.json?.material?.id ?? made.json?.id ?? null;

    if (probeId) {
      const put = await client.req("PUT", `/api/materials/${probeId}/categories`, {
        body: { categoryIds: [plumbing.id], subcategoryIds: [toilet.id] },
      });
      checks.ok("PUT /:id/categories → 200", put.status === 200, `got ${put.status}`);

      const got = await client.get(`/api/materials/${probeId}/categories`);
      checks.ok(
        "the category reads back",
        (got.json?.categories ?? []).some((c) => c.id === plumbing.id),
        JSON.stringify(got.json?.categories),
      );
      checks.ok(
        "the subcategory reads back",
        (got.json?.subcategories ?? []).some((s) => s.id === toilet.id),
        JSON.stringify(got.json?.subcategories),
      );
      checks.ok(
        "tags carry a NAME resolved by join, not a stored column",
        (got.json?.categories ?? []).every((c) => typeof c.name === "string"),
        JSON.stringify(got.json?.categories),
      );

      // An unknown id must be REJECTED, never written — a hallucinated id
      // reaching a FK column is the failure this guards.
      const bad = await client.req("PUT", `/api/materials/${probeId}/categories`, {
        body: { categoryIds: [999999], subcategoryIds: [] },
      });
      checks.ok("PUT rejects an unknown category id (4xx)", bad.status >= 400 && bad.status < 500, `got ${bad.status}`);

      const after = await client.get(`/api/materials/${probeId}/categories`);
      checks.ok(
        "the rejected id was not persisted",
        !(after.json?.categories ?? []).some((c) => c.id === 999999),
        JSON.stringify(after.json?.categories),
      );

      // ── The query the deduction engine actually runs ──────────────────────
      const bySub = await client.get(`/api/materials/by-subcategory/${toilet.id}`);
      checks.ok(`GET /api/materials/by-subcategory/${toilet.id} → 200`, bySub.status === 200, `got ${bySub.status}`);
      checks.ok(
        "\"which materials are toilets\" finds the one just tagged",
        (bySub.json?.materials ?? []).some((m) => m.id === probeId),
        `${(bySub.json?.materials ?? []).length} results`,
      );
    }
  } else {
    checks.info("missing plumbing / Toilet / a bathroom — round-trip checks skipped");
  }

  if (probeId) checks.info(`probe material ${probeId} left behind — delete by hand if reruns accumulate`);

  // ── Regression guard ──────────────────────────────────────────────────────
  const wl = await client.get("/api/wishlist");
  checks.ok("wishlist read path still 200", wl.status === 200, `got ${wl.status}`);

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
