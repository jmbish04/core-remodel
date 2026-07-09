import { generateStructuredOutput } from "@backend/ai/providers";
import { extractMarkdown, scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { z } from "zod";

export const ESTIMATE_EXTRACTION_SCHEMA = z.object({
  estimateType: z.string().optional(),
  businessType: z.string().optional(),
  company: z
    .object({
      name: z.string().optional(),
      businessType: z.string().optional(),
      website: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      cslbLicenseNumber: z.string().optional(),
    })
    .optional(),
  estimateDate: z.string().optional(),
  warrantyDetails: z.string().optional(),
  cancellationDetails: z.string().optional(),
  depositAmountCents: z.number().int().nullable().optional(),
  totalAmountCents: z.number().int().nullable().optional(),
  totalTaxCents: z.number().int().nullable().optional(),
  lineItems: z
    .array(
      z.object({
        itemCode: z.string().optional(),
        description: z.string(),
        qty: z.number().nullable().optional(),
        uom: z.string().optional(),
        unitCostCents: z.number().int().nullable().optional(),
        lineTotalCents: z.number().int().nullable().optional(),
        taxCents: z.number().int().nullable().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  notes: z.string().optional(),
});

export type EstimateExtraction = z.infer<typeof ESTIMATE_EXTRACTION_SCHEMA>;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toIsoSafe(dateInput?: string | null): string | null {
  if (!dateInput) return null;
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeMoneyToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]+/g, "");
  const asFloat = Number.parseFloat(cleaned);
  if (!Number.isFinite(asFloat)) return null;
  return Math.round(asFloat * 100);
}

function detectDataType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenStructuredProperties(
  value: Record<string, unknown>,
): Array<{ property: string; dataType: string; extractedValue: string }> {
  const rows: Array<{ property: string; dataType: string; extractedValue: string }> = [];

  const recurse = (node: unknown, path: string[]) => {
    if (Array.isArray(node)) {
      rows.push({
        property: path.join("."),
        dataType: "array",
        extractedValue: JSON.stringify(node),
      });
      return;
    }
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        recurse(child, [...path, key]);
      }
      return;
    }
    rows.push({
      property: path.join("."),
      dataType: detectDataType(node),
      extractedValue: node === undefined ? "" : JSON.stringify(node),
    });
  };

  for (const [key, child] of Object.entries(value)) {
    recurse(child, [key]);
  }
  return rows;
}

export async function uploadArtifactToR2(
  env: Env,
  params: {
    bytes: ArrayBuffer;
    contentType: string;
    filename?: string;
    sourceType: string;
  },
): Promise<{ key: string; url: string }> {
  const now = new Date();
  const safeName = (params.filename || "artifact").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const key = `estimates/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${crypto.randomUUID()}-${safeName}`;

  await env.ARTIFACTS_BUCKET.put(key, params.bytes, {
    httpMetadata: {
      contentType: params.contentType,
    },
    customMetadata: {
      sourceType: params.sourceType,
      uploadedAt: now.toISOString(),
    },
  });

  return {
    key,
    url: `/api/artifacts/${key}`,
  };
}

export async function transcribeAudioBase64(env: Env, audioBase64: string): Promise<string> {
  const audioBytes = decodeBase64(audioBase64);
  const response = await env.AI.run("@cf/openai/whisper", {
    audio: Array.from(audioBytes),
    gateway: { id: env.AI_GATEWAY_ID },
  } as Parameters<typeof env.AI.run>[1]);
  if (isRecord(response) && typeof response.text === "string") {
    return response.text;
  }
  return JSON.stringify(response);
}

async function extractTextFromImageFile(env: Env, file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const dataUrl = `data:${file.type || "image/png"};base64,${base64}`;
  const response = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all visible estimate text, numbers, terms, totals, and line items from this document image. Return plain text only.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    gateway: { id: env.AI_GATEWAY_ID },
  } as Parameters<typeof env.AI.run>[1]);
  if (isRecord(response) && typeof response.response === "string") {
    return response.response;
  }
  return JSON.stringify(response);
}

