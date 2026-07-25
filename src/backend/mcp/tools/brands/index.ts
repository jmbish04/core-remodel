/**
 * @fileoverview MCP tools — Brands domain (barrel).
 *
 * Read + write access to the global brand registry (`brands`), the many-to-many
 * mapping that records which showroom locations carry which brands
 * (`showroomBrandMappings`), and read-through to the products a brand supplies
 * (`showroomStoreProducts`).
 *
 * A brand is the manufacturer / design house behind products (e.g. "THG Paris",
 * "Waterworks", "The Galley"). Brands are a global leaf registry — they are NOT
 * scoped to a single showroom. The `ensure_brand` tool is the reuse-or-create
 * primitive that reconcile / enrichment flows lean on so we never insert a
 * duplicate brand row for a name that already exists.
 */
import { type RemodelTool } from "../../types";

import { listBrands } from "./list_brands";
import { getBrand } from "./get_brand";
import { createBrand } from "./create_brand";
import { updateBrand } from "./update_brand";
import { ensureBrand } from "./ensure_brand";
import { linkBrandToShowroom } from "./link_brand_to_showroom";
import { unlinkBrandFromShowroom } from "./unlink_brand_from_showroom";
import { consolidateBrandTypesTool } from "./consolidate_brand_types";

export const brandTools: RemodelTool[] = [
  listBrands,
  getBrand,
  createBrand,
  updateBrand,
  ensureBrand,
  linkBrandToShowroom,
  unlinkBrandFromShowroom,
  consolidateBrandTypesTool,
];
