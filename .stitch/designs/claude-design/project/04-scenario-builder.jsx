// Surface 4: Scenario Builder — drag-and-drop puzzle interface.
const { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip: RTooltip, Cell, PieChart, Pie, RadialBarChart, RadialBar } = window.Recharts || {};

const TOGGLES = [
  // STRUCTURAL
  { id:"t01", toggleKey:"kitchen_path", label:"Kitchen layout strategy", description:"Where the new kitchen lands. Slab cut downstairs unlocks open plan; in-kind upstairs avoids structural.", category:"structural", kind:"exclusive", optionGroup:"kitchen_path", options:[
    { optionKey:"downstairs_slab_cut", label:"Downstairs · slab cut", estimatedCostCents:6240000 },
    { optionKey:"upstairs_in_kind", label:"Upstairs · in-kind", estimatedCostCents:1820000 },
    { optionKey:"split_galley", label:"Split galley", estimatedCostCents:3450000 },
  ]},
  { id:"t02", toggleKey:"hall_bath_to_laundry", label:"Convert hall bath to laundry", description:"Repurpose underused hall bath as stacked laundry + linen.", category:"structural", kind:"binary", estimatedCostCents:1480000 },
  { id:"t03", toggleKey:"primary_addition", label:"Primary suite rear addition", description:"~180 sf bump-out, requires permit + structural eng.", category:"structural", kind:"binary", estimatedCostCents:18500000 },
  { id:"t04", toggleKey:"skip_primary_bath", label:"Skip primary bath gut", description:"Keep existing finishes, refresh only.", category:"structural", kind:"binary", estimatedCostCents:-3200000 },

  // FINISH
  { id:"t05", toggleKey:"flooring_main", label:"Main level flooring", description:"Sets the visual language for the first floor.", category:"finish", kind:"exclusive", optionGroup:"flooring_main", options:[
    { optionKey:"hardwood_site", label:"Hardwood, site finished", estimatedCostCents:4200000 },
    { optionKey:"engineered_wood", label:"Engineered wood", estimatedCostCents:2800000 },
    { optionKey:"luxury_vinyl", label:"Luxury vinyl plank", estimatedCostCents:1400000 },
  ]},
  { id:"t06", toggleKey:"custom_millwork", label:"Custom cabinetry millwork", description:"Local mill vs IKEA + Reform front.", category:"finish", kind:"binary", estimatedCostCents:3800000 },
  { id:"t07", toggleKey:"plaster_walls", label:"Lime plaster — main living", description:"Replaces standard L5 drywall on living + dining walls.", category:"finish", kind:"binary", estimatedCostCents:1620000 },
  { id:"t08", toggleKey:"countertop_tier", label:"Counter tier", description:"Material class across kitchen + baths.", category:"finish", kind:"exclusive", optionGroup:"countertop_tier", options:[
    { optionKey:"premium_stone", label:"Premium natural stone", estimatedCostCents:2400000 },
    { optionKey:"mid_quartz", label:"Mid-range quartz", estimatedCostCents:980000 },
    { optionKey:"butcher_block", label:"Butcher block + epoxy", estimatedCostCents:480000 },
  ]},

  // SYSTEMS
  { id:"t09", toggleKey:"hvac_strategy", label:"HVAC system", description:"Affects ceiling height + permits.", category:"systems", kind:"exclusive", optionGroup:"hvac_strategy", options:[
    { optionKey:"ducted_high_velocity", label:"Ducted high-velocity", estimatedCostCents:4800000 },
    { optionKey:"mini_split", label:"Mini-split multi-head", estimatedCostCents:3950000 },
    { optionKey:"hybrid", label:"Hybrid hydronic + ducted", estimatedCostCents:6200000 },
  ]},
  { id:"t10", toggleKey:"electrical_panel", label:"200A panel upgrade", description:"Required for induction range + EV charger.", category:"systems", kind:"binary", estimatedCostCents:480000 },
  { id:"t11", toggleKey:"radiant_floors", label:"Radiant floor — primary bath", description:"Electric mat under tile, primary bath only.", category:"systems", kind:"binary", estimatedCostCents:340000 },
  { id:"t12", toggleKey:"solar_ready", label:"Solar-ready conduit + breakers", description:"Don't install panels but prep for them.", category:"systems", kind:"binary", estimatedCostCents:280000 },

  // LAYOUT
  { id:"t13", toggleKey:"office_above_garage", label:"Office above garage", description:"Convert attic over garage to remote office.", category:"layout", kind:"binary", estimatedCostCents:5800000 },
  { id:"t14", toggleKey:"open_dining_kitchen", label:"Open dining ↔ kitchen", description:"Remove non-bearing wall + island.", category:"layout", kind:"binary", estimatedCostCents:1280000 },
  { id:"t15", toggleKey:"close_formal_living", label:"Close formal living as study", description:"Reduce open plan for sound separation.", category:"layout", kind:"binary", estimatedCostCents:-820000 },
];

