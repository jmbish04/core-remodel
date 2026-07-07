/**
 * @fileoverview ProductTabs — the "Ecommerce43" tabbed detail section, rebuilt
 * for Monolith dark.
 *
 * Tabs: Details | Specs | Pricing intel | Savings & regulations | Research.
 *   - Details: description + a definition list of sku/leadTime/colors/etc.
 *   - Specs: striped divide-y rows from specs[] (no shadcn Table in this repo).
 *   - Pricing intel: the three AI estimates as cards with full rationale +
 *     reviewSummary at top.
 *   - Savings & regulations: salesIntel prose + the CA callout (full notes).
 *   - Research: findings list (sentiment dot + external link) + a collapsible
 *     "Full research report" rendered via MarkdownProse.
 *
 * Every panel handles the intel === null / empty case with an inviting message.
 */

import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MarkdownProse } from "@/components/research/MarkdownProse";

import {
  formatPrice,
  type Finding,
  type ProductContext,
  type ProductIntel,
  type Spec,
} from "./types";

// ─── Small shared pieces ─────────────────────────────────────────────────────

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/20 p-5 text-center text-sm text-muted-foreground ring-1 ring-border/40">
      {children}
    </div>
  );
}

function DefRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function sentimentDot(s: Finding["sentiment"]): string {
  if (s === "good") return "bg-emerald-400";
  if (s === "bad") return "bg-rose-400";
  return "bg-zinc-400";
}

// ─── Pricing-intel estimate card ─────────────────────────────────────────────

function EstimateCard({
  label,
  price,
  rationale,
}: {
  label: string;
  price: string | null;
  rationale: string | null;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border/40">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold tracking-tight">{label}</h4>
        <span className="font-mono text-lg font-semibold tabular-nums text-primary">
          {formatPrice(price) ?? "—"}
        </span>
      </div>
      {rationale ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground/70">{rationale}</p>
      ) : (
        <p className="mt-2 text-sm italic text-muted-foreground">No rationale captured.</p>
      )}
    </div>
  );
}

// ─── Collapsible full research report ────────────────────────────────────────

function ResearchReport({ report }: { report: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-card ring-1 ring-border/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:text-foreground"
      >
        Full research report
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/40 px-4 py-4">
          <MarkdownProse>{report}</MarkdownProse>
        </div>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export function ProductTabs({
  product,
  specs,
  findings,
  intel,
}: {
  product: ProductContext;
  specs: Spec[];
  findings: Finding[];
  intel: ProductIntel | null;
}) {
  const hasAnyDetail =
    product.sku ||
    product.leadTime ||
    product.colors ||
    product.preferredColor ||
    product.tradeDiscount ||
    product.possibleDiscounts;

  return (
    <Tabs defaultValue="details" className="w-full">
      <TabsList
        variant="line"
        className="mb-5 h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border/40 bg-transparent p-0"
      >
        <TabsTrigger value="details" className="px-3 py-2">Details</TabsTrigger>
        <TabsTrigger value="specs" className="px-3 py-2">Specs</TabsTrigger>
        <TabsTrigger value="pricing" className="px-3 py-2">Pricing intel</TabsTrigger>
        <TabsTrigger value="savings" className="px-3 py-2">Savings &amp; regulations</TabsTrigger>
        <TabsTrigger value="research" className="px-3 py-2">Research</TabsTrigger>
      </TabsList>

      {/* Details */}
      <TabsContent value="details" className="space-y-4">
        {product.description ? (
          <p className="max-w-prose text-sm leading-relaxed text-foreground/80">
            {product.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No description yet.</p>
        )}
        {hasAnyDetail ? (
          <dl className="divide-y divide-border/40 rounded-xl bg-card px-4 ring-1 ring-border/40">
            <DefRow label="SKU" value={product.sku} />
            <DefRow label="Lead time" value={product.leadTime} />
            <DefRow label="Colors" value={product.colors} />
            <DefRow label="Preferred color" value={product.preferredColor} />
            <DefRow label="Trade discount" value={product.tradeDiscount} />
            <DefRow label="Possible discounts" value={product.possibleDiscounts} />
          </dl>
        ) : null}
        {product.notes && (
          <div className="rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
            <p className="mb-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Notes
            </p>
            <p className="text-sm text-foreground/80">{product.notes}</p>
          </div>
        )}
      </TabsContent>

      {/* Specs */}
      <TabsContent value="specs">
        {specs.length === 0 ? (
          <EmptyNote>No specifications captured for this product yet.</EmptyNote>
        ) : (
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
            {specs.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-start justify-between gap-4 px-4 py-2.5 text-sm ${
                  i % 2 === 1 ? "bg-muted/20" : ""
                }`}
              >
                <span className="text-muted-foreground">{s.specKey}</span>
                <span className="text-right font-medium text-foreground">
                  {s.specValue ?? "—"}
                  {s.unit ? <span className="ml-1 text-muted-foreground">{s.unit}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {/* Pricing intel */}
      <TabsContent value="pricing" className="space-y-4">
        {intel ? (
          <>
            {intel.reviewSummary && (
              <Alert className="bg-card ring-1 ring-border/40">
                <Sparkles className="size-4 text-primary" />
                <AlertTitle>AI review summary</AlertTitle>
                <AlertDescription>{intel.reviewSummary}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <EstimateCard
                label="Wholesale (showroom cost)"
                price={intel.aiWholesalePrice}
                rationale={intel.aiWholesaleRationale}
              />
              <EstimateCard
                label="Retail"
                price={intel.aiRetailPrice}
                rationale={intel.aiRetailRationale}
              />
              <EstimateCard
                label="Your negotiation target"
                price={intel.aiNegotiatedPrice}
                rationale={intel.aiNegotiatedRationale}
              />
            </div>
          </>
        ) : (
          <EmptyNote>No pricing intel yet — run research to generate estimates.</EmptyNote>
        )}
      </TabsContent>

      {/* Savings & regulations */}
      <TabsContent value="savings" className="space-y-4">
        {intel?.salesIntel ? (
          <div className="rounded-xl bg-card p-4 ring-1 ring-border/40">
            <MarkdownProse>{intel.salesIntel}</MarkdownProse>
          </div>
        ) : (
          <EmptyNote>No savings intel captured yet.</EmptyNote>
        )}
        {intel?.caRegulatoryFlag && (
          <Alert className="bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30">
            <TriangleAlert className="size-4 text-amber-300" />
            <AlertTitle className="text-amber-200">California regulation</AlertTitle>
            <AlertDescription className="text-amber-200/80">
              {intel.caRegulatoryNotes ?? "This product is subject to California regulation."}
            </AlertDescription>
          </Alert>
        )}
      </TabsContent>

      {/* Research */}
      <TabsContent value="research" className="space-y-4">
        {findings.length === 0 && !intel?.researchReport ? (
          <EmptyNote>No research findings yet.</EmptyNote>
        ) : (
          <>
            {findings.length > 0 && (
              <ul className="space-y-2.5">
                {findings.map((f) => (
                  <li key={f.id} className="flex items-start gap-2.5 text-sm">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${sentimentDot(f.sentiment)}`}
                      aria-hidden
                    />
                    <span className="text-foreground/80">{f.finding}</span>
                    {f.findingUrl && (
                      <a
                        href={f.findingUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Source"
                        className="mt-0.5 shrink-0 text-sky-400 hover:text-sky-300"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {intel?.researchReport && <ResearchReport report={intel.researchReport} />}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
