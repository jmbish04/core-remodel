/**
 * @fileoverview MCP tools — cross-domain workflows.
 *
 * `reconcile_purchase` is the composite the 0015 plan calls for: given a
 * purchased product and the material(s) it satisfies, ensure the whole graph
 * exists — brand → product → product↔showroom, and for each material: the
 * material row, its room link, its budget-line link, the product↔material
 * link, the purchased flag, and (optionally) the recorded actual expense —
 * creating or REUSING rows as needed. It composes the atomic domain tools
 * (so there is no duplicated business logic) plus an inline material
 * find-or-create (there is no standalone ensure_material tool).
 */
import { materialScheduleItems, rooms } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { cents, toolError } from "../format";
import { looseObject } from "../schemas";
import { brandTools } from "./brands";
import { budgetTools } from "./budget";
import { materialTools } from "./materials";
import { productTools } from "./products";
import { defineTool, WRITE, type RemodelTool, type ToolCtx } from "../types";

/**
 * name → handler map for the atomic tools reconcile composes. Built from the
 * domain arrays directly (NOT the registry) to avoid an import cycle
 * (registry → tools/index → workflow → registry).
 */
const HANDLERS = new Map<string, RemodelTool["handler"]>(
  [...brandTools, ...productTools, ...materialTools, ...budgetTools].map((t) => [t.name, t.handler]),
);

/** Invoke another tool's handler by name with the current ctx. */
async function call<T = Record<string, unknown>>(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const handler = HANDLERS.get(name);
  if (!handler) toolError(`Internal: tool "${name}" is not available to reconcile_purchase.`);
  return (await handler(ctx, args)) as T;
}

