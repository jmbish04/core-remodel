// Surface 1: Truth Table Editor
// Granular per-SF baseline cost catalog for construction activities.

const TRUTH_TABLE_ACTIVITIES = [
  { id: "a01", scopeKey: "demo.interior_walls", displayName: "Selective demo — interior walls", description: "Non-structural partition removal incl. drywall + studs, hauling.", trade: "demo", phase: "pre_construction", unit: "sf", baselineLaborCentsPerUnit: 450, baselineMaterialCentsPerUnit: 0, baselineEquipmentCentsPerUnit: 60, insuranceBaselineCentsPerUnit: 320, marketAdjustmentPct: 0.18, sourceType: "rsmeans", confidenceScore: 0.92 },
  { id: "a02", scopeKey: "demo.flooring", displayName: "Floor finish demo", description: "Remove existing flooring + substrate prep.", trade: "demo", phase: "pre_construction", unit: "sf", baselineLaborCentsPerUnit: 285, baselineMaterialCentsPerUnit: 0, baselineEquipmentCentsPerUnit: 25, insuranceBaselineCentsPerUnit: 220, marketAdjustmentPct: 0.18, sourceType: "bid_observed", confidenceScore: 0.88 },
  { id: "a03", scopeKey: "framing.exterior_wall", displayName: "New exterior wall framing", description: "2x6 framing + sheathing for new exterior wall assembly.", trade: "framing", phase: "rough", unit: "sf", baselineLaborCentsPerUnit: 1850, baselineMaterialCentsPerUnit: 920, baselineEquipmentCentsPerUnit: 70, insuranceBaselineCentsPerUnit: 1450, marketAdjustmentPct: 0.22, sourceType: "rsmeans", confidenceScore: 0.94 },
  { id: "a04", scopeKey: "framing.interior_partition", displayName: "Interior partition framing", description: "Non-structural 2x4 partition wall, per linear foot.", trade: "framing", phase: "rough", unit: "lf", baselineLaborCentsPerUnit: 4200, baselineMaterialCentsPerUnit: 1850, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 3800, marketAdjustmentPct: 0.18, sourceType: "manual", confidenceScore: 0.85 },
  { id: "a05", scopeKey: "plumbing.bath_rough", displayName: "Plumbing rough — full bath", description: "Supply + DWV rough-in for tub, toilet, lav vanity. Per fixture group.", trade: "plumbing", phase: "rough", unit: "ea", baselineLaborCentsPerUnit: 380000, baselineMaterialCentsPerUnit: 145000, baselineEquipmentCentsPerUnit: 8000, insuranceBaselineCentsPerUnit: 295000, marketAdjustmentPct: 0.25, sourceType: "bid_observed", confidenceScore: 0.81 },
  { id: "a06", scopeKey: "plumbing.fixture_set_bath", displayName: "Plumbing fixture set — bath", description: "Install owner-supplied tub, toilet, lav. Trim out + commission.", trade: "plumbing", phase: "finish", unit: "ea", baselineLaborCentsPerUnit: 145000, baselineMaterialCentsPerUnit: 22000, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 98000, marketAdjustmentPct: 0.22, sourceType: "insurance", confidenceScore: 0.76 },
  { id: "a07", scopeKey: "electrical.dwelling_rough", displayName: "Electrical rough — per dwelling SF", description: "Branch circuits, switches, recep, panel coordination. SF-prorated.", trade: "electrical", phase: "rough", unit: "sf", baselineLaborCentsPerUnit: 920, baselineMaterialCentsPerUnit: 380, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 680, marketAdjustmentPct: 0.20, sourceType: "rsmeans", confidenceScore: 0.89 },
  { id: "a08", scopeKey: "electrical.panel_200a", displayName: "Service panel upgrade — 200A", description: "Replace existing panel with 200A main, coordinate with utility.", trade: "electrical", phase: "rough", unit: "ea", baselineLaborCentsPerUnit: 285000, baselineMaterialCentsPerUnit: 180000, baselineEquipmentCentsPerUnit: 15000, insuranceBaselineCentsPerUnit: 220000, marketAdjustmentPct: 0.22, sourceType: "bid_observed", confidenceScore: 0.83 },
  { id: "a09", scopeKey: "hvac.mini_split_head", displayName: "Mini-split — single head install", description: "Per indoor head incl. lineset, drain, electrical hookup.", trade: "hvac", phase: "rough", unit: "ea", baselineLaborCentsPerUnit: 165000, baselineMaterialCentsPerUnit: 215000, baselineEquipmentCentsPerUnit: 12000, insuranceBaselineCentsPerUnit: null, marketAdjustmentPct: 0.18, sourceType: "ai_inferred", confidenceScore: 0.62 },
  { id: "a10", scopeKey: "hvac.ducted_per_sf", displayName: "Ducted HVAC system — per SF", description: "Full ducted high-velocity system, SF-prorated.", trade: "hvac", phase: "rough", unit: "sf", baselineLaborCentsPerUnit: 1850, baselineMaterialCentsPerUnit: 1450, baselineEquipmentCentsPerUnit: 220, insuranceBaselineCentsPerUnit: 2400, marketAdjustmentPct: 0.20, sourceType: "rsmeans", confidenceScore: 0.91 },
  { id: "a11", scopeKey: "flooring.hardwood_install", displayName: "Hardwood flooring — install", description: "Site-finished white oak, owner-supplied material. Labor only.", trade: "flooring", phase: "finish", unit: "sf", baselineLaborCentsPerUnit: 1450, baselineMaterialCentsPerUnit: 0, baselineEquipmentCentsPerUnit: 35, insuranceBaselineCentsPerUnit: 920, marketAdjustmentPct: 0.30, sourceType: "ai_inferred", confidenceScore: 0.58 },
  { id: "a12", scopeKey: "tile.bath_walls", displayName: "Tile install — bath walls", description: "Standard rectangle tile, thinset over cement board.", trade: "tile", phase: "finish", unit: "sf", baselineLaborCentsPerUnit: 2200, baselineMaterialCentsPerUnit: 0, baselineEquipmentCentsPerUnit: 45, insuranceBaselineCentsPerUnit: 1600, marketAdjustmentPct: 0.28, sourceType: "bid_observed", confidenceScore: 0.86 },
  { id: "a13", scopeKey: "finish.cabinet_install", displayName: "Cabinet install — linear", description: "Install owner-supplied cabinetry. Per linear foot.", trade: "finish_carpentry", phase: "finish", unit: "lf", baselineLaborCentsPerUnit: 18500, baselineMaterialCentsPerUnit: 1200, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 14000, marketAdjustmentPct: 0.24, sourceType: "manual", confidenceScore: 0.78 },
  { id: "a14", scopeKey: "finish.trim_base_case", displayName: "Trim — base + case", description: "Run baseboard + door casing. Material + labor, per LF.", trade: "finish_carpentry", phase: "finish", unit: "lf", baselineLaborCentsPerUnit: 820, baselineMaterialCentsPerUnit: 340, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 640, marketAdjustmentPct: 0.20, sourceType: "rsmeans", confidenceScore: 0.93 },
  { id: "a15", scopeKey: "paint.walls", displayName: "Paint — walls, 2 coat", description: "Prep, prime, two finish coats on prepared drywall.", trade: "paint", phase: "finish", unit: "sf", baselineLaborCentsPerUnit: 220, baselineMaterialCentsPerUnit: 65, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 180, marketAdjustmentPct: 0.18, sourceType: "rsmeans", confidenceScore: 0.95 },
  { id: "a16", scopeKey: "paint.ceilings", displayName: "Paint — ceilings, flat", description: "Single tone flat finish on prepared substrate.", trade: "paint", phase: "finish", unit: "sf", baselineLaborCentsPerUnit: 195, baselineMaterialCentsPerUnit: 55, baselineEquipmentCentsPerUnit: 0, insuranceBaselineCentsPerUnit: 160, marketAdjustmentPct: 0.18, sourceType: "ai_inferred", confidenceScore: 0.71 },
];

