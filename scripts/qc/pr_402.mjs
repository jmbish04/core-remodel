/**
 * QC for PR #402 — Phase L location_id on 7 showroom content tables + backfill.
 *
 * The added columns are nullable and not yet read by any endpoint (reader cutover is a
 * follow-up), so this is a REGRESSION guard: adding the columns must not break the
 * existing showroom reads that serialize these tables. Backfill correctness was verified
 * directly against remote D1 (839 rows filled, 0 store-attached rows left null) — see the
 * changelog entry.
 */
import { createChecks, createClient } from "../config.mjs";

const { ok, finish } = createChecks();
const client = createClient();

const list = await client.get("/api/showroom-stores?limit=5");
const stores = Array.isArray(list.json) ? list.json : (list.json?.stores ?? list.json?.data ?? []);
ok("GET /api/showroom-stores still 200 with rows", list.status === 200 && Array.isArray(stores) && stores.length > 0, `status=${list.status}`);

// A multi-location store still serves its locations (reads the tables Phase L touched nearby).
const loc = await client.get("/api/showroom-stores/116/locations");
ok("GET /:id/locations still 200", loc.status === 200 && Array.isArray(loc.json?.locations), `status=${loc.status}`);

// Contacts read (serializes showroom_store_contacts) unaffected.
const contacts = await client.get("/api/showroom-contacts?storeId=116");
const crows = Array.isArray(contacts.json) ? contacts.json : (contacts.json?.contacts ?? contacts.json?.data);
ok("GET /api/showroom-contacts still 200", contacts.status === 200 && Array.isArray(crows), `status=${contacts.status}`);

finish();
