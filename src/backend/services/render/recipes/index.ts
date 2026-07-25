/**
 * Recipe registry (docs/0014_ai_photo_workshop, Slice-2 P0-RECIPE-REGISTRY).
 *
 * A "recipe" is a node-action the Workshop runs on a canvas node. Each recipe
 * declares its render stage type, how its input images are wired (material/form
 * reference list vs. ordered @image synthesis), and the prompt scaffold it
 * composes. This is the single registration point the Slice-2 recipes plug into
 * instead of hand-rolling near-identical prompt strings in the route handler.
 *
 * Guardrail blocks live in `./guardrails` so structure-lock recipes (the default
 * today) and the geometry/camera-lock variants Slice-2 needs share one source.
 *
 * Behaviour note: `material-swap` and `mix` produce byte-identical prompts to the
 * pre-registry inline handlers — this refactor is structure-only, no output drift.
 */
import type { StageType } from "../types";
import { PRESERVATION_BLOCK } from "../prompt-kit";
import { referenceScopingNote } from "../prompt-kit";

/**
 * Fidelity guardrails, one per structural intent. `PRESERVATION_BLOCK` (from
 * prompt-kit) is the strictest — nothing added/moved — and suits material/finish
 * edits. The blocks below relax exactly the axis a recipe must change while
 * locking everything else, so the model can't drift the architecture.
 */

/** clay/SketchUp → photoreal: geometry & camera locked, materials free to change. */
export const GEOMETRY_LOCK = [
  "- PRESERVE EXACTLY (do not change in any way): the 3D geometry, every wall/window/opening position, the room's dimensions and proportions, the camera angle/perspective, and the direction of the lighting.",
  "- You MAY assign realistic materials, textures, colors, and finishes to surfaces — that is the goal.",
  "- Do NOT invent, move, widen, or close any wall, window, or opening; do NOT re-frame, crop, or change the aspect ratio.",
].join("\n");

/** floor-plan furnish: structure & top-down view locked, furniture must be added. */
export const PLAN_FURNISH_LOCK = [
  "- PRESERVE EXACTLY (do not change in any way): every existing wall, door, window, and fixed opening and their precise positions; the top-down orientation; and the overall drawing framing.",
  "- ADD realistic furniture and fixtures appropriate to each room's function — this is the goal.",
  "- Do NOT invent, move, widen, remove, or close any wall, door, or window.",
  "- Remove any text labels/annotations; do NOT add new text.",
].join("\n");

/** Recipe ids wired end-to-end. */
export type RecipeId = "material-swap" | "mix" | "clay-to-photoreal" | "floor-plan-furnish";

/**
 * How a recipe hands images to `runStage`:
 * - `references`: material/form-only reference list (single-image edit).
 * - `imageUrls`: ordered `[base, ...refs]` for `@image{n}` multi-image synthesis.
 */
export type RecipeInputMode = "references" | "imageUrls";

/** A material/form-scoped reference image passed to the model. */
export interface RecipeRef {
  url: string;
  label: string;
}

export interface RecipeDef {
  id: RecipeId;
  /** Homeowner-facing verb-and-outcome label (never the stage jargon). */
  label: string;
  /** Grouping bucket for the node menu. */
  category: string;
  /** Render pipeline stage this recipe drives. */
  stageType: StageType;
  /** How its images are wired into `runStage`. */
  inputMode: RecipeInputMode;
  /** Opening instruction line of the composed prompt. */
  intro: string;
  /** Used when the caller supplies no prompt. */
  defaultUserRequest: string;
  /** Fidelity guardrail block (structure-lock by default). */
  guardrail: string;
  /** Header line preceding the per-reference scoping notes. */
  referencesHeader: string;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  "material-swap": {
    id: "material-swap",
    label: "Swap material / finish",
    category: "material",
    stageType: "stage_3_LP_finish",
    inputMode: "references",
    intro:
      "You are an expert architectural photo editor. Perform a natural, localized, photorealistic finish edit on the provided room image based on the user's request.",
    defaultUserRequest: "Apply the referenced material/finish to this room.",
    guardrail: PRESERVATION_BLOCK,
    referencesHeader: "Reference images (material/form only):",
  },
  mix: {
    id: "mix",
    label: "Mix samples",
    category: "synthesis",
    stageType: "stage_5_LP_synthesis",
    inputMode: "imageUrls",
    intro:
      "You are an expert architectural photo editor. Synthesize the referenced samples into the base room image based on the user's request.",
    defaultUserRequest: "Mix these samples into the room, keeping the result photorealistic.",
    guardrail: PRESERVATION_BLOCK,
    referencesHeader: "Reference images (material/form only, in @image order after the base):",
  },
  "clay-to-photoreal": {
    id: "clay-to-photoreal",
    label: "Make my SketchUp real",
    category: "render",
    stageType: "stage_3_LP_finish",
    inputMode: "references",
    intro:
      "You are an expert architectural rendering artist. Convert the provided clay / untextured 3D render into a photorealistic image based on the user's request.",
    defaultUserRequest:
      "Render this model photorealistically with believable materials, lighting, and finishes.",
    guardrail: GEOMETRY_LOCK,
    referencesHeader: "Style reference images (material/palette only):",
  },
  "floor-plan-furnish": {
    id: "floor-plan-furnish",
    label: "Furnish this floor plan",
    category: "plan",
    stageType: "stage_3_LP_finish",
    inputMode: "references",
    intro:
      "You are an expert interior space planner. Add realistic furniture and fixtures to the provided floor plan based on the user's request.",
    defaultUserRequest:
      "Furnish every room appropriately for its function, keeping the plan's structure intact.",
    guardrail: PLAN_FURNISH_LOCK,
    referencesHeader: "Style reference images (material/palette only):",
  },
};

/**
 * Compose a recipe's model prompt. References must already carry resolved labels
 * (e.g. `reference 1`, or a clipping's own label) — the builder only scopes them.
 */
export function buildRecipePrompt(
  recipe: RecipeDef,
  opts: { userRequest?: string; references: RecipeRef[] },
): string {
  const userRequest = opts.userRequest || recipe.defaultUserRequest;
  const lines = [
    recipe.intro,
    "",
    `User Request: ${userRequest}`,
    "",
    "Editing Guidelines:",
    "- The edit must be photorealistic and blend seamlessly with the surrounding area.",
    recipe.guardrail,
  ];
  // Reference section only when refs are actually supplied (clay/plan recipes
  // often run with none).
  if (opts.references.length > 0) {
    lines.push(
      "",
      recipe.referencesHeader,
      ...opts.references.map((ref) => `- ${referenceScopingNote(ref.label)}`),
    );
  }
  lines.push("", "Output: return ONLY the final edited image. Do not return text.");
  return lines.join("\n");
}
