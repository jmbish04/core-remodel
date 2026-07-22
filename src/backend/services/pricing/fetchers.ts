/**
 * @fileoverview Per-provider price fetchers.
 *
 * Each returns normalized rows in USD per MILLION tokens. Each is independent:
 * one vendor changing its docs must never take the others down with it.
 *
 * RESILIENCE CONTRACT
 * -------------------
 * A fetcher either returns rows or THROWS. It must never return an empty array
 * on a parse failure, because the caller treats "zero models" as an error and
 * retains the previous catalog — and that distinction (vendor published nothing
 * vs our regex stopped matching) is the entire value of the fetch-run log.
 */
import { cleanCell, findTables, parseMarkdownTables, parsePricePerMillion } from "./markdown-table";

/** One normalized catalog row, before it is written to D1. */
export interface PriceRow {
  provider: string;
  model: string;
  displayName?: string | null;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  cachedInputPerMillionUsd?: number | null;
  unit?: string;
  sourceUrl: string;
  sourceNote?: string | null;
}

/**
 * A browser-ish User-Agent. Vendor docs sites 403 an unidentified fetch, and a
 * 403 here would look identical to "the page has no prices".
 */
const UA =
  "Mozilla/5.0 (compatible; core-remodel-pricing/1.0; +https://core-remodel.hacolby.workers.dev)";

const FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/markdown, text/plain, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().length < 200) throw new Error(`${url} → suspiciously short body (${text.length}b)`);
  return text;
}

/** Header lookup by substring, so "input price" and "input $/1m" both hit. */
function headerFor(headers: string[], ...needles: string[]): string | undefined {
  return headers.find((h) => needles.some((n) => h.includes(n)));
}

/** The model-name column, whatever the vendor called it. */
function modelHeader(headers: string[]): string | undefined {
  return headerFor(headers, "model", "name") ?? headers[0];
}

/**
 * Rows from every table on a page that has both an input and an output price
 * column. Vendors split one price list across several tables (per family, per
 * tier), so all matching tables are read, not just the first.
 */
function rowsFromPricingTables(markdown: string, provider: string, url: string): PriceRow[] {
  const tables = parseMarkdownTables(markdown);
  const candidates = [
    ...findTables(tables, ["input", "output"]),
    ...findTables(tables, ["input price", "output price"]),
  ];

  const seen = new Set<string>();
  const out: PriceRow[] = [];

  for (const table of candidates) {
    const mh = modelHeader(table.headers);
    const ih = headerFor(table.headers, "input");
    const oh = headerFor(table.headers, "output");
    const ch = headerFor(table.headers, "cache", "cached");
    if (!mh || !ih || !oh) continue;

    for (const row of table.rows) {
      const rawModel = row[mh];
      if (!rawModel) continue;
      const model = normalizeModelId(rawModel);
      if (!model || seen.has(model)) continue;

      const input = parsePricePerMillion(row[ih] ?? "", ih);
      const output = parsePricePerMillion(row[oh] ?? "", oh);
      // A row with neither rate is a section header or a footnote, not a model.
      if (input === null && output === null) continue;

      seen.add(model);
      out.push({
        provider,
        model,
        displayName: rawModel,
        inputPerMillionUsd: input,
        outputPerMillionUsd: output,
        cachedInputPerMillionUsd: ch ? parsePricePerMillion(row[ch] ?? "", ch) : null,
        unit: "tokens",
        sourceUrl: url,
        sourceNote: `markdown table [${mh} | ${ih} | ${oh}]`,
      });
    }
  }

  return out;
}

/**
 * Canonical model id: lowercased, markup stripped, whitespace collapsed to
 * hyphens. This is the join key against `gemini_usage_log.model`, so it has to
 * be derived the same way every time.
 */
export function normalizeModelId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    // `@` is KEPT: Workers AI models are logged as "@cf/meta/llama-3.1-8b" and
    // stripping the prefix would silently break every join against the usage
    // log — the catalog would look full and price nothing.
    .replace(/[^a-z0-9.\-_/@ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export const ANTHROPIC_URL = "https://platform.claude.com/docs/en/about-claude/pricing.md";

export async function fetchAnthropicPricing(): Promise<PriceRow[]> {
  const md = await fetchText(ANTHROPIC_URL);
  const rows = rowsFromPricingTables(md, "ANTHROPIC", ANTHROPIC_URL);
  if (rows.length === 0) {
    throw new Error("Anthropic: no input/output price table matched — page layout likely changed");
  }
  return rows;
}

/** Cells of a Markdown table row, without the leading/trailing empties. */
function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => cleanCell(c));
}

