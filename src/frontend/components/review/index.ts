/**
 * Barrel for the /review inspiration-scope surface.
 *
 * - `ScopedInspirationReview`     — reusable, read-only viewer grouped by category.
 * - `ScopedInspirationCategorizer`— the /review AI-suggest + confirm categorizer.
 * - `inspiration-categories`      — shared types, the canonical category list,
 *                                   and the Cloudflare delivery-URL resolver.
 */
export {
  ScopedInspirationReview,
  type ScopedInspirationFloor,
} from "./ScopedInspirationReview";
export { ScopedInspirationCategorizer } from "./ScopedInspirationCategorizer";
export { CategorizerCard } from "./CategorizerCard";
export {
  INSPIRATION_CATEGORIES,
  type BroadScope,
  type InspirationCategory,
  type ScopedInspirationImage,
  type ScopedInspirationGroup,
  isInspirationCategory,
  resolveScopedImageUrl,
} from "./inspiration-categories";
