import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Database,
  FileText,
  Layers,
  Menu as MenuIcon,
  Pencil,
  Plus,
  Save,
  Scale,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AnimatedNumber,
  Chip,
  ConfidenceBar,
  EmptyState,
  ErrorBanner,
  fmtCents,
  fmtPct,
  KPI,
  MonolithCard,
  PageHeader,
  PHASE_LABEL,
  SectionTitle,
  Skeleton,
  SOURCE_LABEL,
  Sparkline,
  TRADE_LABEL,
  TRADE_TONE,
  UNIT_LABEL,
  type ChipTone,
} from "./monolith";

// ---------- Types ----------
type Activity = {
  id: string;
  trackId: string;
  revisionNumber: number;
  isActive: boolean;
  trade: string;
  phase: string;
  scopeKey: string;
  displayName: string;
  description: string | null;
  scopeKeywords: string[] | null;
  unit: string;
  baselineLaborCentsPerUnit: number;
  baselineMaterialCentsPerUnit: number;
  baselineEquipmentCentsPerUnit: number;
  marketAdjustmentPct: number;
  insuranceBaselineCentsPerUnit: number | null;
  notes: string | null;
  sourceType: string;
  sourceRef: string | null;
  confidenceScore: number | null;
  embeddingId: string | null;
  datetimeCreated: number;
  datetimeUpdated: number;
};

type ListResponse = {
  activities: Activity[];
  total: number;
  limit: number;
  offset: number;
};

type Kpis = {
  totalActivities: number;
  activitiesEmbedded: number;
  avgConfidence: number;
  flaggedAiInferred: number;
  byTrade: Array<{ trade: string; count: number }>;
};

const TRADES = [
  "demo",
  "framing",
  "plumbing",
  "electrical",
  "hvac",
  "flooring",
  "finish_carpentry",
  "tile",
  "paint",
  "drywall",
  "cabinetry",
  "counters",
  "appliances",
  "exterior",
  "sitework",
  "permits",
] as const;
const PHASES = ["pre_construction", "rough", "finish", "punch"] as const;
const SOURCES = ["manual", "insurance", "rsmeans", "ai_inferred", "bid_observed"] as const;
const UNITS = ["sf", "lf", "ea", "hr", "ls", "day"] as const;

function adjustedTotal(a: Activity): number {
  const base =
    a.baselineLaborCentsPerUnit +
    a.baselineMaterialCentsPerUnit +
    a.baselineEquipmentCentsPerUnit;
  return Math.round(base * (1 + a.marketAdjustmentPct));
}

const SOURCE_ICON: Record<string, typeof Pencil> = {
  manual: Pencil,
  insurance: Scale,
  rsmeans: Database,
  ai_inferred: Sparkles,
  bid_observed: FileText,
};