const UNIT_LABEL = { sf: "/sf", lf: "/lf", ea: "/ea", hr: "/hr", ls: "/ls" };
const PHASE_LABEL = { pre_construction: "Pre-con", rough: "Rough", finish: "Finish", punch: "Punch" };
const SOURCE_LABEL = {
  manual: { label: "Manual", icon: "edit" },
  insurance: { label: "Insurance", icon: "scale" },
  rsmeans: { label: "RSMeans", icon: "database" },
  ai_inferred: { label: "AI inferred", icon: "sparkles" },
  bid_observed: { label: "Bid obs.", icon: "file-text" },
};

function adjustedTotal(a) {
  const base = a.baselineLaborCentsPerUnit + a.baselineMaterialCentsPerUnit + a.baselineEquipmentCentsPerUnit;
  return Math.round(base * (1 + a.marketAdjustmentPct));
}

// ---------- Filter Bar ----------
function FilterBar({ tradeFilter, setTradeFilter, phaseFilter, setPhaseFilter, sourceFilter, setSourceFilter, search, setSearch, density, setDensity }) {
  const trades = ["demo","framing","plumbing","electrical","hvac","flooring","finish_carpentry","tile","paint"];
  const sources = Object.keys(SOURCE_LABEL);
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap py-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input icon="search" placeholder="Search activities…" value={search} onChange={e => setSearch(e.target.value)} className="w-72"/>
        <MultiSelect label="Trade" options={trades.map(t => ({ value: t, label: TRADE_LABEL[t] }))} value={tradeFilter} onChange={setTradeFilter}/>
        <MultiSelect label="Phase" options={Object.entries(PHASE_LABEL).map(([v,l]) => ({ value: v, label: l }))} value={phaseFilter} onChange={setPhaseFilter}/>
        <MultiSelect label="Source" options={sources.map(s => ({ value: s, label: SOURCE_LABEL[s].label }))} value={sourceFilter} onChange={setSourceFilter}/>
      </div>
      <div className="flex items-center gap-2">
        <DensityToggle value={density} onChange={setDensity}/>
        <div className="w-px h-5 bg-zinc-800 mx-1"></div>
        <Button variant="secondary" icon="sparkles" size="sm">Re-embed all</Button>
        <Button variant="primary" icon="plus" size="sm">Add activity</Button>
      </div>
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="h-9 px-3 text-sm bg-zinc-900 text-zinc-200 rounded-md ring-1 ring-zinc-800 hover:ring-zinc-700 inline-flex items-center gap-2">
        <span>{label}</span>
        {value.length > 0 && <span className="font-mono tabular-nums text-[10px] bg-zinc-700 text-zinc-100 rounded-sm px-1">{value.length}</span>}
        <Icon name="chevron-down" size={14} className="text-zinc-500"/>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-56 bg-zinc-900 rounded-md ring-1 ring-zinc-800 py-1 shadow-lg shadow-black/40">
          {options.map(o => (
            <button key={o.value} onClick={() => toggle(o.value)}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">
              <span className={`size-3.5 rounded-sm ring-1 ring-zinc-700 grid place-items-center ${value.includes(o.value) ? "bg-zinc-100" : ""}`}>
                {value.includes(o.value) && <Icon name="check" size={10} className="text-zinc-950" strokeWidth={3}/>}
              </span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DensityToggle({ value, onChange }) {
  return (
    <div className="inline-flex bg-zinc-900 rounded-md p-0.5 ring-1 ring-zinc-800">
      {[{ id: "comfortable", icon: "menu", label: "Comfy" }, { id: "compact", icon: "layers", label: "Compact" }].map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`h-7 px-2.5 text-xs rounded-sm transition-colors ${value === o.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- KPI strip ----------
function KPIStrip({ activities }) {
  const total = activities.length;
  const embedded = activities.filter(a => a.confidenceScore > 0).length;
  const avgConf = activities.length ? activities.reduce((s,a)=>s+a.confidenceScore,0)/activities.length : 0;
  const flagged = activities.filter(a => a.sourceType === "ai_inferred").length;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KPI label="Total activities" value={total}
        sparkline={<Sparkline data={[8,9,11,12,14,15,16]} color="#a1a1aa"/>}
        hint="across 9 trades"/>
      <KPI label="Activities embedded" value={embedded} delta={2}
        sparkline={<Sparkline data={[5,8,9,11,13,14,16]} color="#34d399"/>}
        hint="indexed for AI mapping"/>
      <KPI label="Avg confidence" value={Math.round(avgConf*100)} format={v=>`${v}%`}
        sparkline={<Sparkline data={[68,72,74,78,81,82,83]} color="#38bdf8"/>}
        hint="manual + observed score higher"/>
      <KPI label="AI-inferred (review)" value={flagged} delta={-1}
        sparkline={<Sparkline data={[6,5,5,4,4,3,3]} color="#fbbf24"/>}
        hint="rows needing human pass"/>
    </div>
  );
}

// ---------- Table row ----------
function TruthRow({ a, density, editing, onEdit, onSave, onCancel }) {
  const padY = density === "compact" ? "py-2" : "py-3.5";
  const adj = adjustedTotal(a);
  const insBase = a.insuranceBaselineCentsPerUnit;
  const deltaVsIns = insBase ? (adj - insBase) / insBase : null;
  const overInsurance = deltaVsIns !== null && deltaVsIns > 0.20;
  const trade = a.trade;

  const [draft, setDraft] = useState({
    labor: a.baselineLaborCentsPerUnit,
    material: a.baselineMaterialCentsPerUnit,
    equip: a.baselineEquipmentCentsPerUnit,
  });

  if (editing) {
    return (
      <tr className="bg-zinc-900/70 ring-1 ring-emerald-400/30">
        <td colSpan={9} className="p-0">
          <div className="px-6 py-4 grid grid-cols-12 items-center gap-3">
            <div className="col-span-3">
              <div className="text-[11px] font-mono text-zinc-500">{a.scopeKey}</div>
              <div className="text-sm font-medium text-zinc-100">{a.displayName}</div>
            </div>
            <div className="col-span-1"><Chip tone={TRADE_TONE[trade]}>{TRADE_LABEL[trade]}</Chip></div>
            <div className="col-span-1 text-xs text-zinc-500 font-mono">{UNIT_LABEL[a.unit]}</div>
            {["labor","material","equip"].map(k => (
              <div key={k} className="col-span-1 flex items-center gap-1">
                <span className="text-zinc-500 font-mono text-xs">$</span>
                <input type="number" value={(draft[k]/100).toFixed(2)} onChange={e => setDraft(d => ({...d, [k]: Math.round(parseFloat(e.target.value || 0)*100)}))}
                  className="w-20 h-7 px-2 text-xs font-mono tabular-nums bg-zinc-950 text-emerald-300 rounded-sm ring-1 ring-emerald-400/40 focus:ring-emerald-300 focus:outline-none"/>
              </div>
            ))}
            <div className="col-span-1 text-right text-sm font-mono tabular-nums text-emerald-300">
              {fmtCents(Math.round((draft.labor + draft.material + draft.equip) * (1 + a.marketAdjustmentPct)), { decimals: 2 })}
            </div>
            <div className="col-span-1"></div>
            <div className="col-span-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
              <Button variant="accent" size="sm" icon="save" onClick={() => onSave(draft)}>Save</Button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`group hover:bg-zinc-900/40 transition-colors ${overInsurance ? "relative" : ""}`}>
      <td className={`${padY} pl-6 pr-3`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-zinc-500 group-hover:text-zinc-400">{a.scopeKey}</div>
            <div className="text-sm font-medium text-zinc-100 truncate">{a.displayName}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5 truncate max-w-md">{a.description}</div>
          </div>
        </div>
      </td>
      <td className={`${padY} px-3`}>
        <Chip tone={TRADE_TONE[trade]}>{TRADE_LABEL[trade]}</Chip>
      </td>
      <td className={`${padY} px-3 text-xs text-zinc-500 font-mono`}>{UNIT_LABEL[a.unit]}</td>
      <td className={`${padY} px-3 text-right text-sm font-mono tabular-nums text-zinc-300`}>{fmtCents(a.baselineLaborCentsPerUnit, { decimals: 2 })}</td>
      <td className={`${padY} px-3 text-right text-sm font-mono tabular-nums text-zinc-300`}>{fmtCents(a.baselineMaterialCentsPerUnit, { decimals: 2 })}</td>
      <td className={`${padY} px-3 text-right text-sm font-mono tabular-nums text-zinc-300`}>{fmtCents(a.baselineEquipmentCentsPerUnit, { decimals: 2 })}</td>
      <td className={`${padY} px-3 text-right`}>
        <div className="inline-flex flex-col items-end">
          <span className="text-sm font-mono tabular-nums text-zinc-50 font-medium">{fmtCents(adj, { decimals: 2 })}</span>
          <span className="text-[10px] text-zinc-500">+{Math.round(a.marketAdjustmentPct*100)}% SF</span>
        </div>
      </td>
      <td className={`${padY} px-3 text-right`}>
        {insBase ? (
          <div className="inline-flex flex-col items-end gap-1">
            <span className="text-sm font-mono tabular-nums text-zinc-400">{fmtCents(insBase, { decimals: 2 })}</span>
            {overInsurance && (
              <Chip tone="amber" className="!text-[10px] !py-0">
                {fmtPct(deltaVsIns, { decimals: 0, sign: true })} vs ins.
              </Chip>
            )}
          </div>
        ) : (
          <span className="text-xs text-zinc-600 italic">no ref</span>
        )}
      </td>
      <td className={`${padY} px-3`}>
        <ConfidenceBar value={a.confidenceScore}/>
      </td>
      <td className={`${padY} px-3`}>
        <div className="flex items-center gap-1.5">
          <Icon name={SOURCE_LABEL[a.sourceType].icon} size={12}
                className={a.sourceType === "ai_inferred" ? "text-violet-400" : "text-zinc-500"}/>
          <span className={`text-xs ${a.sourceType === "ai_inferred" ? "text-violet-300" : "text-zinc-400"}`}>
            {SOURCE_LABEL[a.sourceType].label}
          </span>
        </div>
      </td>
      <td className={`${padY} pr-6 pl-3 text-right`}>
        <button onClick={() => onEdit(a.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2 text-xs rounded-sm text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1">
          <Icon name="edit" size={12}/>
          Edit
        </button>
      </td>
    </tr>
  );
}

// ---------- Table ----------
function TruthTable({ activities, density, editingId, setEditingId }) {
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <th className="pl-6 pr-3 py-3 font-medium">Activity <Icon name="chevron-down" size={10} className="inline text-zinc-700"/></th>
              <th className="px-3 py-3 font-medium">Trade</th>
              <th className="px-3 py-3 font-medium">Unit</th>
              <th className="px-3 py-3 font-medium text-right">Labor $/u</th>
              <th className="px-3 py-3 font-medium text-right">Material $/u</th>
              <th className="px-3 py-3 font-medium text-right">Equip $/u</th>
              <th className="px-3 py-3 font-medium text-right">Adjusted $/u</th>
              <th className="px-3 py-3 font-medium text-right">Insurance ref</th>
              <th className="px-3 py-3 font-medium">Conf.</th>
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="pr-6 pl-3 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {activities.map(a => (
              <TruthRow key={a.id} a={a} density={density}
                editing={editingId === a.id}
                onEdit={setEditingId}
                onSave={() => setEditingId(null)}
                onCancel={() => setEditingId(null)}/>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Mobile variant ----------
function TruthMobile({ activities }) {
  return (
    <div className="px-4 pb-6">
      <div className="py-4">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Catalog</div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Truth Table</h1>
        <p className="mt-1 text-xs text-zinc-400">Baseline labor + material costs. SF Bay-adjusted.</p>
      </div>
      <Input icon="search" placeholder="Search…" className="w-full mb-3"/>
      <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 mb-2">
        {["All","Demo","Framing","Plumbing","Electrical","HVAC","Flooring"].map((c,i) => (
          <button key={c} className={`shrink-0 h-7 px-3 text-xs rounded-full ${i===0 ? "bg-zinc-100 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800"}`}>{c}</button>
        ))}
      </div>
      <div className="space-y-2">
        {activities.slice(0,5).map(a => {
          const adj = adjustedTotal(a);
          return (
            <div key={a.id} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-zinc-500">{a.scopeKey}</div>
                  <div className="text-sm font-medium text-zinc-100">{a.displayName}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Chip tone={TRADE_TONE[a.trade]}>{TRADE_LABEL[a.trade]}</Chip>
                    <span className="text-[10px] text-zinc-500 font-mono">{UNIT_LABEL[a.unit]}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-mono tabular-nums text-zinc-50 font-medium">{fmtCents(adj, { decimals: 2 })}</div>
                  <div className="text-[10px] text-zinc-500">adjusted</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div><div className="text-zinc-500">Labor</div><div className="font-mono text-zinc-300">{fmtCents(a.baselineLaborCentsPerUnit, { decimals: 2 })}</div></div>
                <div><div className="text-zinc-500">Mat'l</div><div className="font-mono text-zinc-300">{fmtCents(a.baselineMaterialCentsPerUnit, { decimals: 2 })}</div></div>
                <div><div className="text-zinc-500">Equip</div><div className="font-mono text-zinc-300">{fmtCents(a.baselineEquipmentCentsPerUnit, { decimals: 2 })}</div></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Skeletons ----------
function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-5">
            <Skeleton className="h-3 w-24 mb-3"/>
            <Skeleton className="h-7 w-16 mb-3"/>
            <Skeleton className="h-2 w-32"/>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 overflow-hidden">
        <div className="px-6 py-3 divide-y divide-zinc-800/40">
          {[0,1,2,3,4,5,6,7].map(i => (
            <div key={i} className="py-3 grid grid-cols-12 gap-4 items-center">
              <Skeleton className="col-span-3 h-4"/>
              <Skeleton className="col-span-1 h-5 rounded-full"/>
              <Skeleton className="col-span-1 h-3"/>
              <Skeleton className="col-span-1 h-4"/>
              <Skeleton className="col-span-1 h-4"/>
              <Skeleton className="col-span-1 h-4"/>
              <Skeleton className="col-span-1 h-4"/>
              <Skeleton className="col-span-1 h-4"/>
              <Skeleton className="col-span-1 h-3 rounded-full"/>
              <Skeleton className="col-span-1 h-3"/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------
function TruthTablePage() {
  const [search, setSearch] = useState("");
  const [tradeFilter, setTradeFilter] = useState([]);
  const [phaseFilter, setPhaseFilter] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
  const [density, setDensity] = useState("comfortable");
  const [editingId, setEditingId] = useState("a11"); // hardwood install is mid-edit by default

  const filtered = useMemo(() => {
    return TRUTH_TABLE_ACTIVITIES.filter(a => {
      if (search && !`${a.scopeKey} ${a.displayName} ${a.description}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (tradeFilter.length && !tradeFilter.includes(a.trade)) return false;
      if (phaseFilter.length && !phaseFilter.includes(a.phase)) return false;
      if (sourceFilter.length && !sourceFilter.includes(a.sourceType)) return false;
      return true;
    });
  }, [search, tradeFilter, phaseFilter, sourceFilter]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <Navbar active="truth-table" surface="Catalog"/>
      <div className="mx-auto max-w-[1400px] px-6 pb-24">
        <PageHeader
          eyebrow="Catalog"
          title="Truth Table"
          description="Baseline labor + material costs per granular activity. SF Bay-adjusted, embedded for semantic bid mapping."
          actions={
            <>
              <Button variant="ghost" icon="download" size="md">Export CSV</Button>
              <Button variant="secondary" icon="copy" size="md">Diff vs last week</Button>
            </>
          }
        />

        {/* --- STATE: DATA --- */}
        <StateLabel state="DATA" hint="hardwood-install row mid-edit · paint.walls flagged > 20% over insurance"/>
        <KPIStrip activities={TRUTH_TABLE_ACTIVITIES}/>
        <div className="mt-2"><FilterBar
          tradeFilter={tradeFilter} setTradeFilter={setTradeFilter}
          phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter}
          sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
          search={search} setSearch={setSearch}
          density={density} setDensity={setDensity}/>
        </div>
        <TruthTable activities={filtered} density={density} editingId={editingId} setEditingId={setEditingId}/>

        {/* --- STATE: EMPTY --- */}
        <StateLabel state="EMPTY" hint="zero activities — first-run, freshly cloned project"/>
        <KPIStrip activities={[]}/>
        <div className="mt-2"><FilterBar
          tradeFilter={[]} setTradeFilter={()=>{}} phaseFilter={[]} setPhaseFilter={()=>{}}
          sourceFilter={[]} setSourceFilter={()=>{}} search="" setSearch={()=>{}}
          density="comfortable" setDensity={()=>{}}/>
        </div>
        <EmptyState
          icon="database"
          title="No baseline activities yet"
          description="Import an RSMeans CSV, paste an insurance scope, or start from the SF Bay seed catalog (240 activities)."
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" icon="sparkles">Seed from SF Bay catalog</Button>
              <Button variant="secondary" icon="upload">Import CSV</Button>
            </div>
          }
        />

        {/* --- STATE: LOADING --- */}
        <StateLabel state="LOADING" hint="initial fetch + embedding refresh"/>
        <LoadingState/>

        {/* --- STATE: ERROR --- */}
        <StateLabel state="ERROR" hint="embeddings service unreachable"/>
        <ErrorBanner
          title="Couldn't reach the embeddings service."
          message="The semantic-mapping pipeline is down — table is still readable but new rows won't be embedded and search by meaning is off. Trying every 30s."
          onRetry={()=>{}}
        />
        <div className="mt-6 opacity-60 pointer-events-none select-none">
          <KPIStrip activities={TRUTH_TABLE_ACTIVITIES}/>
          <div className="mt-4">
            <TruthTable activities={TRUTH_TABLE_ACTIVITIES.slice(0,4)} density="compact" editingId={null} setEditingId={()=>{}}/>
          </div>
        </div>

        {/* --- STATE: MOBILE --- */}
        <StateLabel state="MOBILE" hint="375px · sidebar collapses, table becomes stacked cards"/>
        <div className="flex justify-center pt-4">
          <MobileFrame>
            <TruthMobile activities={TRUTH_TABLE_ACTIVITIES}/>
          </MobileFrame>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<TruthTablePage/>);