const CATEGORY_META = {
  structural: { label: "Structural", tone: "amber", color: "#fbbf24" },
  finish:     { label: "Finish",     tone: "emerald", color: "#34d399" },
  systems:    { label: "Systems",    tone: "sky", color: "#38bdf8" },
  layout:     { label: "Layout",     tone: "violet", color: "#a78bfa" },
};

const ZONE_META = {
  must_now: { label: "Must — now", tone: "emerald", color: "#34d399", description: "Committed for this construction window." },
  optional: { label: "Optional",   tone: "amber", color: "#fbbf24", description: "Decision pending — being modeled." },
  parked:   { label: "Parked",     tone: "zinc", color: "#71717a", description: "Set aside for a later phase or rejected." },
};

const FUNDING_AVAILABLE_CENTS = 43600000;

// ---------- Initial placements ----------
const INITIAL_PLACEMENTS = [
  { id:"t01", zone:"must_now", chosenOption:"downstairs_slab_cut" }, // $62,400
  { id:"t02", zone:"must_now" },                                      // $14,800
  { id:"t05", zone:"must_now", chosenOption:"engineered_wood" },     // $28,000
  { id:"t08", zone:"must_now", chosenOption:"mid_quartz" },          // $9,800
  { id:"t09", zone:"must_now", chosenOption:"ducted_high_velocity"}, // $48,000
  { id:"t10", zone:"must_now" },                                      // $4,800
  { id:"t06", zone:"optional" },                                      // $38,000
  { id:"t14", zone:"optional" },                                      // $12,800
  { id:"t07", zone:"optional" },                                      // $16,200
  { id:"t11", zone:"optional" },                                      // $3,400
  { id:"t12", zone:"optional" },                                      // $2,800
  { id:"t13", zone:"parked" },                                        // $58,000
  { id:"t03", zone:"parked" },                                        // $185,000
];

// ---------- Compute budget ----------
function computeBudget(placements) {
  let total = 0;
  let byTrade = { "Demo": 0, "Framing": 0, "Plumbing": 0, "Electrical": 0, "HVAC": 0, "Flooring": 0, "Finish": 0, "Tile": 0, "Paint": 0 };
  let byCategory = { structural: 0, finish: 0, systems: 0, layout: 0 };
  let byZone = { must_now: 0, optional: 0, parked: 0 };

  // simple trade allocation heuristic per category
  const tradeAllocByCategory = {
    structural: { Demo: 0.15, Framing: 0.45, Plumbing: 0.10, Electrical: 0.10, HVAC: 0.05, Finish: 0.15 },
    finish:     { Finish: 0.45, Flooring: 0.20, Paint: 0.15, Tile: 0.10, Framing: 0.10 },
    systems:    { HVAC: 0.40, Electrical: 0.35, Plumbing: 0.20, Framing: 0.05 },
    layout:     { Demo: 0.20, Framing: 0.35, Electrical: 0.15, Plumbing: 0.10, Finish: 0.15, Paint: 0.05 },
  };

  for (const p of placements) {
    const t = TOGGLES.find(x => x.id === p.id);
    if (!t) continue;
    let cost = 0;
    if (t.kind === "binary") cost = t.estimatedCostCents;
    else if (t.kind === "exclusive" && p.chosenOption) {
      const o = t.options.find(o => o.optionKey === p.chosenOption);
      cost = o ? o.estimatedCostCents : 0;
    }
    if (p.zone === "parked") continue; // parked doesn't count
    byZone[p.zone] += cost;
    if (p.zone === "must_now") {
      total += cost;
      byCategory[t.category] += cost;
      const alloc = tradeAllocByCategory[t.category] || {};
      for (const [trade, pct] of Object.entries(alloc)) {
        byTrade[trade] += cost * pct;
      }
    }
  }

  const totalLowCents = Math.round(total * 0.92);
  const totalHighCents = Math.round(total * 1.14);

  const warnings = [];
  if (total > FUNDING_AVAILABLE_CENTS) {
    warnings.push({ code: "exceeds_funding", message: `Expected total exceeds funding by ${fmtCents(total - FUNDING_AVAILABLE_CENTS)}.` });
  }
  // Check for missing required: if "kitchen_path" not chosen
  if (!placements.find(p => p.id === "t01" && p.zone === "must_now")) {
    warnings.push({ code: "missing_required", message: "No kitchen path locked — required before permitting." });
  }

  return {
    totalExpectedCents: total,
    totalLowCents, totalHighCents,
    fundingAvailableCents: FUNDING_AVAILABLE_CENTS,
    byTrade: Object.entries(byTrade).map(([trade, cents]) => ({ trade, cents: Math.round(cents) })).filter(x => x.cents > 0),
    byCategory: Object.entries(byCategory).map(([category, cents]) => ({ category, cents })),
    byZone,
    warnings,
  };
}

