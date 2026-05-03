/**
 * @fileoverview RenovationAgent types — state, RPC result interfaces, and JSON schemas.
 */

// ---------------------------------------------------------------------------
// Agent State
// ---------------------------------------------------------------------------

export interface RenovationAgentState {
  /** Running context of analyzed images for multi-turn conversation */
  analyzedImages: Array<{
    imageId: string;
    roomType: string;
    keywords: string[];
    deliveryUrl?: string;
    analyzedAt: string;
  }>;
  /** Accumulated style themes observed across all images */
  styleThemes: string[];
  /** Room types encountered */
  roomsObserved: string[];
}

// ---------------------------------------------------------------------------
// RPC result types
// ---------------------------------------------------------------------------

export interface RenovationAdvice {
  summary: string;
  recommendations: Array<{
    area: string;
    suggestion: string;
    priority: "high" | "medium" | "low";
  }>;
  styleNotes: string[];
}

export interface ProcessUploadResult {
  success: boolean;
  record?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// JSON Schemas for structured output (gpt-oss-120b json_schema mode)
// ---------------------------------------------------------------------------

export const RENOVATION_ADVICE_SCHEMA = {
  name: "renovation_advice",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "A concise summary of the renovation advice",
      },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            area: { type: "string", description: "Room or area this applies to" },
            suggestion: { type: "string", description: "Specific recommendation" },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "How important this recommendation is",
            },
          },
          required: ["area", "suggestion", "priority"],
          additionalProperties: false,
        },
        description: "List of specific renovation recommendations",
      },
      styleNotes: {
        type: "array",
        items: { type: "string" },
        description: "Overall style observations and themes",
      },
    },
    required: ["summary", "recommendations", "styleNotes"],
    additionalProperties: false,
  },
} as const;