// ============================================================
// MAIN APP
// ============================================================
export function TruthTableApp() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const [sort, setSort] = useState<
    "scope_key" | "trade" | "display_name" | "datetime_updated"
  >("scope_key");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reembedding, setReembedding] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (tradeFilter.length) params.set("trade", tradeFilter.join(","));
      if (phaseFilter.length) params.set("phase", phaseFilter.join(","));
      if (sourceFilter.length) params.set("source", sourceFilter.join(","));
      params.set("sort", sort);
      params.set("order", order);
      params.set("limit", "200");
      const res = await fetch(`/api/truth-table?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setActivities(data.activities);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activities");
    } finally {
      setLoading(false);
    }
  }, [search, tradeFilter, phaseFilter, sourceFilter, sort, order]);

  const fetchKpis = useCallback(async () => {
    try {
      const res = await fetch("/api/truth-table/kpis");
      if (res.ok) setKpis((await res.json()) as Kpis);
    } catch {
      // KPIs are non-critical
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  const handleReembed = async () => {
    setReembedding(true);
    try {
      const res = await fetch("/api/truth-table/reembed", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        embedded: number;
        skipped: number;
        errors: string[];
      };
      toast.success(
        `Embedded ${data.embedded} activities` +
          (data.errors.length ? ` · ${data.errors.length} errors` : ""),
      );
      fetchKpis();
    } catch (e) {
      toast.error(
        `Re-embed failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setReembedding(false);
    }
  };

  const handleSaveEdit = async (id: string, patch: Partial<Activity>) => {
    try {
      const res = await fetch(`/api/truth-table/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Saved");
      setEditingId(null);
      fetchList();
      fetchKpis();
    } catch (e) {
      toast.error(
        `Save failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  const handleCreate = async (input: Partial<Activity>) => {
    try {
      const res = await fetch("/api/truth-table", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      toast.success("Activity created");
      setAddOpen(false);
      fetchList();
      fetchKpis();
    } catch (e) {
      toast.error(
        `Create failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  const isEmpty = !loading && activities.length === 0 && !error;

  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-screen">
      <div className="mx-auto max-w-[1400px] px-6 pb-20">
        <PageHeader
          eyebrow="Catalog"
          title="Truth Table"
          description="Granular labor, material, and equipment baselines per construction activity. SF Bay market-adjusted."
          actions={
            <>
              <button
                type="button"
                onClick={handleReembed}
                disabled={reembedding}
                className="h-9 px-3.5 text-sm rounded-md bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800 hover:ring-zinc-700 transition-all inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Sparkles size={15} className={reembedding ? "animate-pulse" : ""} />
                <span>{reembedding ? "Re-embedding…" : "Re-embed all"}</span>
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="h-9 px-3.5 text-sm rounded-md bg-zinc-100 text-zinc-950 hover:bg-white transition-all inline-flex items-center gap-2 font-medium"
              >
                <Plus size={15} />
                <span>Add activity</span>
              </button>
            </>
          }
        />

        {/* KPI strip */}
        <KpiStrip kpis={kpis} loading={loading && !kpis} />

        {/* Filter bar */}
        <FilterBar
          search={search}
          setSearch={setSearch}
          tradeFilter={tradeFilter}
          setTradeFilter={setTradeFilter}
          phaseFilter={phaseFilter}
          setPhaseFilter={setPhaseFilter}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          density={density}
          setDensity={setDensity}
        />

        {/* Result count */}
        <div className="flex items-center justify-between text-xs text-zinc-500 pb-3">
          <div>
            <span className="font-mono tabular-nums text-zinc-300">
              <AnimatedNumber value={total} />
            </span>{" "}
            activities
          </div>
        </div>

        {/* Body */}
        {error ? (
          <ErrorBanner
            title="Could not load truth table"
            message={error}
            onRetry={fetchList}
          />
        ) : loading ? (
          <LoadingTable />
        ) : isEmpty ? (
          <EmptyState
            icon={Database}
            title="No activities yet"
            description="Add your first activity to begin building the baseline cost catalog."
            action={
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="h-9 px-3.5 text-sm rounded-md bg-zinc-100 text-zinc-950 hover:bg-white transition-all inline-flex items-center gap-2 font-medium"
              >
                <Plus size={15} />
                <span>Add activity</span>
              </button>
            }
          />
        ) : (
          <ActivityTable
            activities={activities}
            density={density}
            sort={sort}
            order={order}
            onSort={(col) => {
              if (sort === col) setOrder(order === "asc" ? "desc" : "asc");
              else {
                setSort(col);
                setOrder("asc");
              }
            }}
            editingId={editingId}
            setEditingId={setEditingId}
            onSave={handleSaveEdit}
          />
        )}
      </div>

      {addOpen && (
        <AddDialog onClose={() => setAddOpen(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// ============================================================
// KPI STRIP
// ============================================================
function KpiStrip({ kpis, loading }: { kpis: Kpis | null; loading: boolean }) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px]" />
        ))}
      </div>
    );
  }
  const tradeSpark = kpis.byTrade.slice(0, 8).map((t) => t.count);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
      <KPI
        label="Total activities"
        value={<AnimatedNumber value={kpis.totalActivities} />}
        sparkline={<Sparkline data={tradeSpark.length ? tradeSpark : [0]} color="#a1a1aa" />}
        hint={`across ${kpis.byTrade.length} trades`}
      />
      <KPI
        label="Activities embedded"
        value={<AnimatedNumber value={kpis.activitiesEmbedded} />}
        sparkline={
          <Sparkline data={tradeSpark.length ? tradeSpark : [0]} color="#34d399" />
        }
        hint="indexed for AI mapping"
      />
      <KPI
        label="Avg. confidence"
        value={
          <AnimatedNumber
            value={Math.round(kpis.avgConfidence * 100)}
            format={(v) => `${v}%`}
          />
        }
        hint="across all active rows"
      />
      <KPI
        label="AI-inferred"
        value={<AnimatedNumber value={kpis.flaggedAiInferred} />}
        hint="needs human review"
      />
    </div>
  );
}

// ============================================================
// FILTER BAR
// ============================================================
function FilterBar({
  search,
  setSearch,
  tradeFilter,
  setTradeFilter,
  phaseFilter,
  setPhaseFilter,
  sourceFilter,
  setSourceFilter,
  density,
  setDensity,
}: {
  search: string;
  setSearch: (v: string) => void;
  tradeFilter: string[];
  setTradeFilter: (v: string[]) => void;
  phaseFilter: string[];
  setPhaseFilter: (v: string[]) => void;
  sourceFilter: string[];
  setSourceFilter: (v: string[]) => void;
  density: "comfortable" | "compact";
  setDensity: (v: "comfortable" | "compact") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap py-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative inline-flex items-center w-72">
          <Search size={14} className="absolute left-3 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activities…"
            className="h-9 pl-9 pr-3 text-sm bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full transition-all"
          />
        </div>
        <MultiSelect
          label="Trade"
          options={TRADES.map((t) => ({ value: t, label: TRADE_LABEL[t] ?? t }))}
          value={tradeFilter}
          onChange={setTradeFilter}
        />
        <MultiSelect
          label="Phase"
          options={PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] ?? p }))}
          value={phaseFilter}
          onChange={setPhaseFilter}
        />
        <MultiSelect
          label="Source"
          options={SOURCES.map((s) => ({
            value: s,
            label: SOURCE_LABEL[s]?.label ?? s,
          }))}
          value={sourceFilter}
          onChange={setSourceFilter}
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex bg-zinc-900 rounded-md p-0.5 ring-1 ring-zinc-800">
          {[
            { id: "comfortable" as const, icon: MenuIcon, label: "Comfy" },
            { id: "compact" as const, icon: Layers, label: "Compact" },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setDensity(o.id)}
              className={`h-7 px-2.5 text-xs rounded-sm transition-colors ${density === o.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-9 px-3 text-sm bg-zinc-900 text-zinc-200 rounded-md ring-1 ring-zinc-800 hover:ring-zinc-700 inline-flex items-center gap-2"
      >
        <span>{label}</span>
        {value.length > 0 && (
          <span className="font-mono tabular-nums text-[10px] bg-zinc-700 text-zinc-100 rounded-sm px-1">
            {value.length}
          </span>
        )}
        <ChevronDown size={14} className="text-zinc-500" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-56 bg-zinc-900 rounded-md ring-1 ring-zinc-800 py-1 shadow-lg shadow-black/40">
          {options.map((o) => {
            const sel = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                <span
                  className={`size-3.5 rounded-sm ring-1 ring-zinc-700 grid place-items-center ${sel ? "bg-zinc-100" : ""}`}
                >
                  {sel && <Check size={10} className="text-zinc-950" strokeWidth={3} />}
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOADING SKELETON
// ============================================================
function LoadingTable() {
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 overflow-hidden">
      <div className="grid grid-cols-12 gap-3 px-4 py-3 bg-zinc-900/40">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-3 col-span-1" />
        ))}
      </div>
      <div className="divide-y divide-zinc-800/60">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3">
            {Array.from({ length: 12 }).map((_, j) => (
              <Skeleton key={j} className="h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ACTIVITY TABLE
// ============================================================
function ActivityTable({
  activities,
  density,
  sort,
  order,
  onSort,
  editingId,
  setEditingId,
  onSave,
}: {
  activities: Activity[];
  density: "comfortable" | "compact";
  sort: string;
  order: "asc" | "desc";
  onSort: (col: "scope_key" | "trade" | "display_name" | "datetime_updated") => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onSave: (id: string, patch: Partial<Activity>) => Promise<void>;
}) {
  const rowPad = density === "compact" ? "py-2" : "py-3.5";

  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 overflow-hidden">
      <div className="grid grid-cols-[1.6fr_0.8fr_0.5fr_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr_0.7fr_0.7fr] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-900/40">
        <button
          type="button"
          onClick={() => onSort("scope_key")}
          className="text-left hover:text-zinc-300 flex items-center gap-1"
        >
          Activity
          {sort === "scope_key" && (
            <ChevronDown
              size={10}
              className={`text-zinc-600 transition-transform ${order === "desc" ? "" : "rotate-180"}`}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSort("trade")}
          className="text-left hover:text-zinc-300"
        >
          Trade
        </button>
        <div>Unit</div>
        <div className="text-right">Labor /u</div>
        <div className="text-right">Material /u</div>
        <div className="text-right">Equip /u</div>
        <div className="text-right">Adjusted /u</div>
        <div className="text-right">Insurance /u</div>
        <div>Confidence</div>
        <div>Source</div>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {activities.map((a) =>
          editingId === a.id ? (
            <EditRow
              key={a.id}
              activity={a}
              onCancel={() => setEditingId(null)}
              onSave={(patch) => onSave(a.id, patch)}
            />
          ) : (
            <Row
              key={a.id}
              activity={a}
              padding={rowPad}
              onEdit={() => setEditingId(a.id)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function Row({
  activity,
  padding,
  onEdit,
}: {
  activity: Activity;
  padding: string;
  onEdit: () => void;
}) {
  const adjusted = adjustedTotal(activity);
  const ins = activity.insuranceBaselineCentsPerUnit;
  const insDeltaPct = ins ? (adjusted - ins) / ins : null;
  const insWarn = insDeltaPct !== null && insDeltaPct > 0.2;
  const SourceIcon = SOURCE_ICON[activity.sourceType] ?? Pencil;
  const tradeTone = (TRADE_TONE[activity.trade] ?? "zinc") as ChipTone;

  return (
    <div
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEdit();
      }}
      role="button"
      tabIndex={0}
      className={`grid grid-cols-[1.6fr_0.8fr_0.5fr_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr_0.7fr_0.7fr] gap-3 px-5 ${padding} text-sm hover:bg-zinc-900/40 cursor-pointer group`}
    >
      <div className="min-w-0">
        <div className="font-mono text-[12px] text-zinc-500 truncate">
          {activity.scopeKey}
        </div>
        <div className="text-zinc-200 truncate">{activity.displayName}</div>
        {activity.description && (
          <div className="text-[12px] text-zinc-500 truncate mt-0.5">
            {activity.description}
          </div>
        )}
      </div>
      <div>
        <Chip tone={tradeTone}>{TRADE_LABEL[activity.trade] ?? activity.trade}</Chip>
      </div>
      <div className="text-zinc-400 text-[12px] font-mono">
        {activity.unit.toUpperCase()}
      </div>
      <div className="text-right font-mono tabular-nums text-zinc-300">
        {fmtCents(activity.baselineLaborCentsPerUnit, { decimals: 2 })}
      </div>
      <div className="text-right font-mono tabular-nums text-zinc-300">
        {fmtCents(activity.baselineMaterialCentsPerUnit, { decimals: 2 })}
      </div>
      <div className="text-right font-mono tabular-nums text-zinc-300">
        {fmtCents(activity.baselineEquipmentCentsPerUnit, { decimals: 2 })}
      </div>
      <div className="text-right font-mono tabular-nums text-zinc-50 font-medium">
        {fmtCents(adjusted, { decimals: 2 })}
        <div className="text-[10px] text-zinc-500 font-normal">
          {fmtPct(activity.marketAdjustmentPct, { sign: true, decimals: 0 })} mkt
        </div>
      </div>
      <div className="text-right font-mono tabular-nums text-zinc-400">
        {ins ? fmtCents(ins, { decimals: 2 }) : "—"}
        {insDeltaPct !== null && (
          <div className={`text-[10px] ${insWarn ? "text-amber-400" : "text-zinc-500"}`}>
            {fmtPct(insDeltaPct, { sign: true })} vs ins.
          </div>
        )}
      </div>
      <div>
        <ConfidenceBar value={activity.confidenceScore ?? 0} />
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
        <SourceIcon size={12} className="text-zinc-500" />
        <span>{SOURCE_LABEL[activity.sourceType]?.label ?? activity.sourceType}</span>
      </div>
    </div>
  );
}

function EditRow({
  activity,
  onCancel,
  onSave,
}: {
  activity: Activity;
  onCancel: () => void;
  onSave: (patch: Partial<Activity>) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    displayName: activity.displayName,
    description: activity.description ?? "",
    unit: activity.unit,
    baselineLaborCentsPerUnit: activity.baselineLaborCentsPerUnit,
    baselineMaterialCentsPerUnit: activity.baselineMaterialCentsPerUnit,
    baselineEquipmentCentsPerUnit: activity.baselineEquipmentCentsPerUnit,
    marketAdjustmentPct: activity.marketAdjustmentPct,
    insuranceBaselineCentsPerUnit: activity.insuranceBaselineCentsPerUnit,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-[1.6fr_0.8fr_0.5fr_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr_0.7fr_0.7fr] gap-3 px-5 py-3.5 text-sm bg-zinc-900/60 ring-1 ring-emerald-500/20">
      <div className="min-w-0">
        <div className="font-mono text-[12px] text-zinc-500 truncate">
          {activity.scopeKey}
        </div>
        <input
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          className="w-full h-7 px-2 text-sm bg-zinc-900 text-zinc-100 rounded ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none"
        />
        <input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Description"
          className="w-full mt-1 h-6 px-2 text-[12px] bg-zinc-900 text-zinc-400 rounded ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none"
        />
      </div>
      <div>
        <Chip tone={(TRADE_TONE[activity.trade] ?? "zinc") as ChipTone}>
          {TRADE_LABEL[activity.trade] ?? activity.trade}
        </Chip>
      </div>
      <select
        value={draft.unit}
        onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
        className="h-7 text-[12px] bg-zinc-900 text-zinc-100 rounded ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none font-mono"
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u.toUpperCase()}
          </option>
        ))}
      </select>
      <CentsInput
        value={draft.baselineLaborCentsPerUnit}
        onChange={(v) => setDraft({ ...draft, baselineLaborCentsPerUnit: v })}
      />
      <CentsInput
        value={draft.baselineMaterialCentsPerUnit}
        onChange={(v) => setDraft({ ...draft, baselineMaterialCentsPerUnit: v })}
      />
      <CentsInput
        value={draft.baselineEquipmentCentsPerUnit}
        onChange={(v) => setDraft({ ...draft, baselineEquipmentCentsPerUnit: v })}
      />
      <div className="flex flex-col items-end">
        <div className="font-mono tabular-nums text-zinc-50 text-right">
          {fmtCents(
            Math.round(
              (draft.baselineLaborCentsPerUnit +
                draft.baselineMaterialCentsPerUnit +
                draft.baselineEquipmentCentsPerUnit) *
                (1 + draft.marketAdjustmentPct),
            ),
            { decimals: 2 },
          )}
        </div>
        <PctInput
          value={draft.marketAdjustmentPct}
          onChange={(v) => setDraft({ ...draft, marketAdjustmentPct: v })}
        />
      </div>
      <CentsInput
        value={draft.insuranceBaselineCentsPerUnit ?? 0}
        onChange={(v) =>
          setDraft({ ...draft, insuranceBaselineCentsPerUnit: v || null })
        }
        nullable
      />
      <div className="col-span-2 flex items-end justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 px-2.5 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 inline-flex items-center gap-1.5"
        >
          <X size={12} />
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="h-7 px-2.5 text-xs rounded-md bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-400/15 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Save size={12} />
          {saving ? "Saving…" : "Save revision"}
        </button>
      </div>
    </div>
  );
}

function CentsInput({
  value,
  onChange,
  nullable = false,
}: {
  value: number;
  onChange: (v: number) => void;
  nullable?: boolean;
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : "");
  useEffect(() => {
    setText(value ? (value / 100).toFixed(2) : "");
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === "" && nullable) {
          onChange(0);
          return;
        }
        const v = Number.parseFloat(text.replace(/[$,\s]/g, "")) || 0;
        onChange(Math.round(v * 100));
      }}
      placeholder={nullable ? "—" : "0.00"}
      className="h-7 px-2 text-right text-[12px] bg-zinc-900 text-zinc-100 rounded ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none font-mono tabular-nums w-full"
    />
  );
}

function PctInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState((value * 100).toFixed(0));
  useEffect(() => {
    setText((value * 100).toFixed(0));
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = Number.parseFloat(text) || 0;
        onChange(v / 100);
      }}
      className="mt-1 h-5 px-1 text-right text-[10px] bg-zinc-900 text-zinc-500 rounded ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none font-mono tabular-nums w-16"
    />
  );
}

// ============================================================
// ADD DIALOG
// ============================================================
function AddDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: Partial<Activity>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    scopeKey: "",
    displayName: "",
    description: "",
    trade: "demo",
    phase: "rough",
    unit: "sf",
    baselineLaborCentsPerUnit: 0,
    baselineMaterialCentsPerUnit: 0,
    baselineEquipmentCentsPerUnit: 0,
    marketAdjustmentPct: 0.2,
    insuranceBaselineCentsPerUnit: null as number | null,
    sourceType: "manual",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    await onCreate(form);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/85 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-zinc-900 ring-1 ring-zinc-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              New
            </div>
            <h2 className="text-lg font-semibold text-zinc-50 mt-1">
              Add activity
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pb-6 grid grid-cols-2 gap-4">
          <Field label="Scope key" hint="lowercase.dotted.scope_keys">
            <input
              value={form.scopeKey}
              onChange={(e) => setForm({ ...form, scopeKey: e.target.value })}
              placeholder="demo.interior_walls"
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none font-mono w-full"
            />
          </Field>
          <Field label="Display name">
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Selective demo — interior walls"
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full"
            />
          </Field>
          <Field label="Trade">
            <select
              value={form.trade}
              onChange={(e) => setForm({ ...form, trade: e.target.value })}
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full"
            >
              {TRADES.map((t) => (
                <option key={t} value={t}>
                  {TRADE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phase">
            <select
              value={form.phase}
              onChange={(e) => setForm({ ...form, phase: e.target.value })}
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full"
            >
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <select
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full font-mono"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u.toUpperCase()} {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select
              value={form.sourceType}
              onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]?.label ?? s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Labor $ /unit">
            <DollarInput
              value={form.baselineLaborCentsPerUnit}
              onChange={(v) => setForm({ ...form, baselineLaborCentsPerUnit: v })}
            />
          </Field>
          <Field label="Material $ /unit">
            <DollarInput
              value={form.baselineMaterialCentsPerUnit}
              onChange={(v) => setForm({ ...form, baselineMaterialCentsPerUnit: v })}
            />
          </Field>
          <Field label="Equipment $ /unit">
            <DollarInput
              value={form.baselineEquipmentCentsPerUnit}
              onChange={(v) => setForm({ ...form, baselineEquipmentCentsPerUnit: v })}
            />
          </Field>
          <Field label="Market adjustment (%)">
            <input
              type="number"
              step="1"
              value={Math.round(form.marketAdjustmentPct * 100)}
              onChange={(e) =>
                setForm({
                  ...form,
                  marketAdjustmentPct: (Number(e.target.value) || 0) / 100,
                })
              }
              className="h-9 px-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full font-mono tabular-nums"
            />
          </Field>
          <Field label="Insurance baseline $ /unit (optional)" className="col-span-2">
            <DollarInput
              value={form.insuranceBaselineCentsPerUnit ?? 0}
              onChange={(v) =>
                setForm({ ...form, insuranceBaselineCentsPerUnit: v || null })
              }
            />
          </Field>
          <Field label="Description" className="col-span-2">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short scope description"
              rows={2}
              className="px-3 py-2 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full resize-none"
            />
          </Field>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2 bg-zinc-900/40">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3.5 text-sm rounded-md text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !form.scopeKey || !form.displayName}
            className="h-9 px-3.5 text-sm rounded-md bg-zinc-100 text-zinc-950 hover:bg-white transition-all inline-flex items-center gap-2 font-medium disabled:opacity-50"
          >
            <Plus size={15} />
            {saving ? "Creating…" : "Create activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
        {label}
      </div>
      {children}
      {hint && <div className="text-[11px] text-zinc-600 mt-1">{hint}</div>}
    </label>
  );
}

function DollarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : "");
  useEffect(() => {
    setText(value ? (value / 100).toFixed(2) : "");
  }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm font-mono">
        $
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number.parseFloat(text.replace(/[$,\s]/g, "")) || 0;
          onChange(Math.round(v * 100));
          setText(v ? v.toFixed(2) : "");
        }}
        placeholder="0.00"
        className="h-9 pl-7 pr-3 text-sm bg-zinc-900 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full font-mono tabular-nums"
      />
    </div>
  );
}