// ---------- Toggle piece (left rail chip) ----------
function TogglePiece({ t, placed, dragging, onDragStart }) {
  const cat = CATEGORY_META[t.category];
  const cost = t.kind === "binary" ? t.estimatedCostCents : t.options[0].estimatedCostCents;
  const negative = cost < 0;
  return (
    <div draggable={!placed} onDragStart={(e) => onDragStart && onDragStart(t.id, e)}
      className={`rounded-lg p-3 transition-all cursor-grab active:cursor-grabbing ${
        placed
          ? "bg-zinc-900/30 ring-1 ring-zinc-800/40 opacity-50 cursor-not-allowed"
          : "bg-zinc-900 ring-1 ring-zinc-800/80 hover:ring-zinc-700"
      } ${dragging ? "ring-emerald-400/70 ring-2" : ""}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-1.5 size-1.5 rounded-full shrink-0" style={{ background: cat.color }}></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-zinc-100 font-medium leading-snug">{t.label}</div>
            <span className={`text-xs font-mono tabular-nums shrink-0 ${negative ? "text-emerald-300" : "text-zinc-400"}`}>
              {negative ? "−" : ""}{fmtCents(Math.abs(cost))}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-snug">{t.description}</div>
          <div className="mt-2 flex items-center gap-2">
            {t.kind === "exclusive" && (
              <span className="text-[10px] text-zinc-500 bg-zinc-800/80 rounded-sm px-1.5 py-0.5 font-mono">{t.options.length} options</span>
            )}
            {placed && <span className="text-[10px] text-emerald-300 uppercase tracking-wider font-mono">Placed</span>}
            {!placed && <Icon name="grip" size={11} className="text-zinc-600 ml-auto"/>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Left rail: toggle panel ----------
function TogglePanel({ placements, onDragStart, dragging }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState({ structural: true, finish: true, systems: true, layout: false });
  const placedIds = new Set(placements.map(p => p.id));

  const byCategory = useMemo(() => {
    const out = { structural: [], finish: [], systems: [], layout: [] };
    for (const t of TOGGLES) {
      if (search && !`${t.label} ${t.description}`.toLowerCase().includes(search.toLowerCase())) continue;
      out[t.category].push(t);
    }
    return out;
  }, [search]);

  return (
    <aside className="w-[320px] shrink-0 rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 p-4 self-start sticky top-20 max-h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Puzzle pieces</SectionTitle>
        <span className="text-[10px] font-mono text-zinc-500">{TOGGLES.length - placedIds.size} left</span>
      </div>
      <Input icon="search" placeholder="Search toggles…" value={search} onChange={e => setSearch(e.target.value)}/>
      <div className="mt-3 flex-1 overflow-y-auto -mx-1 px-1 space-y-3 min-h-0">
        {Object.entries(byCategory).map(([cat, items]) => {
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat}>
              <button onClick={() => setOpen(o => ({...o, [cat]: !o[cat]}))}
                className="w-full flex items-center justify-between text-left py-1.5">
                <div className="flex items-center gap-2">
                  <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-300">{meta.label}</span>
                  <span className="text-[10px] font-mono text-zinc-600">{items.length}</span>
                </div>
                <Icon name={open[cat] ? "chevron-down" : "chevron-right"} size={12} className="text-zinc-600"/>
              </button>
              {open[cat] && (
                <div className="space-y-1.5 mt-1">
                  {items.map(t => (
                    <TogglePiece key={t.id} t={t}
                      placed={placedIds.has(t.id)}
                      dragging={dragging === t.id}
                      onDragStart={onDragStart}/>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---------- Drop zone ----------
function DropZone({ zone, placements, dragOverZone, dragOverEnter, dragOverLeave, onDrop, onCycleOption, dragging }) {
  const meta = ZONE_META[zone];
  const items = placements.filter(p => p.zone === zone);
  const subtotal = items.reduce((s, p) => {
    const t = TOGGLES.find(x => x.id === p.id); if (!t) return s;
    if (t.kind === "binary") return s + t.estimatedCostCents;
    if (p.chosenOption) {
      const o = t.options.find(o => o.optionKey === p.chosenOption);
      return s + (o ? o.estimatedCostCents : 0);
    }
    return s;
  }, 0);

  const isActive = dragOverZone === zone;
  const empty = items.length === 0;

  return (
    <div
      onDragOver={(e)=>{ e.preventDefault(); dragOverEnter(zone); }}
      onDragLeave={(e)=>{ if (!e.currentTarget.contains(e.relatedTarget)) dragOverLeave(zone); }}
      onDrop={(e)=>{ e.preventDefault(); onDrop(zone, e); }}
      className={`rounded-xl transition-all duration-200 p-4 ${
        empty
          ? `ring-2 ring-dashed bg-zinc-900/20 ${isActive ? "ring-emerald-400/70 bg-emerald-950/20" : "ring-zinc-800"}`
          : `bg-zinc-900/40 ring-1 ${isActive ? "ring-emerald-400/70" : "ring-zinc-800/60"}`
      }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: meta.color }}>{meta.label}</span>
          <span className="text-[10px] font-mono text-zinc-500">{items.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">subtotal</span>
          <span className="text-sm font-mono tabular-nums text-zinc-100">{fmtCents(subtotal)}</span>
        </div>
      </div>
      {empty ? (
        <div className="py-10 text-center">
          <Icon name="layers" size={28} className="text-zinc-700 mx-auto mb-2"/>
          <div className="text-xs text-zinc-500">{isActive ? "Drop to add to this zone" : meta.description}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {items.map(p => {
            const t = TOGGLES.find(x => x.id === p.id);
            return <PlacedChip key={p.id} t={t} placement={p} onCycleOption={onCycleOption}/>;
          })}
        </div>
      )}
    </div>
  );
}

