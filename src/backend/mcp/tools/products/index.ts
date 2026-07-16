/**
 * @fileoverview MCP tools — Products domain (registry barrel).
 *
 * See the per-tool files in this directory for full documentation. Products are
 * global (no owning store) and fan out across showrooms and material-schedule
 * items via the two join tables.
 */
import { type RemodelTool } from "../../types";

import { createProduct } from "./create_product";
import { ensureProduct } from "./ensure_product";
import { getProduct } from "./get_product";
import { linkProductToMaterial } from "./link_product_to_material";
import { linkProductToShowroom } from "./link_product_to_showroom";
import { listProducts } from "./list_products";
import { updateProduct } from "./update_product";

export const productTools: RemodelTool[] = [
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  ensureProduct,
  linkProductToShowroom,
  linkProductToMaterial,
];