// ── Google Gemini ────────────────────────────────────────────────────────────

export const GEMINI_URL = "https://ai.google.dev/gemini-api/docs/pricing.md.txt";

/**
 * Gemini's tables are TRANSPOSED relative to every other vendor: the rows are
 * "Input price" / "Output price" and the columns are tiers (Free / Paid), with
 * the model name living in the nearest preceding Markdown heading rather than
 * in the table at all.
 *
 *   ## Gemini 3 Pro
 *   |   | Free Tier | Paid Tier, per 1M tokens in USD |
 *   |---|---|---|
 *   | Input price | Free of charge | $1.50 |
 *   | Output price (including thinking tokens) | Free of charge | $7.50 |
 *
 * So this walks headings and tables together, and reads the LAST column (the
 * paid tier) — the free tier is not what a production workload is billed at.
 */
export async function fetchGeminiPricing(): Promise<PriceRow[]> {
  const md = await fetchText(GEMINI_URL);
  const lines = md.split(/\r?\n/);
  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  // `##` is the model, `###` is the billing tier under it, and the canonical
  // model id appears in the AI Studio link inside the section:
  //
  //   ## Gemini 3.6 Flash
  //   [Try it in Google AI Studio](https://aistudio.google.com?model=gemini-3.6-flash)
  //   ### Standard
  //   |   | Free Tier | Paid Tier, per 1M tokens in USD |
  //   | Input price | Free of charge | $1.50 |
  //
  // The link id is preferred over a normalized heading because it is the string
  // the API actually accepts — and therefore the string the usage log records.
  let modelHeading = "";
  let modelId = "";
  let tier = "";

  for (let i = 0; i < lines.length; i++) {
    const h2 = lines[i].match(/^##\s+(?!#)(.+?)\s*$/);
    if (h2) {
      modelHeading = cleanCell(h2[1]);
      modelId = "";
      tier = "";
      continue;
    }
    const h3 = lines[i].match(/^###\s+(.+?)\s*$/);
    if (h3) {
      tier = cleanCell(h3[1]).toLowerCase();
      continue;
    }

    const link = lines[i].match(/aistudio\.google\.com[^)\s]*[?&]model=([a-z0-9.\-]+)/i);
    if (link && !modelId) modelId = link[1];

    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "")) continue;

    // Only the STANDARD tier. Batch is ~50% off and Flex/Priority differ again;
    // recording four prices for one model id would make the last one written
    // win at random. Standard is what an interactive call is billed at.
    const isStandard = tier === "" || tier === "standard";

    const header = splitPipeRow(lines[i]);
    let input: number | null = null;
    let output: number | null = null;
    let cached: number | null = null;
    const unitHint = header.join(" ");

    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const cells = splitPipeRow(lines[j]);
      if (cells.length < 2) continue;
      const label = cells[0].toLowerCase();
      // Last column = paid tier. "Free of charge" parses to null, which is
      // correct: the free tier is not a price a production workload pays.
      const value = parsePricePerMillion(cells[cells.length - 1], unitHint);
      if (/^input price/.test(label)) input = value;
      else if (/^output price/.test(label)) output = value;
      else if (/^context caching/.test(label)) cached = value;
    }
    i = j - 1;

    if (!isStandard || (input === null && output === null)) continue;
    if (!/gemini|gemma|imagen|veo/i.test(modelHeading)) continue;

    const model = normalizeModelId(modelId || modelHeading);
    if (!model || seen.has(model)) continue;
    seen.add(model);

    // Image and TTS models publish their OUTPUT rate per image / per second,
    // in the same table shape as a token rate. Left as "tokens" they price
    // 1000x high the moment anything multiplies them by a token count
    // (gemini-3-pro-image reads as $12,000 per million "tokens").
    //
    // Flagged by an implausible output:input ratio as well as by name, because
    // the next such model may not be called "image". A non-token unit makes
    // estimateCostUsd refuse to price it — declining to guess is the only safe
    // answer here.
    const ratio = input && output ? output / input : 0;
    const nonToken = /image|tts|audio|video|veo|imagen/i.test(modelHeading) || ratio >= 100;
    const unit = nonToken ? "units:mixed" : "tokens";

    rows.push({
      provider: "GEMINI",
      model,
      displayName: modelHeading,
      inputPerMillionUsd: input,
      outputPerMillionUsd: output,
      cachedInputPerMillionUsd: cached,
      unit,
      sourceUrl: GEMINI_URL,
      sourceNote: `"${modelHeading}" standard tier, paid column${modelId ? " (id from AI Studio link)" : " (id from heading)"}${nonToken ? " — NON-TOKEN unit, not priced per token" : ""}`,
    });
  }

  if (rows.length === 0) {
    throw new Error("Gemini: no standard-tier Input/Output price table matched — page layout likely changed");
  }
  return rows;
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

