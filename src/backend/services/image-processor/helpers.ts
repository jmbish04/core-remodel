import type { PhotoCategory, ImageAnalysisResult } from "./types";

// ---------------------------------------------------------------------------
// JSON Schemas for structured output (gpt-oss-120b json_schema mode)
// ---------------------------------------------------------------------------

export const IMAGE_ANALYSIS_SCHEMA = {
  name: "image_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      roomType: {
        type: "string",
        description: "The room or area type, e.g. kitchen, bathroom, living room, bedroom, backyard, exterior, hallway, office",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "5-10 keywords describing style, materials, colors, and features",
      },
      suggestedDisplayName: {
        type: "string",
        description: "Short user-facing image label under 8 words, unique enough for room context",
      },
      styleTheme: {
        type: "string",
        description: "Design style summary, e.g. warm modern, moody contemporary, coastal minimal",
      },
      materials: {
        type: "array",
        items: { type: "string" },
        description: "Visible material references such as white oak, marble, brass, plaster",
      },
      visibleElements: {
        type: "array",
        items: { type: "string" },
        description: "Major visible elements or focal zones such as sink wall, vanity, island, shower, window",
      },
      isInstagram: {
        type: "boolean",
        description: "Whether the image appears to be an Instagram screenshot with UI elements",
      },
      instagramAccount: {
        type: ["string", "null"],
        description: "Instagram account handle if detected, null otherwise",
      },
      instagramCaption: {
        type: ["string", "null"],
        description: "Instagram caption text if detected, null otherwise",
      },
    },
    required: [
      "roomType",
      "keywords",
      "suggestedDisplayName",
      "styleTheme",
      "materials",
      "visibleElements",
      "isInstagram",
      "instagramAccount",
      "instagramCaption",
    ],
    additionalProperties: false,
  },
} as const;

export const PHOTO_REVIEW_SCHEMA = {
  name: "photo_review_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      room: {
        type: "string",
        description: "The room or area type in lowercase, e.g. kitchen, bathroom, living room, bedroom, backyard",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "5-10 lowercase tags describing styles, materials, colors, and features",
      },
    },
    required: ["room", "tags"],
    additionalProperties: false,
  },
} as const;

export const VECTOR_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizePhotoCategory(
  category: string | null | undefined,
  isListingPhoto: boolean,
): PhotoCategory {
  if (category === "listing" || category === "ai_render" || category === "inspirational") {
    return category;
  }
  return isListingPhoto ? "listing" : "inspirational";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function deriveDisplayName(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "Untitled photo";
  }
  return trimmed.replace(/\.[^./\\]+$/, "");
}

export function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
    })
    .join(" ")
    .trim();
}

export function sanitizeDisplayName(value: string): string {
  return value
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\-()' ]/gu, "")
    .trim()
    .slice(0, 80);
}

export function ensureUniqueDisplayName(name: string, existingNames: string[]): string {
  const normalized = sanitizeDisplayName(name);
  const base = normalized || "Untitled photo";
  const existing = new Set(
    existingNames
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );

  if (!existing.has(base.toLowerCase())) {
    return base;
  }

  let suffix = 2;
  while (existing.has(`${base.toLowerCase()} ${suffix}`)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

export function normalizeTagValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

export function slugifyTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

export function titleizeTag(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((segment) =>
      segment.length > 0
        ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`
        : "",
    )
    .join(" ")
    .trim();
}

export function buildAiPrefillPayload(
  analysis: ImageAnalysisResult,
  displayName: string,
  assignedRoomType: string,
) {
  const dedupedTags = Array.from(
    new Set(
      analysis.keywords
        .map((keyword) => normalizeTagValue(keyword))
        .filter((keyword) => keyword.length > 1),
    ),
  ).slice(0, 12);

  const contextParts = [
    analysis.styleTheme ? `style theme ${analysis.styleTheme}` : null,
    analysis.materials.length > 0
      ? `materials ${analysis.materials.slice(0, 3).join(", ")}`
      : null,
    analysis.visibleElements.length > 0
      ? `visible elements ${analysis.visibleElements.slice(0, 3).join(", ")}`
      : null,
  ].filter(Boolean);

  const baseContext =
    contextParts.length > 0
      ? contextParts.join("; ")
      : "the visual composition and finishes detected in the photo";

  const tags = dedupedTags.map((tag) => ({
    value: tag,
    rationale: `Selected from Workers AI visual analysis based on ${baseContext}.`,
  }));

  const noteValue = [
    analysis.styleTheme ? `Theme: ${analysis.styleTheme}` : null,
    analysis.materials.length > 0 ? `Materials: ${analysis.materials.slice(0, 4).join(", ")}` : null,
    analysis.visibleElements.length > 0
      ? `Focus: ${analysis.visibleElements.slice(0, 4).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return {
    tags,
    note: {
      value: noteValue,
      rationale: "Generated from Workers AI visual summary to speed up review coding.",
    },
    roomType: {
      value: assignedRoomType,
      rationale: "Predicted from visual layout and room-defining elements in the image.",
    },
    displayName: {
      value: displayName,
      rationale:
        "Suggested from room context and focal elements to provide a unique review label.",
    },
  };
}
