/**
 * @fileoverview Map extracted invoice/quote line items to products (0042 P5).
 *
 * After a quote is extracted and resolved to a showroom (P4), each line item is
 * matched to a product that showroom already carries, or — when nothing
 * matches — a brand + product are auto-created from the vendor + description
 * (deduped via the shared ensureProductFromExtraction), linked to the showroom,
 * and the line's price is recorded as a dated price observation. The line is
 * stamped with product_id / brand_id / match_status so the viewport panel can
 * show "matched" vs "new from quote — confirm/map".
 *
 * Runs post-extraction, which for Gmail-sourced mail is post-approval — a human
 * already gated the AI step, so auto-creating catalog rows here is safe (0042
 * trust gate). Only quotes that resolved to a showroom are mapped: an
 * unattributed quote does not silently fork the catalog.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { showroomProductMappings } from "@backend/db/schema/showroom/product_mappings";
import { productPriceObservations } from "@backend/db/schema/showroom/price_observations";
import { ensureProductFromExtraction } from "@backend/services/image-processor/intake-helpers";

type Db = ReturnType<typeof drizzle>;

/**
 * Lines that are charges, not products — never mint a catalog row from these.
 * ponytail: a prefix heuristic, not NLP. Widen the list if junk products appear.
 */
export const NON_PRODUCT_LINE =
  /^(tax|sales\s*tax|delivery|shipping|freight|handling|labor|labour|installation|install|subtotal|sub-total|total|discount|deposit|credit|surcharge|fee|gratuity|tip)\b/i;

export interface MapResult {
  matched: number;
  created: number;
  skipped: number;
}

/**
 * Map a single invoice's unmatched line items to products. Idempotent: only
 * `matchStatus='unmatched'` lines are processed, so a re-run (or reprocess,
 * which re-inserts lines as unmatched) does the right thing. Best-effort per
 * line — one bad line is skipped, never fails the batch.
 */
export async function mapInvoiceLinesToProducts(
  db: Db,
  invoiceId: number,
): Promise<MapResult> {
  const result: MapResult = { matched: 0, created: 0, skipped: 0 };

  const [invoice] = await db
    .select()
    .from(workerEmailInvoices)
    .where(eq(workerEmailInvoices.id, invoiceId))
    .limit(1);

  // Only map quotes we could attribute to a showroom — a store gives us the
  // link target + the price-observation source; an unattributed quote is left
  // for a human rather than forking products from it.
  if (!invoice || invoice.showroomStoreId == null) return result;
  const storeId = invoice.showroomStoreId;

  const lines = await db
    .select()
    .from(workerEmailInvoiceLineItems)
    .where(
      and(
        eq(workerEmailInvoiceLineItems.invoiceId, invoiceId),
        eq(workerEmailInvoiceLineItems.matchStatus, "unmatched"),
      ),
    );

  for (const line of lines) {
    const desc = (line.description ?? "").trim();
    if (!desc || NON_PRODUCT_LINE.test(desc)) {
      result.skipped++;
      continue;
    }

    try {
      // Reuse the shared find-or-create: (brand, itemName) dedup, returns the
      // product + whether it was newly created.
      const { created, product } = await ensureProductFromExtraction(db, {
        brand: invoice.vendorName ?? null,
        itemName: desc,
      });

      // Link the product to this showroom (idempotent via the uniq index).
      await db
        .insert(showroomProductMappings)
        .values({ showroomId: storeId, productId: product.id })
        .onConflictDoNothing();

      // Record the line's unit price as a dated observation — but not a dup:
      // reprocess re-runs mapping, so skip if the same product/store/price is
      // already on file.
      if (line.unitPrice != null && Number.isFinite(line.unitPrice)) {
        const cents = Math.round(line.unitPrice * 100);
        const [dup] = await db
          .select({ id: productPriceObservations.id })
          .from(productPriceObservations)
          .where(
            and(
              eq(productPriceObservations.productId, product.id),
              eq(productPriceObservations.showroomId, storeId),
              eq(productPriceObservations.priceCents, cents),
            ),
          )
          .limit(1);
        if (!dup) {
          await db.insert(productPriceObservations).values({
            productId: product.id,
            sourceType: "showroom",
            showroomId: storeId,
            price: `$${line.unitPrice.toFixed(2)}`,
            priceCents: cents,
            // Carry the AI's extraction confidence (0–1) → 0–100; default mid.
            confidence:
              invoice.confidence != null
                ? Math.max(0, Math.min(100, Math.round(invoice.confidence * 100)))
                : 60,
            reviewStatus: "pending",
            notes: `From email quote${invoice.invoiceNumber ? ` #${invoice.invoiceNumber}` : ""}`,
          });
        }
      }

      await db
        .update(workerEmailInvoiceLineItems)
        .set({
          productId: product.id,
          brandId: product.brandId ?? null,
          matchStatus: created ? "created" : "matched",
          updatedAt: new Date(),
        })
        .where(eq(workerEmailInvoiceLineItems.id, line.id));

      if (created) result.created++;
      else result.matched++;
    } catch (err) {
      console.error(`[map-invoice] line ${line.id} map failed:`, err);
      result.skipped++;
    }
  }

  return result;
}