export async function extractSourceContent(
  env: Env,
  input: {
    sourceType: "pdf" | "photo" | "url" | "free_text" | "audio_transcript";
    file?: File | null;
    sourceUrl?: string | null;
    freeText?: string | null;
    audioBase64?: string | null;
  },
): Promise<{
  rawText: string;
  rawMarkdown: string | null;
  sourceUrl: string | null;
  uploadedArtifact: { key: string; url: string } | null;
}> {
  if (input.sourceType === "url") {
    const sourceUrl = (input.sourceUrl || "").trim();
    if (!sourceUrl) {
      throw new Error("sourceUrl is required for url sources");
    }
    const [markdown, snapshot] = await Promise.all([
      extractMarkdown(env, sourceUrl),
      scrapeUrl(env, sourceUrl),
    ]);
    return {
      rawText: snapshot.text || markdown,
      rawMarkdown: markdown,
      sourceUrl,
      uploadedArtifact: null,
    };
  }

  if (input.sourceType === "free_text") {
    const freeText = (input.freeText || "").trim();
    if (!freeText) {
      throw new Error("freeText is required for free_text sources");
    }
    return {
      rawText: freeText,
      rawMarkdown: null,
      sourceUrl: null,
      uploadedArtifact: null,
    };
  }

  if (input.sourceType === "audio_transcript") {
    const audioBase64 = (input.audioBase64 || "").trim();
    if (!audioBase64) {
      throw new Error("audioBase64 is required for audio_transcript sources");
    }
    const transcript = await transcribeAudioBase64(env, audioBase64);
    return {
      rawText: transcript,
      rawMarkdown: null,
      sourceUrl: null,
      uploadedArtifact: null,
    };
  }

  const file = input.file;
  if (!file) {
    throw new Error("file is required for document sources");
  }

  const artifact = await uploadArtifactToR2(env, {
    bytes: await file.arrayBuffer(),
    contentType: file.type || "application/octet-stream",
    filename: file.name,
    sourceType: input.sourceType,
  });

  const isImage = file.type.startsWith("image/");
  let rawText = "";

  if (isImage) {
    rawText = await extractTextFromImageFile(env, file);
  } else {
    // PDF/other types are archived to R2 and represented as a placeholder summary.
    rawText = `Uploaded ${file.name} (${file.type || "unknown type"}).`;
  }

  return {
    rawText,
    rawMarkdown: null,
    sourceUrl: null,
    uploadedArtifact: artifact,
  };
}

export async function extractStructuredEstimate(
  env: Env,
  params: {
    rawText: string;
    sourceType: string;
    knownCompanies: Array<{
      id: number;
      name: string;
      businessType: string;
      website: string | null;
      email: string | null;
    }>;
  },
): Promise<EstimateExtraction> {
  const companyHints = params.knownCompanies
    .slice(0, 200)
    .map((company) => {
      const parts = [company.name, company.businessType, company.website || "", company.email || ""]
        .filter(Boolean)
        .join(" | ");
      return `- ${company.id}: ${parts}`;
    })
    .join("\n");

  const extracted = await generateStructuredOutput(env, {
    messages: [
      {
        role: "system",
        content:
          "You extract home remodeling estimate data into strict JSON. Use cents for all monetary integer fields. Use null when unknown. If the company appears to match an existing known company, preserve the same name spelling.",
      },
      {
        role: "user",
        content: [
          `Source type: ${params.sourceType}`,
          "Known companies:",
          companyHints || "none",
          "",
          "Extract from this content:",
          params.rawText,
        ].join("\n"),
      },
    ],
    schema: ESTIMATE_EXTRACTION_SCHEMA,
    schemaName: "EstimateExtractionSchema",
    temperature: 0,
  });

  return {
    ...extracted,
    estimateDate: toIsoSafe(extracted.estimateDate) || undefined,
    depositAmountCents:
      extracted.depositAmountCents !== undefined && extracted.depositAmountCents !== null
        ? normalizeMoneyToCents(extracted.depositAmountCents)
        : null,
    totalAmountCents:
      extracted.totalAmountCents !== undefined && extracted.totalAmountCents !== null
        ? normalizeMoneyToCents(extracted.totalAmountCents)
        : null,
    totalTaxCents:
      extracted.totalTaxCents !== undefined && extracted.totalTaxCents !== null
        ? normalizeMoneyToCents(extracted.totalTaxCents)
        : null,
  };
}
