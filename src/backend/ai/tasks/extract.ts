/**
 * @fileoverview Extract structured data from text using AI.
 *
 * Uses `generateStructuredOutput` with `response_format: { type: "json_schema" }`
 * to get native structured JSON from gpt-oss-120b — no regex stripping needed.
 */

import type { z } from "zod";

import { generateStructuredOutput } from "../providers";

export async function extract<TSchema extends z.ZodTypeAny>(
  env: Env,
  opts: {
    text: string;
    schema: TSchema;
    systemPrompt?: string;
    cacheTtl?: number;
  },
): Promise<z.infer<TSchema>> {
  const defaultPrompt = [
    "You are a precision job posting parser. Extract the MAXIMUM structured data from the supplied text into the JSON schema.",
    "Guidelines:",
    "- Extract every field present in the posting. Leave optional fields as null/undefined only when the information is genuinely absent.",
    "- For array fields (responsibilities, qualifications, skills, etc.), extract each item as a separate string entry.",
    "- Distinguish between REQUIRED qualifications (must-have, minimum) and PREFERRED qualifications (nice-to-have, ideal, strong).",
    "- For salary, extract numeric values without currency symbols. Detect the currency code (USD, EUR, GBP, etc.).",
    "- For location, include city, state/province, and country when available.",
    "- For workplaceType, classify as 'remote', 'hybrid', or 'onsite' based on context clues.",
    "- For yearsExperienceMin/Max, extract numeric values from phrases like '5+ years' (min=5) or '3-5 years' (min=3, max=5).",
    "- Capture any RTO (return-to-office), schedule, or work arrangement details in rtoPolicy.",
    "- Return JSON only — no markdown, no commentary.",
  ].join("\n");

  return generateStructuredOutput(env, {
    messages: [
      {
        role: "system",
        content: opts.systemPrompt ?? defaultPrompt,
      },
      { role: "user", content: opts.text },
    ],
    schema: opts.schema,
    schemaName: "ExtractionSchema",
    temperature: 0,
    cacheTtl: opts.cacheTtl,
  });
}
