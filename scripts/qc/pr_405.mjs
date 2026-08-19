/**
 * QC for PR #405 — per-location rating summary on GET /:id/locations.
 * Live: each location carries ratingSummary (or null) and the response has
 * storeRatingSummary. Verifies shape + avg-in-range invariant.
 */
import { createChecks, createClient } from "../config.mjs";
const { ok, finish } = createChecks();
const client = createClient();

const r = await client.get("/api/showroom-stores/116/locations");
ok("GET /:id/locations 200", r.status === 200, `status=${r.status}`);
const body = r.json ?? {};
ok("response has storeRatingSummary key", "storeRatingSummary" in body);
const locs = body.locations ?? [];
ok("locations present", Array.isArray(locs) && locs.length > 0);
ok("every location has ratingSummary key", locs.every((l) => "ratingSummary" in l));
const validSummary = (s) => s == null || (Number.isInteger(s.count) && s.count > 0 && s.avg >= 1 && s.avg <= 5);
ok("ratingSummary shape valid (null or {count>0, avg 1-5})", locs.every((l) => validSummary(l.ratingSummary)));
ok("storeRatingSummary shape valid", validSummary(body.storeRatingSummary));

finish();
