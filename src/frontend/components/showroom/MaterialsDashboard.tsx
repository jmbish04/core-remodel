import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  ShoppingBag,
  TrendingUp,
  AlertOctagon,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  Database,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants & Types ────────────────────────────────────────────────────────

const ROOM_AREAS = [
  "Kitchen",
  "Bathroom",
  "Closet",
  "Living",
  "Exterior",
  "General",
] as const;

type RoomArea = (typeof ROOM_AREAS)[number];

interface Product {
  id: number;
  storeId: number;
  itemName: string;
  description: string | null;
  colors: string | null;
  preferredColor: string | null;
  sku: string | null;
  price: string | null;
  jsonDetails: string | null;
  notes: string | null;
  leadTime: string | null;
  possibleDiscounts: string | null;
  tradeDiscount: string | null;
  storeName: string;
  roomName: string | null;
  areaName: string | null;
}

interface ParsedDetails {
  quantity: number;
  budget: number;
  status: "Wishlist" | "Selected" | "Purchased" | "Delivered";
  alerts: Array<{ type: "warning" | "error"; message: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDetails(jsonDetailsStr: string | null, priceStr: string | null): ParsedDetails {
  let quantity = 1;
  let budget = 0;
  let status: "Wishlist" | "Selected" | "Purchased" | "Delivered" = "Wishlist";
  let alerts: Array<{ type: "warning" | "error"; message: string }> = [];

  if (jsonDetailsStr) {
    try {
      const parsed = JSON.parse(jsonDetailsStr);
      quantity = typeof parsed.quantity === "number" ? parsed.quantity : parseInt(parsed.quantity ?? "1", 10);
      budget = typeof parsed.budget === "number" ? parsed.budget : parseFloat(parsed.budget ?? "0");
      status = parsed.status ?? "Wishlist";
      alerts = parsed.alerts ?? [];
    } catch {
      // ignore
    }
  }

  if (budget === 0 && priceStr) {
    const cleaned = priceStr.replace(/[^0-9.]/g, "");
    const parsedNum = parseFloat(cleaned);
    if (!isNaN(parsedNum)) {
      budget = parsedNum;
    }
  }

  return {
    quantity: isNaN(quantity) ? 1 : quantity,
    budget: isNaN(budget) ? 0 : budget,
    status,
    alerts,
  };
}

function normalizeRoomArea(roomName: string | null): RoomArea {
  if (!roomName) return "General";
  const normalized = roomName.toLowerCase().trim();
  if (normalized.includes("kitchen")) return "Kitchen";
  if (normalized.includes("bathroom") || normalized.includes("bath")) return "Bathroom";
  if (normalized.includes("closet")) return "Closet";
  if (normalized.includes("living") || normalized.includes("bedroom") || normalized.includes("indoor")) return "Living";
  if (normalized.includes("exterior") || normalized.includes("outdoor") || normalized.includes("deck") || normalized.includes("patio")) return "Exterior";
  return "General";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── MaterialsDashboard ───────────────────────────────────────────────────────

export function MaterialsDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // View states selector for presentation/auditing
  const [viewState, setViewState] = useState<"DATA" | "EMPTY" | "LOADING" | "ERROR">("DATA");

  // Fetch products
  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/showroom-stores/products");
      if (!res.ok) {
        throw new Error(`Server returned status: ${res.status}`);
      }
      const data = await res.json() as { products?: Product[] };
      setProducts(data.products ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load products list from database.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // Compute stats
  const { totalBudget, totalSpent, alertCount, productsByRoom, chartData } = useMemo(() => {
    let budgetAccumulator = 0;
    let spentAccumulator = 0;
    let alertAccumulator = 0;
    const roomMap: Record<string, Product[]> = {};

    // Grouping by RoomName (e.g. Master Bath, Kitchen, Guest Bedroom)
    const normalizedProducts = products.map((p) => {
      const details = parseDetails(p.jsonDetails, p.price);
      const totalItemBudget = details.budget * details.quantity;
      budgetAccumulator += totalItemBudget;
      if (details.status === "Purchased" || details.status === "Delivered") {
        spentAccumulator += totalItemBudget;
      }
      alertAccumulator += details.alerts.length;

      const roomKey = p.roomName || "Unassigned General";
      if (!roomMap[roomKey]) {
        roomMap[roomKey] = [];
      }
      roomMap[roomKey].push(p);

      return {
        ...p,
        parsed: details,
      };
    });

    // 6 major areas for stacked budget chart
    const computedChartData = ROOM_AREAS.map((area) => {
      const areaProducts = normalizedProducts.filter(
        (p) => normalizeRoomArea(p.roomName) === area
      );

      let areaAllocated = 0;
      let areaSpent = 0;

      for (const p of areaProducts) {
        const itemBudget = p.parsed.budget * p.parsed.quantity;
        areaAllocated += itemBudget;
        if (p.parsed.status === "Purchased" || p.parsed.status === "Delivered") {
          areaSpent += itemBudget;
        }
      }

      const isOver = areaSpent > areaAllocated;
      const remaining = isOver ? 0 : areaAllocated - areaSpent;
      const overBudget = isOver ? areaSpent - areaAllocated : 0;

      return {
        area,
        spent: areaSpent,
        remaining,
        overBudget,
        allocated: areaAllocated,
      };
    });

    return {
      totalBudget: budgetAccumulator,
      totalSpent: spentAccumulator,
      alertCount: alertAccumulator,
      productsByRoom: roomMap,
      chartData: computedChartData,
    };
  }, [products]);

  // Determine which state to render
  const renderState = useMemo(() => {
    if (viewState === "LOADING" || (loading && viewState === "DATA")) return "LOADING";
    if (viewState === "ERROR" || (error && viewState === "DATA")) return "ERROR";
    if (viewState === "EMPTY" || (products.length === 0 && viewState === "DATA")) return "EMPTY";
    return "DATA";
  }, [viewState, loading, error, products]);

  // ─── Loading Skeleton View ──────────────────────────────────────────────────

  if (renderState === "LOADING") {
    return (
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {/* Controls header */}
        <div className="flex justify-end gap-2 border-b border-zinc-800 pb-2">
          {["DATA", "EMPTY", "LOADING", "ERROR"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={viewState === s ? "secondary" : "ghost"}
              onClick={() => setViewState(s as any)}
              className="h-7 text-xs font-mono"
            >
              {s}
            </Button>
          ))}
        </div>

        {/* Hero skeleton */}
        <div className="space-y-4">
          <div className="h-8 w-64 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-96 animate-pulse rounded bg-zinc-800" />
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900 ring-1 ring-zinc-800" />
            ))}
          </div>
        </div>

        {/* Content grid skeleton */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="h-64 animate-pulse rounded-xl bg-zinc-900 ring-1 ring-zinc-800" />
            <div className="space-y-3">
              <div className="h-8 animate-pulse rounded bg-zinc-800" />
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-zinc-900" />
              ))}
            </div>
          </div>
          <div className="h-96 animate-pulse rounded-xl bg-zinc-900 ring-1 ring-zinc-800" />
        </div>
      </div>
    );
  }

  // ─── Error View ─────────────────────────────────────────────────────────────

  if (renderState === "ERROR") {
    return (
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <div className="flex justify-end gap-2 border-b border-zinc-800 pb-2">
          {["DATA", "EMPTY", "LOADING", "ERROR"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={viewState === s ? "secondary" : "ghost"}
              onClick={() => setViewState(s as any)}
              className="h-7 text-xs font-mono"
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl bg-zinc-900/40 p-8 text-center ring-1 ring-red-500/20">
          <div className="rounded-full bg-red-500/10 p-4 ring-1 ring-red-500/30">
            <AlertOctagon className="size-8 text-red-400 animate-pulse" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight text-white">Database Connection Error</h2>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            {error || "We encountered an issue connecting to the Cloudflare D1 serverless database. Please verify your D1 bindings and try again."}
          </p>
          <div className="mt-6 flex gap-4">
            <Button
              onClick={fetchProducts}
              variant="outline"
              className="border-zinc-800 bg-zinc-950 text-white hover:bg-zinc-900"
            >
              <RefreshCw className="mr-2 size-4" /> Retry Connection
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Empty View ─────────────────────────────────────────────────────────────

  if (renderState === "EMPTY") {
    return (
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <div className="flex justify-end gap-2 border-b border-zinc-800 pb-2">
          {["DATA", "EMPTY", "LOADING", "ERROR"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={viewState === s ? "secondary" : "ghost"}
              onClick={() => setViewState(s as any)}
              className="h-7 text-xs font-mono"
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="flex min-h-[450px] flex-col items-center justify-center rounded-xl bg-zinc-900/20 p-8 text-center ring-1 ring-zinc-800/80">
          <div className="rounded-full bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
            <ShoppingBag className="size-8 text-zinc-500" />
          </div>
          <h2 className="mt-4 text-lg font-medium tracking-tight text-white">No Materials Added</h2>
          <p className="mt-2 max-w-md text-sm text-zinc-500">
            Initiate your remodel inventory by importing specifications, visiting local showrooms, or adding custom items manually.
          </p>
          <div className="mt-6">
            <Button
              variant="outline"
              className="border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800"
              onClick={() => window.location.href = "/admin/showroom"}
            >
              <Plus className="mr-2 size-4" /> Add Products via Showrooms
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Data View (Default Render) ─────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">
      {/* ── View switcher tab / indicator for debug/UX testing ── */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-mono">
            LIVE D1
          </Badge>
          <span className="text-[10px] text-zinc-500 font-mono">Connected</span>
        </div>
        <div className="flex gap-2">
          {["DATA", "EMPTY", "LOADING", "ERROR"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={viewState === s ? "secondary" : "ghost"}
              onClick={() => setViewState(s as any)}
              className="h-6 text-[10px] font-mono"
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Asymmetric Header & Stats ── */}
      <div className="space-y-6">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
            Materials Schedule
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            A centralized register of select fixtures, finishes, and architectural hardware. Cross-referenced against local Bay Area sourcing hubs and verified by Cloudflare research agents.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Summary Card 1: Budget */}
          <div className="rounded-xl bg-zinc-900/60 p-5 ring-1 ring-zinc-800/80">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500">
              <span>Allocated Budget</span>
              <Layers className="size-4 text-zinc-600" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight text-white">
                {formatCurrency(totalBudget)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Total midpoint budget across {products.length} line items
            </p>
          </div>

          {/* Summary Card 2: Spent */}
          <div className="rounded-xl bg-zinc-900/60 p-5 ring-1 ring-zinc-800/80">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500">
              <span>Actual Spent</span>
              <CheckCircle2 className="size-4 text-zinc-600" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight text-white">
                {formatCurrency(totalSpent)}
              </span>
              <span className="text-xs font-mono text-emerald-400">
                ({totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%)
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Accumulated costs of purchased and delivered items
            </p>
          </div>

          {/* Summary Card 3: Warnings */}
          <div className="rounded-xl bg-zinc-900/60 p-5 ring-1 ring-zinc-800/80">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500">
              <span>Active Warnings</span>
              <AlertTriangle className="size-4 text-zinc-600" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight text-amber-500">
                {alertCount}
              </span>
              {alertCount > 0 && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400 ring-1 ring-amber-500/20 animate-pulse">
                  Requires attention
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Compatibility mismatches or lead-time exceptions flagged by AI
            </p>
          </div>
        </div>
      </div>

      {/* ── Main Layout Split ── */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left 2/3 Content Column */}
        <div className="space-y-8 lg:col-span-2">
          {/* Budget Chart Card */}
          <Card className="border-0 bg-zinc-900/40 ring-1 ring-zinc-800/60">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-base font-semibold text-zinc-200">
                Area Allocation Breakdown
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500">
                Spent vs. remaining allocation based on status per product category.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatCurrency(v)}
                    />
                    <YAxis
                      type="category"
                      dataKey="area"
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={80}
                      tick={{ fill: "#e4e4e7" }}
                    />
                    <Tooltip
                      cursor={{ fill: "#27272a", opacity: 0.15 }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 shadow-xl ring-1 ring-black/50">
                            <p className="text-xs font-semibold text-white">{data.area}</p>
                            <Separator className="my-1.5 bg-zinc-800" />
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between gap-8 text-zinc-400">
                                <span>Spent:</span>
                                <span className="font-mono text-zinc-100">{formatCurrency(data.spent)}</span>
                              </div>
                              <div className="flex justify-between gap-8 text-zinc-400">
                                <span>Remaining:</span>
                                <span className="font-mono text-zinc-100">{formatCurrency(data.remaining)}</span>
                              </div>
                              {data.overBudget > 0 && (
                                <div className="flex justify-between gap-8 text-rose-400 font-medium">
                                  <span>Over Budget:</span>
                                  <span className="font-mono">{formatCurrency(data.overBudget)}</span>
                                </div>
                              )}
                              <Separator className="my-1 bg-zinc-900" />
                              <div className="flex justify-between gap-8 font-medium text-white">
                                <span>Total Allocated:</span>
                                <span className="font-mono">{formatCurrency(data.allocated)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                    {/* Spent bar */}
                    <Bar dataKey="spent" name="Spent" stackId="a" fill="#5cb8ff" radius={[0, 0, 0, 0]} />
                    {/* Remaining bar */}
                    <Bar dataKey="remaining" name="Remaining" stackId="a" fill="#3edd8b" radius={[0, 4, 4, 0]} />
                    {/* Over budget indicator (if any) */}
                    <Bar dataKey="overBudget" name="Over Budget" stackId="a" fill="#f57158" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Custom Legends */}
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-[#5cb8ff]" />
                  <span className="text-zinc-400">Actual Spent</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-[#3edd8b]" />
                  <span className="text-zinc-400">Remaining Budget</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-[#f57158]" />
                  <span className="text-zinc-400">Over-Budget Overage</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Materials Table Card */}
          <div className="rounded-xl border-0 bg-zinc-900/20 ring-1 ring-zinc-800/60 overflow-hidden">
            <div className="p-6">
              <h2 className="text-base font-semibold text-zinc-200">Materials Schedule Registry</h2>
              <p className="mt-1 text-xs text-zinc-500">Grouped by project space and technical room mappings.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/30 text-zinc-400 font-medium">
                    <th className="p-4">Material / Item</th>
                    <th className="p-4">Product Area</th>
                    <th className="p-4 text-right">Budget</th>
                    <th className="p-4 text-center">Qty</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-center">AI Diagnostics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {Object.entries(productsByRoom).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-zinc-500">
                        No materials matching active records.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(productsByRoom).map(([roomName, roomProducts]) => (
                      <React.Fragment key={roomName}>
                        {/* Group Header Row */}
                        <tr className="bg-zinc-900/10 border-t border-zinc-800/80">
                          <td colSpan={6} className="px-4 py-2 font-medium text-zinc-300 bg-zinc-950/20 text-[11px] uppercase tracking-wide">
                            📍 {roomName}
                          </td>
                        </tr>
                        {roomProducts.map((p) => {
                          const details = parseDetails(p.jsonDetails, p.price);
                          const hasAlerts = details.alerts.length > 0;
                          
                          // Style for statuses
                          const badgeClasses = {
                            Wishlist: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
                            Selected: "bg-sky-500/15 text-sky-400 ring-sky-500/30",
                            Purchased: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
                            Delivered: "bg-teal-500/15 text-teal-400 ring-teal-500/30",
                          };

                          return (
                            <tr key={p.id} className="hover:bg-zinc-900/20 transition-colors group">
                              <td className="p-4">
                                <a
                                  href={`/admin/material-viewport?id=${p.id}`}
                                  className="font-medium text-zinc-200 hover:text-white hover:underline transition-all block max-w-xs truncate"
                                >
                                  {p.itemName}
                                </a>
                                {p.colors && (
                                  <span className="text-[10px] text-zinc-500 block mt-0.5">
                                    Finish: {p.colors}
                                  </span>
                                )}
                              </td>
                              <td className="p-4 text-zinc-400">
                                {p.areaName || "Unassigned"}
                              </td>
                              <td className="p-4 text-right font-mono text-zinc-300 tabular-nums">
                                {formatCurrency(details.budget)}
                              </td>
                              <td className="p-4 text-center font-mono text-zinc-400 tabular-nums">
                                {details.quantity}
                              </td>
                              <td className="p-4">
                                <span className={cn(
                                  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1",
                                  badgeClasses[details.status] || badgeClasses.Wishlist
                                )}>
                                  {details.status}
                                </span>
                              </td>
                              <td className="p-4 text-center">
                                {hasAlerts ? (
                                  <div className="inline-flex items-center gap-1 text-amber-500 cursor-help" title={details.alerts[0].message}>
                                    <AlertTriangle className="size-3.5" />
                                    <span className="text-[10px] font-mono">{details.alerts.length}</span>
                                  </div>
                                ) : (
                                  <span className="text-zinc-600 font-mono">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 1/3 Procurement Timeline Checklist Column */}
        <div className="space-y-6">
          <Card className="border-0 bg-zinc-900/40 ring-1 ring-zinc-800/60">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-base font-semibold text-zinc-200 flex items-center gap-2">
                <Calendar className="size-4 text-zinc-400" />
                Sourcing Milestones
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500">
                Critical lead-time ordering sequence mapped against general contractor milestone phases.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Milestone list */}
              <div className="relative border-l border-zinc-850 pl-5 space-y-8">
                {/* Step 1 */}
                <div className="relative">
                  <div className="absolute -left-[27px] top-0.5 size-4 rounded-full border-2 border-zinc-800 bg-[#0a0a0c] flex items-center justify-center">
                    <div className="size-1.5 rounded-full bg-zinc-600" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-300">Phase 1: Framing & Mud-In</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                      Must procure frameless door frames and drywall reveals before wall insulation signoff.
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20 font-mono">
                        CRITICAL DEADLINE
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative">
                  <div className="absolute -left-[27px] top-0.5 size-4 rounded-full border-2 border-zinc-800 bg-[#0a0a0c] flex items-center justify-center">
                    <div className="size-1.5 rounded-full bg-zinc-600" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-300">Phase 2: Valve Rough-In</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                      Shower valves, steam generator components, and wall-mount faucet boxes must arrive for plumbing inspections.
                    </p>
                    <div className="mt-2">
                      <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 font-mono">
                        PENDING ACQUISITION
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative">
                  <div className="absolute -left-[27px] top-0.5 size-4 rounded-full border-2 border-zinc-800 bg-[#0a0a0c] flex items-center justify-center">
                    <div className="size-1.5 rounded-full bg-zinc-600" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-300">Phase 3: Substrate & Stone</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                      Verify porcelain sheet size and fabricate hidden induction cutouts. Subzero dimensions verification.
                    </p>
                    <div className="mt-2">
                      <Badge variant="outline" className="text-[9px] bg-zinc-550/15 text-zinc-400 border-zinc-800/80 font-mono">
                        PLANNING PRE-BUY
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="relative">
                  <div className="absolute -left-[27px] top-0.5 size-4 rounded-full border-2 border-zinc-800 bg-[#0a0a0c] flex items-center justify-center">
                    <div className="size-1.5 rounded-full bg-zinc-600" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-300">Phase 4: Casework & LED Trim</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                      Align cabinet details with low-voltage driver cabinets and Rimadesio track embeds.
                    </p>
                    <div className="mt-2">
                      <Badge variant="outline" className="text-[9px] bg-zinc-550/15 text-zinc-400 border-zinc-800/80 font-mono">
                        PLANNING PRE-BUY
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
              
              <Separator className="bg-zinc-850" />
              
              <div className="rounded-lg bg-zinc-950 p-3 ring-1 ring-zinc-850 flex items-start gap-2.5">
                <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-zinc-200">1 Unordered Framing Dependency</p>
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Fry Reglet drywall mud-in reveal profiles are currently marked as "Selected" but not yet "Purchased". Contractor notes wall board installation starts in 12 days.
                  </p>
                  <a
                    href="/admin/showroom"
                    className="inline-flex items-center text-[10px] font-medium text-[#5cb8ff] hover:underline mt-1"
                  >
                    View sourcing options <ArrowRight className="ml-1 size-3" />
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
