/**
 * @fileoverview MCP tools — Materials domain (barrel).
 *
 * Read + write access to the home's material schedule (`material_schedule_items`) —
 * the master list of materials/components to source for the renovation (e.g.
 * "Induction cooktop", "Primary closet system"). This is the seed that feeds
 * downstream showroom discovery, product sourcing, gap analysis, and research.
 *
 * A material carries a required-spec sheet (`material_required_specs`), a
 * REQUIRED canonical room (`material_schedule_items.roomId` → `rooms.id`, hard
 * FK; the display name is derived by joining `rooms`), budget-line attributions
 * (`budget_item_material_mappings`, keyed by the STABLE budget `trackId`), and
 * mapped showroom products (`product_material_mappings`).
 *
 * These tools never delete materials; they only list, inspect, create, patch,
 * spec, and link. Deletion happens through the material-schedule admin UI.
 */
import { type RemodelTool } from "../../types";

import { createMaterial } from "./create_material";
import { getMaterial } from "./get_material";
import { linkMaterialToBudgetItem } from "./link_material_to_budget_item";
import { linkMaterialToRoom } from "./link_material_to_room";
import { listMaterialCategories } from "./list_material_categories";
import { listMaterials } from "./list_materials";
import { listRoomProposalsTool } from "./list_room_proposals";
import { markMaterialPurchased } from "./mark_material_purchased";
import { promoteLineItemTool } from "./promote_line_item";
import { resolveRoomProposalTool } from "./resolve_room_proposal";
import { setMaterialSpecs } from "./set_material_specs";
import { updateMaterial } from "./update_material";

export const materialTools: RemodelTool[] = [
  listMaterials,
  getMaterial,
  listMaterialCategories,
  createMaterial,
  updateMaterial,
  setMaterialSpecs,
  linkMaterialToRoom,
  linkMaterialToBudgetItem,
  markMaterialPurchased,
  listRoomProposalsTool,
  resolveRoomProposalTool,
  promoteLineItemTool,
];
