/** Shared helpers for the render tools (create_render_session / run_render_stage). */
import type { StageType } from "@backend/services/render/types";

export const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

export function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

export function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}
