/**
 * Furnishing extraction (docs/0014, procurement slice — nano-banana recipe 6.1).
 *
 * Runs a Gemini vision pass over a finished render / room image and returns a
 * structured list of the furnishings, fixtures, and materials it can see — the
 * raw material for a shopping list. This is the extraction ENGINE; the Workshop
 * surfaces the results as cards that link to showroom-product search. Wiring the
 * items into a materials-todo Decision Room is a later follow-up.
 */
import { createGeminiClient } from "../render/providers/gemini-stage-provider";

/** One detected furnishing/material. */
export interface FurnishingItem {
  /** Short, product-like name, e.g. "brass floor lamp". */
  label: string;
  /** Coarse bucket, e.g. lighting, seating, flooring, plumbing, tile, cabinetry, decor. */
  category: string;
  /** One short descriptor — color/material/style. */
  note: string;
}

/** Vision model for extraction (language+vision reasoning, not image-gen). */
const EXTRACTION_MODEL = "gemini-2.5-flash";

/** Fetch an image URL and inline it as base64 for the Gemini `inlineData` part. */
async function urlToInlineData(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image for extraction: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType };
}

const PROMPT = [
  "You are an expert interior-design procurement assistant. Look at this interior image and list the distinct furnishings, fixtures, and materials a shopper would want to source.",
  'Return ONLY a JSON array (no prose, no markdown fences) of 3–15 objects, each: {"label": string, "category": string, "note": string}.',
  "- label: a short, product-like name (e.g. \"brass arc floor lamp\", \"matte black faucet\").",
  "- category: one of lighting, seating, table, storage, flooring, tile, plumbing, cabinetry, countertop, wallcovering, window, rug, decor, appliance, other.",
  "- note: one short descriptor (color / material / style).",
  "Skip architecture (walls, ceilings) unless it's a finish material worth sourcing. No duplicates.",
].join("\n");

/** Strip ```json fences and parse; return [] on any shape problem (never throw to the route). */
function parseItems(text: string): FurnishingItem[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
    .map((it) => ({
      label: String(it.label ?? "").trim(),
      category: String(it.category ?? "other").trim() || "other",
      note: String(it.note ?? "").trim(),
    }))
    .filter((it) => it.label.length > 0)
    .slice(0, 20);
}

/** Extract furnishings/materials from an image URL. Returns [] if nothing parses. */
export async function extractFurnishings(env: Env, imageUrl: string): Promise<FurnishingItem[]> {
  const ai = await createGeminiClient(env);
  const inline = await urlToInlineData(imageUrl);
  const response = (await ai.models.generateContent({
    model: EXTRACTION_MODEL,
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: inline }] }],
  })) as { text?: string };
  return parseItems(response.text ?? "");
}
