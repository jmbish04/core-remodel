/**
 * @fileoverview Sourcing Research console — orchestrator island.
 *
 * Hosts the four deep-research sourcing workflows over live endpoints:
 *   1. PromptStagingCard  — draft prompt + launch quick/deep sweep
 *   2. ReviewLedger       — approvable showroom candidates (per-item + bulk)
 *   2b. FindingsLedger    — sentiment-coded findings + sources for the target
 *   3. RuleOutDialog      — rule-out a showroom with feedback (cron negative)
 *   4. MediaGallery       — scraped imagery + scrape status + specs
 *
 * Self-fetches with plain `fetch` (see ./api), mounts via `client:only="react"`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Radar, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  getProductContext,
  getStoreContext,
  listProducts,
  listStores,
  type StoreListRow,
} from "./api";
import { FindingsLedger } from "./FindingsLedger";
import { MediaGallery } from "./MediaGallery";
import { PromptStagingCard } from "./PromptStagingCard";
import { ReviewLedger } from "./ReviewLedger";
import { RuleOutDialog } from "./RuleOutDialog";
import { SweepPlanReview } from "./SweepPlanReview";
import type {
  ProductResearchContext,
  ShowroomProduct,
  StoreResearchContext,
  SweepTarget,
} from "./types";

const STORE_TARGET = "__store__";

export function SourcingResearchApp() {
  const [stores, setStores] = useState<StoreListRow[]>([]);
  const [search, setSearch] = useState("");
  const [loadingStores, setLoadingStores] = useState(true);

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [products, setProducts] = useState<ShowroomProduct[]>([]);
  /** STORE_TARGET, or a product id as a string. */
  const [targetValue, setTargetValue] = useState<string>(STORE_TARGET);

  const [storeCtx, setStoreCtx] = useState<StoreResearchContext | null>(null);
  const [productCtx, setProductCtx] = useState<ProductResearchContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [planSessionId, setPlanSessionId] = useState<number | null>(null);

  const [ruleOutStore, setRuleOutStore] = useState<{ id: number; name: string } | null>(null);
  const [ruleOutOpen, setRuleOutOpen] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );

  const isProductTarget = targetValue !== STORE_TARGET;
  const productId = isProductTarget ? Number(targetValue) : null;

  const target: SweepTarget | null = selectedStoreId
    ? isProductTarget && productId
      ? { kind: "product", productId }
      : { kind: "store", storeId: selectedStoreId }
    : null;

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const targetLabel = isProductTarget
    ? selectedProduct?.itemName ?? "this product"
    : selectedStore?.name ?? "this showroom";

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadStores = useCallback(async (q: string) => {
    setLoadingStores(true);
    const result = await listStores(q);
    setLoadingStores(false);
    if (!result.ok) {
      toast.error(`Failed to load showrooms: ${result.error}`);
      return;
    }
    setStores(result.data);
  }, []);

  const loadStoreContext = useCallback(async (storeId: number) => {
    setLoadingCtx(true);
    const [ctx, prods] = await Promise.all([
      getStoreContext(storeId),
      listProducts(storeId),
    ]);
    setLoadingCtx(false);
    if (ctx.ok) setStoreCtx(ctx.data);
    else toast.error(`Failed to load showroom context: ${ctx.error}`);
    if (prods.ok) setProducts(prods.data as ShowroomProduct[]);
  }, []);

  const loadProductContext = useCallback(async (pid: number) => {
    setLoadingCtx(true);
    const ctx = await getProductContext(pid);
    setLoadingCtx(false);
    if (ctx.ok) setProductCtx(ctx.data);
    else toast.error(`Failed to load product context: ${ctx.error}`);
  }, []);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadStores("");
  }, [loadStores]);

  // Debounced search. Skip the initial render — the mount effect above already
  // issues the first `loadStores("")`, so debouncing on mount would duplicate it.
  const isFirstSearch = useRef(true);
  useEffect(() => {
    if (isFirstSearch.current) {
      isFirstSearch.current = false;
      return;
    }
    const t = setTimeout(() => void loadStores(search), 250);
    return () => clearTimeout(t);
  }, [search, loadStores]);

  // When a showroom is selected, load its context + reset the target to store.
  useEffect(() => {
    if (selectedStoreId == null) return;
    setTargetValue(STORE_TARGET);
    setProductCtx(null);
    void loadStoreContext(selectedStoreId);
  }, [selectedStoreId, loadStoreContext]);

  // When a product target is picked, load its context.
  useEffect(() => {
    if (productId == null) return;
    void loadProductContext(productId);
  }, [productId, loadProductContext]);

  // ── Refresh after sweep / approve / rule-out ──────────────────────────────

  const refreshTarget = useCallback(() => {
    if (productId != null) void loadProductContext(productId);
    else if (selectedStoreId != null) void loadStoreContext(selectedStoreId);
  }, [productId, selectedStoreId, loadProductContext, loadStoreContext]);

  function handleApproved() {
    void loadStores(search);
  }

  function handleRuledOut(storeId: number) {
    void loadStores(search);
    if (storeId === selectedStoreId) {
      setSelectedStoreId(null);
      setStoreCtx(null);
    }
  }

  // ── Derived detail data for the active target ─────────────────────────────

  const detailFindings = isProductTarget ? productCtx?.findings ?? [] : storeCtx?.findings ?? [];
  const detailSources = isProductTarget ? [] : storeCtx?.externalRatings ?? [];
  const detailImages = isProductTarget ? productCtx?.images ?? [] : storeCtx?.images ?? [];
  const detailSpecs = isProductTarget ? productCtx?.specs ?? [] : [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-violet-400">
            Gemini agent · sourcing sweeps
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Sourcing Research</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Stage a research brief, launch a citation-backed sweep, then review findings,
            sources, and scraped media — approving or ruling out showrooms to tune the cron.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadStores(search)} disabled={loadingStores}>
          <RefreshCw className={cn("size-4", loadingStores && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Left: review ledger of candidate showrooms */}
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <ReviewLedger
            stores={stores}
            loading={loadingStores}
            search={search}
            onSearch={setSearch}
            selectedStoreId={selectedStoreId}
            onSelect={setSelectedStoreId}
            onRuleOut={(store) => {
              setRuleOutStore(store);
              setRuleOutOpen(true);
            }}
            onApproved={handleApproved}
          />
        </aside>

        {/* Right: detail panel */}
        <main className="min-w-0 space-y-5">
          {target == null ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-muted/10 px-6 py-24 text-center ring-1 ring-border/40">
              <Radar className="size-8 text-muted-foreground/60" />
              <p className="mt-4 text-sm font-medium">Select a showroom to begin</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Pick a showroom from the review ledger to stage a sweep and inspect its
                findings, sources, and sourced media.
              </p>
            </div>
          ) : (
            <>
              {/* Target selector: whole showroom vs a specific product */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Sweep target</span>
                <Select
                  value={targetValue}
                  onValueChange={(value) => setTargetValue(value ?? STORE_TARGET)}
                >
                  <SelectTrigger className="h-8 w-64">
                    <SelectValue placeholder="Whole showroom" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STORE_TARGET}>
                      Whole showroom — {selectedStore?.name}
                    </SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.itemName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {products.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">No products on this showroom yet.</span>
                ) : null}
              </div>

              {/* WF1 */}
              <PromptStagingCard
                key={`${target.kind}-${isProductTarget ? productId : selectedStoreId}`}
                target={target}
                targetLabel={targetLabel}
                onSwept={refreshTarget}
                onSweepingChange={setSweeping}
                onPlanStarted={setPlanSessionId}
              />

              {/* Plan-review gate (deep mode) */}
              {planSessionId != null ? (
                <SweepPlanReview
                  key={planSessionId}
                  sessionId={planSessionId}
                  onComplete={() => {
                    refreshTarget();
                  }}
                  onClose={() => setPlanSessionId(null)}
                />
              ) : null}

              {/* WF2b + WF4 */}
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Diff &amp; review ledger</h3>
                  {loadingCtx ? (
                    <div className="rounded-lg bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground ring-1 ring-border/40">
                      Loading findings…
                    </div>
                  ) : (
                    <FindingsLedger
                      findings={detailFindings}
                      sources={detailSources}
                      scope={isProductTarget ? "product" : "store"}
                      onReviewed={refreshTarget}
                    />
                  )}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Media &amp; specs</h3>
                  <MediaGallery
                    images={detailImages}
                    specs={detailSpecs}
                    sweeping={sweeping}
                    scope={isProductTarget ? "product" : "store"}
                    onReviewed={refreshTarget}
                  />
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      {/* WF3 */}
      <RuleOutDialog
        open={ruleOutOpen}
        onOpenChange={setRuleOutOpen}
        store={ruleOutStore}
        onRuledOut={handleRuledOut}
      />
    </div>
  );
}