export const OPENAI_URL = "https://developers.openai.com/api/docs/pricing.md";

/**
 * OpenAI's page is MDX, not Markdown tables — the prices are JS array literals
 * passed as a component prop:
 *
 *   rows={[
 *     ["gpt-5.6-sol", 5, 0.5, 6.25, 30],
 *     ["gpt-5.2", 1.75, 0.175, 14],
 *   ]}
 *
 * Note the VARIABLE arity: some rows carry an extra tier column. So the columns
 * are read positionally by rule rather than by index — first numeric is input,
 * LAST numeric is output, second (when present) is the cached-input rate. That
 * survives a column being added, which a fixed index would not.
 *
 * Only the FIRST `rows={[...]}` block is used: the later blocks are the Batch
 * (50% off) and Priority (uplift) tiers, and standard rates are what our calls
 * are billed at.
 */
export async function fetchOpenAiPricing(): Promise<PriceRow[]> {
  const md = await fetchText(OPENAI_URL);

  const blockStart = md.indexOf("rows={[");
  if (blockStart === -1) {
    throw new Error("OpenAI: no rows={[...]} pricing block found — page format likely changed");
  }
  const block = md.slice(blockStart, md.indexOf("]}", blockStart));

  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/\[\s*"([^"]+)"\s*,(.+?)\]\s*,?\s*$/);
    if (!m) continue;

    const rawName = m[1];
    // "-" and null are "not offered on this tier", not zero.
    const nums = m[2]
      .split(",")
      .map((t) => t.trim())
      .map((t) => (t === "null" || t === '"-"' || t === "-" ? null : Number(t)))
      .map((n) => (typeof n === "number" && Number.isFinite(n) ? n : null));

    const priced = nums.filter((n): n is number => n !== null);
    if (priced.length === 0) continue;

    const model = normalizeModelId(rawName);
    if (!model || seen.has(model)) continue;
    seen.add(model);

    rows.push({
      provider: "OPENAI",
      model,
      displayName: rawName,
      inputPerMillionUsd: nums[0],
      outputPerMillionUsd: nums[nums.length - 1],
      cachedInputPerMillionUsd: nums.length > 2 ? nums[1] : null,
      unit: "tokens",
      sourceUrl: OPENAI_URL,
      // The page states "Prices per 1M tokens" above this block.
      sourceNote: `MDX rows[] positional: first=input, last=output (${nums.length} cols), per 1M tokens`,
    });
  }

  if (rows.length === 0) {
    throw new Error("OpenAI: rows={[...]} block matched but no model rows parsed");
  }
  return rows;
}

// ── Cloudflare Workers AI ────────────────────────────────────────────────────

/** Cloudflare's published, fixed rate. Everything else derives from it. */
export const COST_PER_NEURON = 0.011 / 1000;

export const WORKERS_AI_SOURCE = "https://api.cloudflare.com/client/v4/accounts/{id}/ai/models/search";

/** Cloudflare's model registry entry. */
interface CfModel {
  id?: string;
  name?: string;
  task?: { name?: string };
  properties?: Array<{ property_id?: string; value?: unknown }>;
}

/** One entry of the registry's `price` property. */
interface CfPrice {
  unit?: string;
  price?: number;
  currency?: string;
}

