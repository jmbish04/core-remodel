#!/usr/bin/env node
/**
 * @fileoverview Self-check for CLEARANCE_PATH_RE in
 * src/backend/services/showroom/social-links.ts — the own-domain path matcher
 * that decides which pages feed the sale-tracking pipeline.
 *
 * Why this exists: the regex's entire job is precision. A false positive files a
 * page with no sale on it as WEBSITE_CLEARANCE, and the weekly cron then burns a
 * Browser Rendering call plus an AI extraction on it every week, forever. The
 * dangerous inputs are the words that merely CONTAIN a sale word —
 * "/wholesale", "/salem-store", "/sales-team" — which is exactly what the
 * whole-segment anchoring is there to stop.
 *
 * The regex is read out of the source rather than re-typed, so this cannot
 * silently drift from the thing it is checking. (The repo has no test runner,
 * hence a plain assert script rather than introducing one.)
 *
 * Usage:
 *   node scripts/check-clearance-paths.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = "src/backend/services/showroom/social-links.ts";
const src = readFileSync(SRC, "utf8");

const m = /const CLEARANCE_PATH_RE =\s*(\/[\s\S]*?\/[a-z]*);/.exec(src);
assert.ok(m, `could not find CLEARANCE_PATH_RE in ${SRC}`);
const body = m[1].trim();
const lastSlash = body.lastIndexOf("/");
const CLEARANCE_PATH_RE = new RegExp(body.slice(1, lastSlash), body.slice(lastSlash + 1));

/** classifySiteLink() strips the trailing slash before testing. */
const test = (path) => CLEARANCE_PATH_RE.test(path.replace(/\/+$/, ""));

// ─── Must match ───────────────────────────────────────────────────────────────
for (const path of [
  "/clearance",
  "/sale",
  "/sales",
  "/on-sale",
  "/shop/outlet",
  "/closeout",
  "/close-out",
  "/overstock",
  "/discontinued",
  "/specials",
  "/deals",
  "/promotions",
  "/promotion",
  // Showroom-specific vocabulary — the terms of art for ex-display stock.
  "/floor-models",
  "/floor-model",
  "/floormodels",
  "/floor-samples",
  "/ex-display",
  "/exdisplay",
  "/remnants",
  "/remnant",
  "/last-chance",
  "/final-sale",
  "/markdowns",
  "/liquidation",
  "/scratch-and-dent",
  "/scratch-&-dent",
  // Nested + trailing slash.
  "/shop/clearance/",
  "/en/us/clearance",
]) {
  assert.ok(test(path), `expected clearance match: ${path}`);
}

// ─── Must NOT match — the reason the anchoring exists ──────────────────────────
for (const path of [
  "/wholesale", // contains "sale"
  "/wholesale/pricing",
  "/salem-store", // city named Salem
  "/sales-team", // the humans, not the discounts
  "/sales-rep",
  "/about/sales-team",
  "/personalise", // contains "sale" (the docstring's own example)
  "/terms-of-sale",
  "/point-of-sale",
  "/about",
  "/products/tile",
  "/contact",
  "/dealership", // contains "deal"
  "/idealab", // contains "deal"
  "/specialsituations", // contains "specials"
  "/outletter", // contains "outlet"
]) {
  assert.equal(test(path), false, `expected NO clearance match: ${path}`);
}

console.log("✓ CLEARANCE_PATH_RE: all checks passed");
