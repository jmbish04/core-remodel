/**
 * @fileoverview PricingIntelBlock — the right-column pricing panel that replaces
 * the ecommerce cart/size/color controls (there are no purchase actions here;
 * this is a sourcing-intel tool).
 *
 * Shows:
 *   - a big AI-estimated showroom-retail figure (falls back to product.price),
 *   - the "seen online" low–high range,
 *   - three mini-rows (Wholesale / Retail / Negotiation target) each with an
 *     info popover revealing the AI rationale,
 *   - a skeleton + "Research in progress" chip while pending/running,
 *   - a "Run research" outline button when idle/failed/null,
 *   - an amber "California regulation" callout when caRegulatoryFlag is set.
 *
 * Monolith dark: no 1px borders (ring/divide/bg-card), amber for warnings.
 */

import { Info, Loader2, Play, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  formatPrice,
  isResearchInFlight,
  type ProductContext,
  type ProductIntel,
} from "./types";

// ─── Rationale popover ───────────────────────────────────────────────────────

/**
 * A price row with an inline info affordance. The popover body carries the AI
 * rationale text; when no rationale is present the info button is omitted.
 */
function PriceRow({
  label,
  value,
  rationale,
  accent,
}: {
  label: string;
  value: string | null;
  rationale: string | null;
  accent?: boolean;
}) {
  const shown = formatPrice(value);
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {rationale && (
          <Popover>
            <PopoverTrigger
              aria-label={`Why: ${label}`}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <Info className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent className="w-72" side="top">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label} — rationale
              </p>
              <p className="text-sm leading-relaxed text-foreground/80">
                {rationale}
              </p>
            </PopoverContent>
          </Popover>
        )}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${
          accent ? "font-semibold text-primary" : "text-foreground"
        }`}
      >
        {shown ?? "—"}
      </span>
    </div>
  );
}

// ─── Skeleton (pending / running) ────────────────────────────────────────────

function PricingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-9 w-40 rounded-md bg-muted" />
      <div className="h-4 w-52 rounded bg-muted/70" />
      <div className="mt-4 space-y-2.5">
        <div className="h-4 w-full rounded bg-muted/50" />
        <div className="h-4 w-full rounded bg-muted/50" />
        <div className="h-4 w-full rounded bg-muted/50" />
      </div>
    </div>
  );
}

// ─── Block ───────────────────────────────────────────────────────────────────

export function PricingIntelBlock({
  product,
  intel,
  running,
  onRunResearch,
}: {
  product: ProductContext;
  intel: ProductIntel | null;
  /** True while a re-run is queued/executing (disables the trigger). */
  running: boolean;
  onRunResearch: () => void;
}) {
  const status = intel?.researchStatus ?? "idle";
  const inFlight = running || isResearchInFlight(status);

  // Headline: AI retail estimate, falling back to the human-entered price.
  const headline =
    formatPrice(intel?.aiRetailPrice) ?? formatPrice(product.price) ?? "Price TBD";
  const rangeLow = formatPrice(intel?.priceRangeLow);
  const rangeHigh = formatPrice(intel?.priceRangeHigh);

  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-border/40">
      {inFlight ? (
        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
            <Loader2 className="size-3 animate-spin" />
            Research in progress…
          </span>
          <PricingSkeleton />
        </div>
      ) : (
        <>
          {/* Headline retail figure */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Showroom retail (AI est.)
            </p>
            <p className="mt-0.5 font-mono text-3xl font-semibold tabular-nums text-foreground">
              {headline}
            </p>
            {rangeLow && rangeHigh && (
              <p className="mt-1 text-xs text-muted-foreground">
                Seen online: {rangeLow}–{rangeHigh}
              </p>
            )}
          </div>

          {intel ? (
            /* Three intel rows with rationale popovers */
            <div className="mt-4 divide-y divide-border/40">
              <PriceRow
                label="Wholesale (showroom cost)"
                value={intel.aiWholesalePrice}
                rationale={intel.aiWholesaleRationale}
              />
              <PriceRow
                label="Retail"
                value={intel.aiRetailPrice}
                rationale={intel.aiRetailRationale}
              />
              <PriceRow
                label="Your negotiation target"
                value={intel.aiNegotiatedPrice}
                rationale={intel.aiNegotiatedRationale}
                accent
              />
            </div>
          ) : (
            /* Not researched yet — inviting empty state */
            <div className="mt-4 rounded-xl bg-muted/20 p-4 text-center ring-1 ring-border/40">
              <p className="text-sm text-muted-foreground">
                No pricing intel yet. Run research to estimate wholesale, retail,
                and a negotiation target.
              </p>
            </div>
          )}

          {/* Run / re-run research */}
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full gap-1.5"
            onClick={onRunResearch}
            disabled={inFlight}
          >
            <Play className="size-3.5" />
            {intel ? "Re-run research" : "Run research"}
          </Button>

          {status === "failed" && (
            <p className="mt-2 text-center text-xs text-rose-400">
              Last research run failed — try again.
            </p>
          )}
        </>
      )}

      {/* California regulation callout */}
      {intel?.caRegulatoryFlag && (
        <Alert className="mt-4 bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30">
          <TriangleAlert className="size-4 text-amber-300" />
          <AlertTitle className="text-amber-200">California regulation</AlertTitle>
          <AlertDescription className="text-amber-200/80">
            {intel.caRegulatoryNotes ?? "This product is subject to California regulation."}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