function PlacedChip({ t, placement, onCycleOption }) {
  const cat = CATEGORY_META[t.category];
  const cost = t.kind === "binary"
    ? t.estimatedCostCents
    : (t.options.find(o => o.optionKey === placement.chosenOption)?.estimatedCostCents || 0);
  const negative = cost < 0;

  return (
    <div className="rounded-lg bg-zinc-900 ring-1 ring-zinc-800 p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-1.5 rounded-full shrink-0" style={{ background: cat.color }}></div>
          <span className="text-sm font-medium text-zinc-100 truncate">{t.label}</span>
        </div>
        <button className="size-5 grid place-items-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 shrink-0">
          <Icon name="x" size={10}/>
        </button>
      </div>
      {t.kind === "exclusive" && (
        <div className="flex flex-wrap gap-1 mb-2">
          {t.options.map(o => (
            <button key={o.optionKey}
              onClick={() => onCycleOption(t.id, o.optionKey)}
              className={`text-[10px] px-2 py-0.5 rounded-sm transition-colors ${
                placement.chosenOption === o.optionKey
                  ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}>
              {o.label} <span className="font-mono tabular-nums ml-1 opacity-70">{fmtCents(o.estimatedCostCents)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 truncate">{t.toggleKey}</span>
        <span className={`text-sm font-mono tabular-nums ${negative ? "text-emerald-300" : "text-zinc-100"}`}>
          {negative ? "−" : ""}{fmtCents(Math.abs(cost))}
        </span>
      </div>
    </div>
  );
}

// ---------- Scenario canvas (center) ----------
function ScenarioCanvas({ placements, dragOverZone, dragOverEnter, dragOverLeave, onDrop, onCycleOption, dragging }) {
  return (
    <main className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-zinc-50 truncate">Kitchen Downstairs, Family Up</h2>
            <Chip tone="emerald" icon="check">Active</Chip>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 font-mono">Snapshot saved 11 minutes ago · v3</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" icon="copy" size="sm">Duplicate</Button>
          <Button variant="ghost" icon="trending-up" size="sm">Compare versions</Button>
          <Button variant="primary" icon="save" size="sm">Save snapshot</Button>
        </div>
      </div>
      <div className="space-y-3">
        {["must_now", "optional", "parked"].map(z => (
          <DropZone key={z} zone={z} placements={placements}
            dragOverZone={dragOverZone} dragOverEnter={dragOverEnter} dragOverLeave={dragOverLeave}
            onDrop={onDrop} onCycleOption={onCycleOption} dragging={dragging}/>
        ))}
      </div>
    </main>
  );
}

// ---------- Budget gauge ----------
function BudgetGauge({ budget }) {
  const pct = Math.min(150, (budget.totalExpectedCents / budget.fundingAvailableCents) * 100);
  const over = budget.totalExpectedCents > budget.fundingAvailableCents;
  const data = [{ name: "used", value: pct, fill: over ? "#fb7185" : "#34d399" }];

  return (
    <div className="relative">
      <div className="h-44 -mx-1 relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="68%" outerRadius="92%" data={data} startAngle={210} endAngle={-30}>
            <RadialBar background={{ fill: "#27272a" }} dataKey="value" cornerRadius={4}/>
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Expected</div>
          <div className="text-3xl font-mono tabular-nums text-zinc-50 font-medium mt-1">
            <AnimatedNumber value={budget.totalExpectedCents} format={(v)=>fmtCents(v)}/>
          </div>
          <div className={`text-[11px] font-mono mt-1 ${over ? "text-rose-300" : "text-emerald-300"}`}>
            {fmtCents(budget.totalExpectedCents - budget.fundingAvailableCents, { sign: true })} vs funding
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Low</div>
          <div className="text-xs font-mono tabular-nums text-zinc-300">{fmtCents(budget.totalLowCents)}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Expected</div>
          <div className="text-xs font-mono tabular-nums text-zinc-100 font-medium">{fmtCents(budget.totalExpectedCents)}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">High</div>
          <div className="text-xs font-mono tabular-nums text-zinc-300">{fmtCents(budget.totalHighCents)}</div>
        </div>
      </div>
      <div className="mt-2 relative h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="absolute inset-y-0 bg-zinc-600" style={{ left: "8%", right: "14%" }}></div>
        <div className="absolute inset-y-0 w-1 bg-zinc-100" style={{ left: "calc(50% - 2px)" }}></div>
      </div>
    </div>
  );
}

// ---------- Right rail: budget sidebar ----------
function BudgetSidebar({ budget }) {
  return (
    <aside className="w-[380px] shrink-0 self-start sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 p-5 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle>Live budget</SectionTitle>
          <Chip tone="sky">{fmtCents(budget.fundingAvailableCents)} funded</Chip>
        </div>
        <BudgetGauge budget={budget}/>
      </div>

      {budget.byTrade.length > 0 && (
        <div>
          <SectionTitle>By trade</SectionTitle>
          <div className="mt-3 space-y-1.5">
            {budget.byTrade.sort((a,b)=>b.cents-a.cents).map(t => {
              const max = Math.max(...budget.byTrade.map(x => x.cents));
              return (
                <div key={t.trade} className="flex items-center gap-3">
                  <div className="w-20 text-[11px] text-zinc-400 shrink-0">{t.trade}</div>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-zinc-100" style={{ width: `${(t.cents/max)*100}%` }}></div>
                  </div>
                  <div className="w-16 text-right text-[11px] font-mono tabular-nums text-zinc-300">{fmtCents(t.cents)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>By category</SectionTitle>
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={budget.byCategory.filter(c=>c.cents>0)} dataKey="cents" nameKey="category"
                innerRadius={32} outerRadius={56} paddingAngle={2}>
                {budget.byCategory.map((c, i) => <Cell key={i} fill={CATEGORY_META[c.category]?.color || "#71717a"}/>)}
              </Pie>
              <RTooltip
                contentStyle={{ background: "#18181b", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}
                labelStyle={{ color: "#fafafa" }} itemStyle={{ color: "#a1a1aa" }}
                formatter={(v) => fmtCents(v)}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          {budget.byCategory.map(c => (
            <div key={c.category} className="flex items-center gap-2">
              <div className="size-2 rounded-sm" style={{ background: CATEGORY_META[c.category].color }}></div>
              <span className="text-zinc-400">{CATEGORY_META[c.category].label}</span>
              <span className="ml-auto font-mono tabular-nums text-zinc-500">{fmtCents(c.cents)}</span>
            </div>
          ))}
        </div>
      </div>

      {budget.warnings.length > 0 && (
        <div>
          <SectionTitle>Warnings</SectionTitle>
          <div className="mt-3 space-y-2">
            {budget.warnings.map((w, i) => (
              <div key={i} className={`flex items-start gap-2 p-2.5 rounded-md text-[12px] leading-relaxed ${
                w.code === "exceeds_funding"
                  ? "bg-rose-950/30 text-rose-200 ring-1 ring-rose-500/20"
                  : "bg-amber-950/30 text-amber-200 ring-1 ring-amber-500/20"
              }`}>
                <Icon name="alert-circle" size={13} className="mt-0.5 shrink-0"/>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------- Drag overlay ----------
function DragOverlay({ x, y, toggleId }) {
  const t = TOGGLES.find(x => x.id === toggleId);
  if (!t) return null;
  const cat = CATEGORY_META[t.category];
  const cost = t.kind === "binary" ? t.estimatedCostCents : t.options[0].estimatedCostCents;
  return (
    <div className="pointer-events-none fixed z-50 w-72" style={{ left: x - 140, top: y - 30, transform: "rotate(1deg)" }}>
      <div className="rounded-lg bg-zinc-900 ring-2 ring-emerald-400/70 p-3 shadow-xl shadow-emerald-400/10">
        <div className="flex items-center gap-2 mb-1">
          <div className="size-1.5 rounded-full" style={{ background: cat.color }}></div>
          <span className="text-sm font-medium text-zinc-100">{t.label}</span>
          <span className="ml-auto text-xs font-mono tabular-nums text-zinc-400">{fmtCents(Math.abs(cost))}</span>
        </div>
        <div className="text-[11px] text-zinc-500">{t.description}</div>
      </div>
    </div>
  );
}

// ---------- Mobile ----------
function ScenarioMobile({ budget, placements }) {
  const [tab, setTab] = useState("budget");
  const over = budget.totalExpectedCents > budget.fundingAvailableCents;
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Scenario</div>
        <h1 className="text-base font-semibold text-zinc-50">Kitchen Downstairs, Family Up</h1>
      </div>
      <div className="px-3 flex items-center gap-1 bg-zinc-900/60 mx-3 rounded-md p-1">
        {[{id:"pieces",label:"Pieces"},{id:"canvas",label:"Canvas"},{id:"budget",label:"Budget"}].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex-1 h-7 text-xs rounded-sm ${tab===t.id ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"}`}>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "pieces" && (
          <div className="space-y-2">
            {TOGGLES.slice(0,6).map(t => <TogglePiece key={t.id} t={t} placed={false}/>)}
          </div>
        )}
        {tab === "canvas" && (
          <div className="space-y-3">
            {["must_now","optional"].map(z => {
              const items = placements.filter(p => p.zone === z);
              const meta = ZONE_META[z];
              return (
                <div key={z} className="rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider" style={{color: meta.color}}>{meta.label}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{items.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {items.slice(0,3).map(p => {
                      const t = TOGGLES.find(x => x.id === p.id);
                      return <div key={p.id} className="text-xs text-zinc-200 bg-zinc-900 rounded-sm p-2">{t.label}</div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tab === "budget" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 p-4">
              <div className="text-[10px] uppercase text-zinc-500">Expected</div>
              <div className="text-2xl font-mono tabular-nums text-zinc-50 mt-1">{fmtCents(budget.totalExpectedCents)}</div>
              <div className={`text-xs font-mono mt-1 ${over ? "text-rose-300" : "text-emerald-300"}`}>
                {fmtCents(budget.totalExpectedCents - budget.fundingAvailableCents, { sign: true })} vs funding
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className={over ? "h-full bg-rose-400" : "h-full bg-emerald-400"} style={{ width: `${Math.min(100, (budget.totalExpectedCents/budget.fundingAvailableCents)*100)}%` }}></div>
              </div>
            </div>
            <div className="space-y-1.5">
              {budget.byTrade.sort((a,b)=>b.cents-a.cents).slice(0,5).map(t => {
                const max = Math.max(...budget.byTrade.map(x=>x.cents));
                return (
                  <div key={t.trade} className="flex items-center gap-2">
                    <div className="w-16 text-[10px] text-zinc-400">{t.trade}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-zinc-100" style={{ width: `${(t.cents/max)*100}%` }}></div>
                    </div>
                    <div className="w-12 text-right text-[10px] font-mono text-zinc-300">{fmtCents(t.cents)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className={`px-3 py-2.5 ${over ? "bg-rose-950/40" : "bg-emerald-950/30"} flex items-center justify-between`}>
        <div className="text-sm font-mono tabular-nums text-zinc-100">{fmtCents(budget.totalExpectedCents)}</div>
        <div className={`text-xs font-mono ${over ? "text-rose-200" : "text-emerald-200"}`}>
          {fmtCents(budget.totalExpectedCents - budget.fundingAvailableCents, { sign: true })} vs funded
        </div>
        <button className="text-[11px] text-zinc-300">Expand ↑</button>
      </div>
    </div>
  );
}

// ---------- Loading state ----------
function LoadingState() {
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "320px 1fr 380px" }}>
      <div className="space-y-3">
        <Skeleton className="h-9"/>
        {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-lg"/>)}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-72"/>
        {[0,1,2].map(i => <Skeleton key={i} className="h-44 rounded-xl"/>)}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-44 rounded-xl"/>
        <Skeleton className="h-32 rounded-xl"/>
        <Skeleton className="h-40 rounded-xl"/>
      </div>
    </div>
  );
}

// ---------- Page ----------
function ScenarioBuilderPage() {
  const [placements, setPlacements] = useState(INITIAL_PLACEMENTS);
  const [dragging, setDragging] = useState(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [dragOverZone, setDragOverZone] = useState(null);

  const budget = useMemo(() => computeBudget(placements), [placements]);

  const onDragStart = (id, e) => {
    setDragging(id);
    if (e && e.dataTransfer) e.dataTransfer.setData("toggleId", id);
    setDragPos({ x: e.clientX, y: e.clientY });
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => setDragPos({ x: e.clientX, y: e.clientY });
    const onUp = () => setDragging(null);
    window.addEventListener("dragover", onMove);
    window.addEventListener("dragend", onUp);
    return () => { window.removeEventListener("dragover", onMove); window.removeEventListener("dragend", onUp); };
  }, [dragging]);

  const onDrop = (zone, e) => {
    const id = (e && e.dataTransfer && e.dataTransfer.getData("toggleId")) || dragging;
    if (!id) return;
    const t = TOGGLES.find(x => x.id === id); if (!t) return;
    setPlacements(prev => {
      const next = prev.filter(p => p.id !== id);
      const placement = { id, zone };
      if (t.kind === "exclusive") {
        const existing = prev.find(p => p.id === id);
        placement.chosenOption = existing?.chosenOption || t.options[0].optionKey;
      }
      next.push(placement);
      return next;
    });
    setDragging(null);
    setDragOverZone(null);
  };

  const onCycleOption = (id, optionKey) => {
    setPlacements(prev => prev.map(p => p.id === id ? { ...p, chosenOption: optionKey } : p));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <Navbar active="scenarios" surface="Scenarios"/>
      <div className="mx-auto max-w-[1600px] px-6 pb-24">
        <PageHeader
          eyebrow="Scenarios"
          title="Scenario builder"
          description="Drag puzzle pieces onto the canvas. The budget recomputes live. Snapshot whenever you want to compare against another version."
          serif
          actions={
            <>
              <Button variant="ghost" icon="copy" size="md">All scenarios (4)</Button>
              <Button variant="secondary" icon="share" size="md">Share with GC</Button>
              <Button variant="primary" icon="send" size="md">Solicit bids</Button>
            </>
          }
        />

        {/* DATA */}
        <StateLabel state="DATA" hint={`13 of ${TOGGLES.length} toggles placed · "primary addition" mid-drag onto OPTIONAL`}/>
        <div className="flex gap-6 items-start">
          <TogglePanel placements={placements} onDragStart={onDragStart} dragging={dragging}/>
          <ScenarioCanvas
            placements={placements}
            dragOverZone={dragOverZone}
            dragOverEnter={(z) => setDragOverZone(z)}
            dragOverLeave={(z) => setDragOverZone(prev => prev === z ? null : prev)}
            onDrop={onDrop}
            onCycleOption={onCycleOption}
            dragging={dragging}/>
          <BudgetSidebar budget={budget}/>
        </div>
        {/* Static demo drag overlay for the screenshot — shows what mid-drag looks like */}
        <div className="mt-6">
          <Card>
            <SectionTitle>Mid-drag preview</SectionTitle>
            <p className="mt-1.5 text-xs text-zinc-500">For the static screenshot — the drag overlay below is what appears while dragging a piece across the canvas. In the live page, real DnD is wired up.</p>
            <div className="relative h-32 mt-4 bg-zinc-950/60 rounded-lg ring-1 ring-zinc-800/40 overflow-hidden">
              <div className="absolute" style={{ left: 80, top: 24, transform: "rotate(1.5deg)" }}>
                <div className="rounded-lg bg-zinc-900 ring-2 ring-emerald-400/70 p-3 w-72 shadow-2xl shadow-emerald-400/10">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="size-1.5 rounded-full" style={{ background: "#fbbf24" }}></div>
                    <span className="text-sm font-medium text-zinc-100">Primary suite rear addition</span>
                    <span className="ml-auto text-xs font-mono tabular-nums text-zinc-400">$185,000</span>
                  </div>
                  <div className="text-[11px] text-zinc-500">~180 sf bump-out, requires permit + structural eng.</div>
                </div>
              </div>
              <div className="absolute right-8 bottom-6 text-[10px] uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <div className="size-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                Optional · ready to drop
              </div>
            </div>
          </Card>
        </div>

        {/* EMPTY */}
        <StateLabel state="EMPTY" hint="new scenario · nothing placed"/>
        <div className="flex gap-6 items-start">
          <TogglePanel placements={[]} onDragStart={()=>{}} dragging={null}/>
          <main className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold text-zinc-50">Untitled scenario</h2>
              <Button variant="ghost" size="sm" icon="edit">Rename</Button>
            </div>
            {["must_now","optional","parked"].map(z => {
              const meta = ZONE_META[z];
              return (
                <div key={z} className="rounded-xl ring-2 ring-dashed ring-zinc-800 bg-zinc-900/20 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
                      <span className="text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-[10px] font-mono text-zinc-500">0</span>
                    </div>
                    <span className="text-sm font-mono tabular-nums text-zinc-500">{fmtCents(0)}</span>
                  </div>
                  <div className="py-10 text-center">
                    <Icon name="layers" size={28} className="text-zinc-700 mx-auto mb-2"/>
                    <div className="text-xs text-zinc-500">Drop puzzle pieces here from the left rail.</div>
                  </div>
                </div>
              );
            })}
          </main>
          <BudgetSidebar budget={computeBudget([])}/>
        </div>

        {/* LOADING */}
        <StateLabel state="LOADING" hint="hydrating scenario · running budget calc"/>
        <LoadingState/>

        {/* ERROR */}
        <StateLabel state="ERROR" hint="budget service throwing — Truth Table lookup failed"/>
        <ErrorBanner
          title="Budget service is degraded"
          message="The pricing engine couldn't look up one or more Truth Table activities. Toggle costs are showing last-known values from 4 hours ago. Drag-and-drop still works but live recompute is paused."
          onRetry={()=>{}}
        />
        <div className="mt-6 opacity-60 pointer-events-none">
          <div className="flex gap-6 items-start">
            <TogglePanel placements={placements} onDragStart={()=>{}} dragging={null}/>
            <ScenarioCanvas placements={placements} dragOverZone={null} dragOverEnter={()=>{}} dragOverLeave={()=>{}} onDrop={()=>{}} onCycleOption={()=>{}} dragging={null}/>
          </div>
        </div>

        {/* MOBILE */}
        <StateLabel state="MOBILE" hint="375px · Pieces/Canvas/Budget tabs · sticky bottom bar"/>
        <div className="flex justify-center pt-4">
          <MobileFrame label="iPhone 15 · 375 · scenario builder">
            <ScenarioMobile budget={budget} placements={placements}/>
          </MobileFrame>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ScenarioBuilderPage/>);
