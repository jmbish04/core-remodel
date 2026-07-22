#!/usr/bin/env node
/**
 * @fileoverview QC — 0029 Provider Pricing & Health.
 *
 * Asserts the price catalog is populated and plausible, that cost is actually
 * computed for the models we call, and that the provider table is grouped with
 * real health/latency/uptime.
 *
 *   pnpm run test:pr 196 -- --preview
 *   pnpm run test:pr 196
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const base = resolveBase();
const client = createClient({ base });
const { req } = client;
const checks = createChecks();
const { ok, info, finish } = checks;

console.log(`\nQC pr_196 — Provider Pricing & Health\nTarget: ${base}\n`);
await assertReachable(client, checks);

// ── 1. Price catalog ────────────────────────────────────────────────────────
console.log("1. Price catalog");

const pricing = await req("GET", "/api/admin/agents/pricing");
ok("GET /pricing 200", pricing.status === 200, `got ${pricing.status}`);
ok("catalog has rows", (pricing.json?.count ?? 0) > 0, `count=${pricing.json?.count}`);

const providersSeen = new Set((pricing.json?.rows ?? []).map((r) => r.provider));
for (const p of ["ANTHROPIC", "GEMINI", "OPENAI", "WORKERS_AI"]) {
  ok(`${p} present in the catalog`, providersSeen.has(p));
}
info(`catalog: ${pricing.json?.count} models across ${providersSeen.size} providers`);

// Rates must be plausible. A parser that silently returns 0 for everything
// would otherwise pass every structural check above.
const tokenRows = (pricing.json?.rows ?? []).filter((r) => r.unit === "tokens");
const withInput = tokenRows.filter((r) => typeof r.inputPerMillionUsd === "number");
ok("token-priced models carry an input rate", withInput.length > 0, `${withInput.length} rows`);
ok(
  "no input rate is zero or negative",
  withInput.every((r) => r.inputPerMillionUsd > 0),
  withInput.filter((r) => r.inputPerMillionUsd <= 0).map((r) => r.model).slice(0, 3).join(", "),
);
ok(
  "no input rate is absurd (> $1,000 / 1M)",
  withInput.every((r) => r.inputPerMillionUsd < 1000),
  withInput.filter((r) => r.inputPerMillionUsd >= 1000).map((r) => r.model).slice(0, 3).join(", "),
);
ok(
  "every row records its source url",
  (pricing.json?.rows ?? []).every((r) => Boolean(r.sourceUrl)),
);

// The join key must match how the usage log records models.
const wai = (pricing.json?.rows ?? []).filter((r) => r.provider === "WORKERS_AI");
ok(
  "Workers AI model ids keep the @cf/ prefix (the join key)",
  wai.length === 0 || wai.every((r) => r.model.startsWith("@cf/")),
  wai.filter((r) => !r.model.startsWith("@cf/")).map((r) => r.model).slice(0, 3).join(", "),
);

const freshness = pricing.json?.freshness ?? [];
ok("freshness is reported per provider", freshness.length >= 4);
info(freshness.map((f) => `${f.provider}:${f.models}${f.stale ? " STALE" : ""}`).join(" · "));

// ── 2. Cost is actually computed ────────────────────────────────────────────
console.log("\n2. Cost computation");

const usage = await req("GET", "/api/admin/agents/usage");
ok("GET /usage 200", usage.status === 200);
ok(
  "spend is no longer zero for everything",
  (usage.json?.totalCostUsd ?? 0) > 0,
  `totalCostUsd=${usage.json?.totalCostUsd}`,
);
ok(
  "unit cost is derived, not null, once tokens exist",
  usage.json?.totalTokens > 0 ? typeof usage.json.unitCostPerMillion === "number" : true,
);

// The models we actually call must be priceable, else cost silently stays null.
const gemini = (pricing.json?.rows ?? []).filter((r) => r.provider === "GEMINI");
for (const model of ["gemini-2.5-flash", "gemini-2.5-pro"]) {
  const hit = gemini.find((r) => r.model === model);
  ok(`${model} is priced (it is our highest-volume model)`, Boolean(hit), "not in catalog");
  if (hit) {
    ok(
      `${model} output rate exceeds its input rate`,
      hit.outputPerMillionUsd > hit.inputPerMillionUsd,
      `in=${hit.inputPerMillionUsd} out=${hit.outputPerMillionUsd}`,
    );
    info(`${model}: in $${hit.inputPerMillionUsd}/1M · out $${hit.outputPerMillionUsd}/1M`);
  }
}

// ── 3. Provider grouping + health ───────────────────────────────────────────
console.log("\n3. Provider grouping and health");

const providers = await req("GET", "/api/admin/agents/providers?hours=24");
ok("GET /providers 200", providers.status === 200);

const groups = providers.json?.groups ?? [];
const groupIds = groups.map((g) => g.group);
ok("providers are grouped", groups.length >= 2, `groups=${groupIds.join(",")}`);
ok("AI providers group exists", groupIds.includes("ai-providers"));
ok("Cloudflare bindings group exists", groupIds.includes("cloudflare-bindings"));

const rows = groups.flatMap((g) => g.providers);
ok("every row carries a friendly label", rows.every((r) => r.label && r.label !== r.provider));
ok(
  "no row leaks a raw SCREAMING_SNAKE name",
  rows.every((r) => !/^[A-Z_]+$/.test(r.label)),
  rows.filter((r) => /^[A-Z_]+$/.test(r.label)).map((r) => r.label).join(", "),
);
ok(
  "every row has a health verdict",
  rows.every((r) => ["SUCCESS", "PARTIAL", "FAILURE", "OFFLINE"].includes(r.health)),
);
ok(
  "a provider with no calls reads OFFLINE, not FAILURE",
  rows.filter((r) => r.calls === 0).every((r) => r.health === "OFFLINE"),
);
ok(
  "a provider with calls and no errors reads SUCCESS",
  rows.filter((r) => r.calls > 0 && r.errors === 0).every((r) => r.health === "SUCCESS"),
);
ok("group subtotals are present", groups.every((g) => typeof g.costUsd === "number"));
info(
  groups
    .map((g) => `${g.label}: ${g.providers.length} providers, ${g.calls} calls`)
    .join(" · "),
);

// Known providers must all be represented, including idle ones — a provider
// missing from the table is indistinguishable from a provider that is fine.
const ids = new Set(rows.map((r) => r.provider));
for (const p of ["WORKERS_AI", "GEMINI", "OPENAI", "ANTHROPIC", "CF_IMAGES", "GOOGLE_PLACES"]) {
  ok(`${p} has a row even when idle`, ids.has(p));
}

// ── 4. Refresh endpoint ─────────────────────────────────────────────────────
console.log("\n4. Refresh");

const refresh = await req("POST", "/api/admin/agents/pricing/refresh");
ok("POST /pricing/refresh 200", refresh.status === 200, `got ${refresh.status}`);
const results = refresh.json?.results ?? [];
ok("refresh reports every provider", results.length === 4, `got ${results.length}`);
ok(
  "at least three of four vendors parsed",
  results.filter((r) => r.status === "ok").length >= 3,
  results.map((r) => `${r.provider}:${r.status}`).join(" "),
);
for (const r of results) {
  info(`${r.provider}: ${r.status} · ${r.modelsFound} models · ${r.durationMs}ms${r.error ? ` · ${r.error}` : ""}`);
}
ok(
  "a successful provider returned a non-empty model set",
  results.filter((r) => r.status === "ok").every((r) => r.modelsFound > 0),
);

// ── 5. Auth + page ──────────────────────────────────────────────────────────
console.log("\n5. Auth and page");

for (const path of ["/api/admin/agents/pricing", "/api/admin/agents/providers"]) {
  const r = await req("GET", path, { auth: false });
  ok(`unauthenticated ${path} refused`, r.status === 401 || r.status === 302, `got ${r.status}`);
}

const page = await req("GET", "/admin/system/agents/usage");
ok("/admin/system/agents/usage 200s", page.status === 200);
ok("page uses the mandatory shell", (page.text ?? "").includes('class="container mx-auto px-4 py-8'));

finish();
