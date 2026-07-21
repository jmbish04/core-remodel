// Run: npx tsx scripts/tests/test_brand_reconcile.mjs
//
// Guards for brand-name reconciliation. The model half is stubbed — what is
// under test is the code that DECIDES WHETHER TO TRUST IT. Every case here is a
// way the live `brands` table actually got corrupted, or a way an unchecked
// model response could corrupt it further.
import assert from "node:assert";

const { reconcileBrandNames, brandNameKey, brandDomain } = await import(
  "../../src/backend/services/brand-reconcile.ts"
);

const EXISTING = [
  { id: 18, name: "Dornbracht", websiteUrl: "https://www.dornbracht.com" },
  { id: 184, name: "Visual Comfort", websiteUrl: "https://visualcomfort.com" },
  { id: 188, name: "Newport Brass", websiteUrl: null },
  { id: 65, name: "Kohler", websiteUrl: "https://www.kohler.com" },
];

/** env stub whose AI.run returns whatever `decisions` we hand it. */
function envWith(decisions) {
  return {
    AI_GATEWAY_ID: "test",
    AI: {
      run: async () => ({ response: JSON.stringify({ decisions }) }),
    },
  };
}

/** env stub whose AI.run blows up. */
const envBroken = {
  AI_GATEWAY_ID: "test",
  AI: {
    run: async () => {
      throw new Error("model unavailable");
    },
  },
};

// --- normalisation -------------------------------------------------------
assert.equal(brandNameKey("DORN BRACHT"), brandNameKey("Dornbracht"));
assert.equal(brandNameKey("WET STYLE"), brandNameKey("Wetstyle"));
assert.equal(brandNameKey("Water, Inc."), brandNameKey("Water Inc."));
assert.notEqual(brandNameKey("Kohler"), brandNameKey("Kohler Signature Store"));
assert.equal(brandDomain("https://www.dornbracht.com/en/x"), "dornbracht.com");

// --- deterministic pass costs no model call ------------------------------
// "DORN BRACHT" must resolve to #18 by normalisation alone. If this ever needs
// the model, the cheap path has regressed.
{
  const env = {
    AI_GATEWAY_ID: "t",
    AI: { run: async () => { throw new Error("must not call the model"); } },
  };
  const r = await reconcileBrandNames(env, EXISTING, [{ name: "DORN BRACHT" }]);
  assert.equal(r.newBrandNamesToCreate.length, 0);
  assert.equal(r.newBrandNamesToSkip[0].matchedBrandId, 18);
  assert.equal(r.newBrandNamesToSkip[0].reason, "normalized");
  // ...and the degraded stored name is queued for repair. Except the stored
  // name here is the GOOD one, so nothing to rename.
  assert.equal(r.existingBrandNamesToCleanup.length, 0);
}

// --- degraded stored name gets a rename ----------------------------------
{
  const stored = [{ id: 302, name: "NEWPORTBRASS", websiteUrl: null }];
  const env = { AI_GATEWAY_ID: "t", AI: { run: async () => ({ response: "{}" }) } };
  const r = await reconcileBrandNames(env, stored, [{ name: "Newport Brass" }]);
  assert.equal(r.newBrandNamesToSkip[0].matchedBrandId, 302);
  assert.deepEqual(
    { id: r.existingBrandNamesToCleanup[0].brandId, to: r.existingBrandNamesToCleanup[0].newCleanupBrandName },
    { id: 302, to: "Newport Brass" },
  );
}

// --- the case pure normalisation misses ----------------------------------
// "Visual Comfort & Co." does not share a normalised key with "Visual Comfort";
// this is exactly the pair the model exists to catch.
{
  const r = await reconcileBrandNames(
    envWith([
      {
        candidateName: "Visual Comfort & Co.",
        verdict: "skip",
        matchedBrandId: 184,
        betterName: null,
        reason: "same company, suffix differs",
      },
    ]),
    EXISTING,
    [{ name: "Visual Comfort & Co." }],
  );
  assert.equal(r.newBrandNamesToCreate.length, 0);
  assert.equal(r.newBrandNamesToSkip[0].matchedBrandId, 184);
}

// --- HALLUCINATED ID must not skip ---------------------------------------
// A skip is the unrecoverable direction: it silently drops the brand. An id the
// model was never offered must degrade to create, not be trusted.
// The candidate must be one that actually shortlists, otherwise the model is
// never consulted and there is no hallucination to reject.
{
  const r = await reconcileBrandNames(
    envWith([
      {
        candidateName: "Kohler Signature Store",
        verdict: "skip",
        matchedBrandId: 9999,
        betterName: null,
        reason: "x",
      },
    ]),
    EXISTING,
    [{ name: "Kohler Signature Store", websiteUrl: "https://www.kohler.com" }],
  );
  assert.deepEqual(r.newBrandNamesToCreate, ["Kohler Signature Store"]);
  assert.equal(r.newBrandNamesToSkip.length, 0);
  assert.match(r.rejected.join(" "), /not in its shortlist/);
}

// A candidate with no plausible existing match skips the model entirely — the
// cheap path. If this starts costing a call, the shortlist has regressed.
{
  const env = {
    AI_GATEWAY_ID: "t",
    AI: { run: async () => { throw new Error("must not call the model"); } },
  };
  const r = await reconcileBrandNames(env, EXISTING, [
    { name: "Zzyzx Fixtures", websiteUrl: "https://zzyzx.example" },
  ]);
  assert.deepEqual(r.newBrandNamesToCreate, ["Zzyzx Fixtures"]);
}

