/**
 * QC for PR #401 — dedup contacts on store merge.
 *
 * The merge path is destructive and HITL-gated, so this does NOT run a real merge.
 * It unit-checks the partition invariant that remapContactsDeduped relies on (a local
 * mirror of its contactKey + drop/move logic), then a light live regression that the
 * contacts read endpoint still returns per-store rows.
 */
import { createChecks, createClient } from "../config.mjs";

const { ok, finish } = createChecks();

// ---- pure-logic invariant (mirror of remapContactsDeduped) ----
const contactKey = (r) =>
  [r.firstName, r.lastName, r.officePhoneNumber, r.mobilePhoneNumber, r.emailAddress]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|");

function partition(keeper, losers) {
  const seen = new Set(keeper.map(contactKey));
  const drop = [];
  const move = [];
  for (const r of losers) {
    const k = contactKey(r);
    if (seen.has(k)) drop.push(r.id);
    else {
      seen.add(k);
      move.push({ id: r.id, isPrimary: false });
    }
  }
  return { drop, move };
}

// keeper has Cyndi; losers = duplicate Cyndi (case/space variant) + new Vince (primary)
const keeper = [
  { id: 1, firstName: "Cyndi", lastName: "Campos", officePhoneNumber: "510-1", emailAddress: "c@x.com" },
];
const losers = [
  { id: 2, firstName: "cyndi ", lastName: "CAMPOS", officePhoneNumber: "510-1", emailAddress: "C@x.com" },
  { id: 3, firstName: "Vince", lastName: "Sacdalan", officePhoneNumber: "510-2", emailAddress: "v@x.com", isPrimary: true },
];
const p = partition(keeper, losers);
ok("case/space-insensitive dup dropped", p.drop.length === 1 && p.drop[0] === 2, JSON.stringify(p.drop));
ok("distinct person moved", p.move.length === 1 && p.move[0].id === 3, JSON.stringify(p.move));
ok("moved contact demoted (is_primary=false)", p.move.every((m) => m.isPrimary === false));

// two losers, same person → only one moves
const p2 = partition([], [
  { id: 4, firstName: "A", lastName: "B", officePhoneNumber: "1" },
  { id: 5, firstName: "a", lastName: "b", officePhoneNumber: "1" },
]);
ok("dup within loser set collapses", p2.move.length === 1 && p2.drop.length === 1, `move=${p2.move.length} drop=${p2.drop.length}`);

// ---- live regression: contacts endpoint unaffected ----
const client = createClient();
const r = await client.get("/api/showroom-contacts?storeId=116");
const rows = Array.isArray(r.json) ? r.json : (r.json?.contacts ?? r.json?.data);
ok("GET /api/showroom-contacts?storeId=116 returns rows", r.status === 200 && Array.isArray(rows), `status=${r.status}`);

finish();
