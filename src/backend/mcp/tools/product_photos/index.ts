import { type RemodelTool } from "../../types";

import { reviewProductPhoto } from "./review_product_photo";
import { listPendingProductPhotos } from "./list_pending_product_photos";

// Re-exported for the REST twin at api/routes/product-photos.ts, which shares the
// same review implementation (it imported these from the old monolith path).
export { reviewProductPhotoCore } from "./review_product_photo";
export type { ReviewProductPhotoInput } from "./review_product_photo";

export const productPhotoTools: RemodelTool[] = [
  reviewProductPhoto,
  listPendingProductPhotos,
];
