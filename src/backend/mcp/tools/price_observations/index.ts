/**
 * @fileoverview MCP tools — Product Price Observations.
 *
 * A price is not a property of a product or a showroom mapping — it is a
 * dated, source-attributed observation (`product_price_observations`): a
 * price seen at a showroom, from an online retailer, or the manufacturer's
 * MSRP. `record_price_observation` inserts one; `list_price_observations`
 * reads them back for a product.
 */
import type { RemodelTool } from "../../types";

import { listPriceObservations } from "./list_price_observations";
import { recordPriceObservation } from "./record_price_observation";

export const priceObservationTools: RemodelTool[] = [
  recordPriceObservation,
  listPriceObservations,
];