// --- model failure degrades to create, never throws -----------------------
{
  const r = await reconcileBrandNames(envBroken, EXISTING, [
    { name: "Kohler Signature Store", websiteUrl: "https://www.kohler.com" },
  ]);
  assert.deepEqual(r.newBrandNamesToCreate, ["Kohler Signature Store"]);
  assert.match(r.rejected.join(" "), /model call failed/);
}

// --- a rename must not collide with a DIFFERENT brand ---------------------
// Renaming #18 to "Kohler" would manufacture the duplicate this module exists
// to prevent, so it is dropped and reported.
{
  const r = await reconcileBrandNames(
    envWith([
      {
        candidateName: "Dornbracht Deutschland",
        verdict: "skip",
        matchedBrandId: 18,
        betterName: "Kohler",
        reason: "bogus rename",
      },
    ]),
    EXISTING,
    [{ name: "Dornbracht Deutschland", websiteUrl: "https://www.dornbracht.com" }],
  );
  assert.equal(r.existingBrandNamesToCleanup.length, 0);
  // Blocked as "not an improvement" before the collision check even runs —
  // either guard is fine, but it must be REPORTED, never silently dropped.
  assert.match(r.rejected.join(" "), /not an improvement|would collide with brand #65/);
}

// --- duplicate candidates collapse ---------------------------------------
// A roster listing the same brand twice must not insert it twice.
{
  const r = await reconcileBrandNames(envWith([]), EXISTING, [
    { name: "Fictional Brand" },
    { name: "FICTIONAL BRAND" },
  ]);
  assert.equal(r.newBrandNamesToCreate.length, 1, "duplicate candidates should collapse");
}

// --- every candidate lands in exactly one bucket --------------------------
{
  const candidates = [
    { name: "DORN BRACHT" },
    { name: "Vola" },
    { name: "Kohler" },
  ];
  const r = await reconcileBrandNames(envWith([]), EXISTING, candidates);
  const accounted = r.newBrandNamesToCreate.length + r.newBrandNamesToSkip.length;
  assert.equal(accounted, candidates.length, "no candidate may be dropped or double-counted");
}

// --- a model-proposed rename must still pass the quality gate -------------
// Gemini, asked about "Visual Comfort & Co.", proposes renaming the existing
// "Visual Comfort" to it — a fine name rewritten for no gain. Renames are only
// worth it when the stored form is genuinely degraded.
{
  const r = await reconcileBrandNames(
    envWith([
      {
        candidateName: "Visual Comfort & Co.",
        verdict: "skip",
        matchedBrandId: 184,
        betterName: "Visual Comfort & Co.",
        reason: "fuller legal name",
      },
    ]),
    EXISTING,
    [{ name: "Visual Comfort & Co." }],
  );
  assert.equal(r.newBrandNamesToSkip[0].matchedBrandId, 184);
  assert.equal(
    r.existingBrandNamesToCleanup.length,
    0,
    "renaming a well-formed name to another well-formed name is not an improvement",
  );
  assert.match(r.rejected.join(" "), /not an improvement/, "rejection must be reported");
}

// ...but a genuinely degraded stored name IS renamed on the model path.
{
  const stored = [{ id: 302, name: "NEWPORTBRASS", websiteUrl: null }];
  const r = await reconcileBrandNames(
    envWith([
      {
        candidateName: "Newport Brass Co",
        verdict: "skip",
        matchedBrandId: 302,
        betterName: "Newport Brass",
        reason: "degraded stored name",
      },
    ]),
    stored,
    [{ name: "Newport Brass Co" }],
  );
  assert.equal(r.existingBrandNamesToCleanup[0].newCleanupBrandName, "Newport Brass");
}

console.log("brand reconcile guards: OK");

// --- Gemini schema conversion --------------------------------------------
// Gemini takes an OpenAPI-3.0 subset, not JSON Schema. Type unions and
// additionalProperties are the two differences that fail the whole request
// rather than erroring usefully, so they are converted/dropped here.
{
  const { toGeminiSchema } = await import("../../src/backend/services/structured-output.ts");

  const g = toGeminiSchema({
    type: "object",
    properties: {
      name: { type: "string" },
      matchedBrandId: { type: ["number", "null"] },
      betterName: { type: ["string", "null"] },
      verdict: { type: "string", enum: ["create", "skip"] },
      rows: { type: "array", items: { type: "object", properties: { id: { type: "number" } } } },
    },
    required: ["name", "verdict", "nonexistent"],
    additionalProperties: false,
  });

  // ["number","null"] must collapse to a concrete type + nullable.
  assert.equal(g.properties.matchedBrandId.type, "number");
  assert.equal(g.properties.matchedBrandId.nullable, true);
  assert.equal(g.properties.betterName.type, "string");
  assert.equal(g.properties.betterName.nullable, true);
  // Plain types are untouched and carry no stray nullable.
  assert.equal(g.properties.name.type, "string");
  assert.equal(g.properties.name.nullable, undefined);
  // enum and nested items survive.
  assert.deepEqual(g.properties.verdict.enum, ["create", "skip"]);
  assert.equal(g.properties.rows.items.properties.id.type, "number");
  // additionalProperties is rejected by Gemini — must be dropped.
  assert.equal("additionalProperties" in g, false);
  // A `required` entry with no matching property is rejected by Gemini.
  assert.deepEqual(g.required, ["name", "verdict"]);
}

console.log("gemini schema conversion: OK");