export const workflowTools: RemodelTool[] = [
  defineTool({
    name: "reconcile_purchase",
    category: "workflow",
    title: "Reconcile a purchase end-to-end",
    description:
      "One call to wire up a purchase across the whole model. Ensures the BRAND and PRODUCT exist (reused if already present), maps the product to a showroom, and for EACH target material: ensures the material row exists, links it to a room and a budget line, links the product to the material, marks it purchased, and optionally records the actual expense. Returns a report of every row created vs reused. Example: 'I bought a Toto Aquia (from Ferguson) for the primary bath, and two Kohler Corbelle toilets for the hall and lower baths.' Money is cents.",
    inputShape: {
      brand: z.string().min(1).describe("Brand name, e.g. 'Toto' (find-or-create)"),
      productName: z.string().min(1).describe("Product/model name, e.g. 'Aquia IV'"),
      sku: z.string().optional(),
      priceText: z.string().optional().describe("List price as shown, stored on the product (text)"),
      storeId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Owning showroom id for the product row; falls back to showroomId"),
      showroomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Showroom to map the product to (product↔showroom link)"),
      materials: z
        .array(
          z.object({
            title: z.string().min(1).describe("Material title, e.g. 'Toilet — Primary Bath'"),
            roomId: z.number().int().positive().describe("Canonical room id (required — materials belong to a room)"),
            budgetItemTrackId: z.string().optional(),
            budgetItemId: z.number().int().positive().optional(),
            purchasePriceCents: z
              .number()
              .int()
              .optional()
              .describe("Actual paid price in cents — records a budget expense when set"),
            vendorName: z.string().optional(),
            isPrimary: z.boolean().optional().describe("Mark this material the product's primary link"),
          }),
        )
        .min(1)
        .describe("One or more material items this product satisfies"),
    },
    annotations: WRITE,
    outputShape: {
      reconciled: z.boolean(),
      brandId: z.number().int(),
      productId: z.number().int(),
      steps: z.array(z.string()),
      materials: z.array(
        looseObject({
          title: z.string(),
          materialId: z.number().int(),
          steps: z.array(z.string()),
        }),
      ),
    },
    examples: [
      {
        title: "Toto toilet for the primary bath",
        args: {
          brand: "Toto",
          productName: "Aquia IV",
          sku: "MS446124CEMFG#01",
          showroomId: 4,
          materials: [
            { title: "Toilet — Primary Bath", roomId: 3, purchasePriceCents: 74800, vendorName: "Ferguson", isPrimary: true },
          ],
        },
      },
    ],
    handler: async (ctx, input) => {
      const { db } = ctx;
      const steps: string[] = [];

      // 1) Brand (find-or-create).
      const brand = await call<{ created: boolean; brand: { id: number; name: string } }>(
        ctx,
        "ensure_brand",
        { name: input.brand },
      );
      steps.push(`${brand.created ? "created" : "reused"} brand #${brand.brand.id} (${brand.brand.name})`);

      // 2) Product (find-or-create). ensure_product requires an owning storeId.
      const owningStoreId = input.storeId ?? input.showroomId;
      if (owningStoreId == null) {
        toolError("Provide `storeId` or `showroomId` — a product needs an owning showroom.");
      }
      const product = await call<{ created: boolean; product: { id: number; itemName: string } }>(
        ctx,
        "ensure_product",
        {
          itemName: input.productName,
          brandId: brand.brand.id,
          storeId: owningStoreId,
          sku: input.sku,
          price: input.priceText,
        },
      );
      steps.push(
        `${product.created ? "created" : "reused"} product #${product.product.id} (${product.product.itemName})`,
      );

      // 3) Map product → showroom.
      if (input.showroomId != null) {
        await call(ctx, "link_product_to_showroom", {
          productId: product.product.id,
          showroomId: input.showroomId,
        });
        steps.push(`linked product #${product.product.id} → showroom #${input.showroomId}`);
      }

      // 4) Per material: ensure row, links, purchased flag, optional expense.
      // Load the material schedule once (not per-iteration) and keep the local
      // list in sync as we create rows, so a later material in the same call can
      // reuse one created earlier — avoids an N+1 query and duplicate inserts.
      const materialResults: Record<string, unknown>[] = [];
      const allMaterials = await db.select().from(materialScheduleItems).all();
      for (const m of input.materials) {
        // 4a) find-or-create the material by title (+ room when provided).
        const titleLc = m.title.trim().toLowerCase();
        const existing = allMaterials.find(
          (row) =>
            row.title.trim().toLowerCase() === titleLc &&
            (m.roomId == null || row.roomId === m.roomId || row.roomId == null),
        );
        let materialId: number;
        let materialCreated = false;
        if (existing) {
          materialId = existing.id;
        } else {
          const created = await call<{ material: typeof materialScheduleItems.$inferSelect }>(
            ctx,
            "create_material",
            { title: m.title, roomId: m.roomId, brand: input.brand },
          );
          materialId = created.material.id;
          materialCreated = true;
          allMaterials.push(created.material);
        }
        const mSteps: string[] = [`${materialCreated ? "created" : "reused"} material #${materialId}`];

        // 4b) room link.
        if (m.roomId != null) {
          await call(ctx, "link_material_to_room", { materialId, roomId: m.roomId });
          mSteps.push(`→ room #${m.roomId}`);
        }
        // 4c) budget-line link.
        if (m.budgetItemTrackId || m.budgetItemId != null) {
          await call(ctx, "link_material_to_budget_item", {
            materialId,
            budgetItemTrackId: m.budgetItemTrackId,
            budgetItemId: m.budgetItemId,
          });
          mSteps.push(`→ budget ${m.budgetItemTrackId ?? `#${m.budgetItemId}`}`);
        }
        // 4d) product ↔ material.
        await call(ctx, "link_product_to_material", {
          productId: product.product.id,
          materialId,
          isPrimary: m.isPrimary ?? false,
        });
        mSteps.push(`↔ product #${product.product.id}`);

        // 4e) mark purchased with this product.
        await call(ctx, "mark_material_purchased", {
          materialId,
          purchasedShowroomProductId: product.product.id,
        });
        mSteps.push("marked purchased");

        // 4f) record the actual expense.
        const priceCents = cents(m.purchasePriceCents);
        if (priceCents != null) {
          await call(ctx, "record_expense", {
            item: `${input.productName} — ${m.title}`,
            amountCents: priceCents,
            category: "materials",
            vendorName: m.vendorName,
          });
          mSteps.push(`recorded expense ${priceCents}¢`);
        }

        materialResults.push({ title: m.title, materialId, steps: mSteps });
      }

      return {
        reconciled: true,
        brandId: brand.brand.id,
        productId: product.product.id,
        steps,
        materials: materialResults,
      };
    },
  }),
];