/**
 * Workers AI pricing, straight from the model registry.
 *
 * NOTE ON THE APPROACH. The brief supplied a snippet that reads a
 * `neuron_per_unit` property and multiplies by $0.011/1,000 neurons. That
 * property no longer exists on this account's registry response — the API now
 * publishes DIRECT USD rates under a `price` property:
 *
 *   [{ "unit": "per M input tokens", "price": 0.35, "currency": "USD" },
 *    { "unit": "per M output tokens", "price": 0.75, "currency": "USD" }]
 *
 * Reading the published dollars is both simpler and more accurate than
 * re-deriving them, so that is the primary path. The neuron conversion is kept
 * as a fallback for any model that still exposes the older shape.
 *
 * Reads credentials from the secrets store. Neither the account id nor the
 * token is ever logged, and the error path deliberately does not echo the
 * response body — an auth error page can contain the token that was sent.
 */
export async function fetchWorkersAiPricing(env: Env): Promise<PriceRow[]> {
  const accountId = await env.CLOUDFLARE_ACCOUNT_ID?.get?.();
  const token = await env.CLOUDFLARE_WRANGLER_API_TOKEN?.get?.();
  if (!accountId || !token) {
    throw new Error("Workers AI: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_WRANGLER_API_TOKEN unavailable");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=200`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Workers AI models API → HTTP ${res.status}`);

  const payload = (await res.json()) as { result?: CfModel[]; success?: boolean };
  const models = payload.result ?? [];
  const rows: PriceRow[] = [];

  for (const model of models) {
    const id = model.name ?? model.id;
    if (!id) continue;

    const props = model.properties ?? [];
    const priceProp = props.find((p) => p.property_id === "price");
    const neuronProp = props.find((p) => p.property_id === "neuron_per_unit");

    let input: number | null = null;
    let output: number | null = null;
    let unit = "tokens";
    let note = "";

    if (priceProp?.value) {
      const entries = coercePriceEntries(priceProp.value);
      for (const e of entries) {
        const u = (e.unit ?? "").toLowerCase();
        const value = typeof e.price === "number" ? e.price : null;
        if (value === null) continue;
        if (u.includes("input token")) input = perMillion(value, u);
        else if (u.includes("output token")) output = perMillion(value, u);
        else if (!u.includes("token")) {
          // Per-image / per-audio-minute models. Recorded with their REAL unit
          // rather than mislabelled as tokens, which would produce confident
          // nonsense the moment anything multiplied it by a token count.
          input = value;
          unit = `units:${e.unit ?? model.task?.name ?? "unknown"}`;
        }
      }
      note = `registry price property: ${entries.map((e) => `${e.price} ${e.unit}`).join(" · ")}`;
    } else if (neuronProp?.value) {
      // Legacy shape, kept as a fallback.
      try {
        const neurons = JSON.parse(String(neuronProp.value)) as {
          input?: number;
          output?: number;
          unit?: number;
        };
        input = neurons.input ? neurons.input * 1_000_000 * COST_PER_NEURON : null;
        output = neurons.output ? neurons.output * 1_000_000 * COST_PER_NEURON : null;
        if (!input && !output && neurons.unit) {
          input = neurons.unit * 1_000_000 * COST_PER_NEURON;
          unit = `units:${model.task?.name ?? "unknown"}`;
        }
        note = `neuron_per_unit fallback @ $0.011/1k neurons`;
      } catch {
        continue;
      }
    } else {
      continue;
    }

    if (input === null && output === null) continue;

    rows.push({
      provider: "WORKERS_AI",
      model: normalizeModelId(id),
      displayName: id,
      inputPerMillionUsd: input,
      outputPerMillionUsd: output,
      unit,
      sourceUrl: WORKERS_AI_SOURCE,
      sourceNote: note,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      `Workers AI: ${models.length} models returned but none carried a price or neuron_per_unit property`,
    );
  }
  return rows;
}

/** The `price` property arrives as an array, or as a JSON string of one. */
function coercePriceEntries(value: unknown): CfPrice[] {
  if (Array.isArray(value)) return value as CfPrice[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as CfPrice[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Normalize a registry rate to per-million.
 *
 * The unit strings are already "per M ... tokens" today, but a "per K" or
 * per-token variant would otherwise be off by 1,000x silently.
 */
function perMillion(value: number, unit: string): number {
  if (unit.includes("per m ")) return value;
  if (unit.includes("per k ")) return value * 1000;
  if (unit.includes("per token")) return value * 1_000_000;
  return value;
}
