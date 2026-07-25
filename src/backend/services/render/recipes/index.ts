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

/** Recipe ids currently wired end-to-end (Slice 1). Slice-2 extends this union. */
export type RecipeId = "material-swap" | "mix";

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
  return [
    recipe.intro,
    "",
    `User Request: ${userRequest}`,
    "",
    "Editing Guidelines:",
    "- The edit must be photorealistic and blend seamlessly with the surrounding area.",
    recipe.guardrail,
    "",
    recipe.referencesHeader,
    ...opts.references.map((ref) => `- ${referenceScopingNote(ref.label)}`),
    "",
    "Output: return ONLY the final edited image. Do not return text.",
  ].join("\n");
}
