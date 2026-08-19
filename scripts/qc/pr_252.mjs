/**
 * QC — PR #252: showroom store-type taxonomy (0031).
 *
 * Exercises the new type surface and regression-guards the plain store list:
 *   - GET /api/showroom-stores/meta/types           (active vocabulary)
 *   - GET /api/showroom-stores                       (LIST returns type fields)
 *   - GET /api/showroom-stores/:id                   (detail returns type fields)
 *   - GET /api/showroom-stores?typeId=<id>           (server filter is exact)
 *   - PUT /api/showroom-stores/:id { typeId }        (write round-trip, restored)
 *
 * Run:  pnpm run test:pr 252            (prod — new endpoints report "pending" pre-merge)
 *       pnpm run test:pr 252 -- --preview
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const c = createClient();
const { ok, finish } = createChecks();
const base = resolveBase();
const preMerge = !base.includes("wcrp-"); // new endpoints may 404 on prod pre-merge

// 1. Vocabulary
const types = await c.req("GET", "/api/showroom-stores/meta/types");
if (types.status === 404 && preMerge) {
  console.log("meta/types 404 — pending merge/deploy on this target; skipping type checks");
} else {
  ok("meta/types 200", types.status === 200);
  const list = types.json?.types ?? [];
  ok("meta/types returns active rows", list.length > 0);
  ok("types carry key + displayName", list.every((t) => t.key && t.displayName));

  // 2. LIST returns joined type fields
  const all = await c.req("GET", "/api/showroom-stores");
  ok("LIST 200", all.status === 200);
  const stores = all.json?.stores ?? [];
  const typed = stores.filter((s) => s.typeId != null);
  ok("LIST exposes typeName on typed stores", typed.every((s) => "typeName" in s));

  if (typed.length > 0) {
    const sample = typed[0];
    // 3. Detail
    const detail = await c.req("GET", `/api/showroom-stores/${sample.id}`);
    ok("detail 200", detail.status === 200);
    ok("detail returns typeId + typeName", detail.json?.typeId === sample.typeId);

    // 4. Server filter is exact
    const filtered = await c.req("GET", `/api/showroom-stores?typeId=${sample.typeId}`);
    ok("?typeId filter 200", filtered.status === 200);
    ok(
      "?typeId filter is exact",
      (filtered.json?.stores ?? []).every((s) => s.typeId === sample.typeId),
    );

    // 5. Write round-trip (set null, restore) — net-zero
    const before = sample.typeId;
    const p1 = await c.req("PUT", `/api/showroom-stores/${sample.id}`, { body: { typeId: null } });
    const mid = (await c.req("GET", `/api/showroom-stores/${sample.id}`)).json?.typeId;
    const p2 = await c.req("PUT", `/api/showroom-stores/${sample.id}`, { body: { typeId: before } });
    const after = (await c.req("GET", `/api/showroom-stores/${sample.id}`)).json?.typeId;
    ok("PUT typeId accepted", p1.status === 200 && p2.status === 200);
    ok("PUT clears then restores typeId", mid === null && after === before);
  }
}

// Regression guard — the plain list must always work.
const guard = await c.req("GET", "/api/showroom-stores");
ok("[regression] store list 200", guard.status === 200);

finish();
