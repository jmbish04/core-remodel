/**
 * Prompt + framing utilities, ported from the validated Python proof
 * (proofs/.../ai_renders/batch_image_edit_kitchen.py). These encode the
 * anti-hallucination guardrails that kept renders architecturally faithful.
 */
import type { ReferenceImage } from "./types";

const SUPPORTED_ASPECT_RATIOS: Record<string, number> = {
  "1:1": 1,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "4:5": 4 / 5,
  "5:4": 5 / 4,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "21:9": 21 / 9,
};

export const DEFAULT_IMAGE_SIZE = "2K";

/** Map a source WxH to the closest gateway-supported aspect-ratio string. */
export function nearestAspectRatio(width: number, height: number): string {
  if (!width || !height) return "3:2";
  const ratio = width / height;
  let best = "3:2";
  let bestDiff = Infinity;
  for (const [name, value] of Object.entries(SUPPORTED_ASPECT_RATIOS)) {
    const diff = Math.abs(value - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return best;
}

/** The structure-preservation block — the #1 anti-hallucination guardrail. */
export const PRESERVATION_BLOCK = [
  "- PRESERVE EXACTLY (do not change in any way): the flooring (its material, color, finish, and plank direction), every wall and wall color, all windows and their grids, all openings, the ceiling, the room's dimensions and proportions, and the camera angle.",
  "- Do NOT invent, move, widen, or close any wall, window, or opening.",
  "- Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio — the output framing must match the input one-to-one.",
  "- Do NOT add any furniture, rugs, decor, plants, or props that are not explicitly requested.",
].join("\n");

/** Scope a reference image to material/form only (avoids importing its scene/angle). */
export function referenceScopingNote(label: string): string {
  return `Use the "${label}" reference ONLY for its material, color, veining, and form. IGNORE its camera angle, orientation, floor, props, lighting, and background; do NOT copy the angle or scene.`;
}

export interface BuildPromptArgs {
  userRequest: string;
  editLocation?: string;
  extraGuidelines?: string;
  references?: ReferenceImage[];
}

/** Compose the structured stage prompt (preservation block always included). */
export function buildStagePrompt(args: BuildPromptArgs): string {
  const parts: string[] = [
    "You are an expert architectural photo editor. Perform a natural, localized, photorealistic edit on the provided room image based on the user's request.",
    "",
    `User Request: ${args.userRequest}`,
  ];
  if (args.editLocation) {
    parts.push("", `Edit Location: ${args.editLocation}`);
  }
  parts.push(
    "",
    "Editing Guidelines:",
    "- The edit must be photorealistic and blend seamlessly with the surrounding area.",
    PRESERVATION_BLOCK,
  );
  if (args.references && args.references.length > 0) {
    parts.push("", "Reference images (material/form only):");
    for (const ref of args.references) {
      parts.push(`- ${referenceScopingNote(ref.label)}`);
    }
  }
  if (args.extraGuidelines) {
    parts.push("", args.extraGuidelines);
  }
  parts.push("", "Output: return ONLY the final edited image. Do not return text.");
  return parts.join("\n");
}
