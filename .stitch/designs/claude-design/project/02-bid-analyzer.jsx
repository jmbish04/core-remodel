// Surface 2: Bid Analyzer detail view (one bid, post-analysis).

const { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip: RTooltip, ReferenceLine, Cell, Rectangle } = window.Recharts || {};

// ---------- Mock bid analysis ----------
const BID = {
  id: "bid_0142",
  contractorName: "Hollister Builders",
  receivedAt: "2026-05-12",
  totalBidCents: 87420000,
  totalTruthTableCents: 71850000,
  variancePct: 0.217,
  verdict: "investigate",
  aiSummary: "Hollister's bid lands 21.7% above our Truth Table. Plumbing and electrical are 32% and 28% over baseline respectively — both have repeat overruns across their last three jobs in the database. Demo and framing are aligned. Two scope items appear missing (HVAC commissioning, structural sign-off) which would add an estimated $18.4k if added back, narrowing the apparent gap.",
};

const BID_MAPPINGS = [
  // Overpriced
  { id:"m01", bidLine:{ rawLabel:"Plumbing — full bath rough + trim, 2 baths", rawCostCents:1480000, parsedQuantity:2, parsedUnit:"ea" }, activity:{ scopeKey:"plumbing.bath_rough", displayName:"Plumbing rough — full bath", trade:"plumbing", unit:"ea" }, allocationPct:0.62, allocatedCostCents:917600, baselineCostCents:679000, varianceCents:238600, variancePct:0.35, flag:"overpriced", semanticScore:0.91 },
  { id:"m02", bidLine:{ rawLabel:"Electrical service upgrade + rough wiring", rawCostCents:920000, parsedQuantity:1, parsedUnit:"ls" }, activity:{ scopeKey:"electrical.panel_200a", displayName:"Service panel upgrade — 200A", trade:"electrical", unit:"ea" }, allocationPct:0.48, allocatedCostCents:441600, baselineCostCents:341000, varianceCents:100600, variancePct:0.295, flag:"overpriced", semanticScore:0.78 },
  { id:"m03", bidLine:{ rawLabel:"Hardwood install — main level", rawCostCents:1280000, parsedQuantity:680, parsedUnit:"sf" }, activity:{ scopeKey:"flooring.hardwood_install", displayName:"Hardwood flooring — install", trade:"flooring", unit:"sf" }, allocationPct:1.0, allocatedCostCents:1280000, baselineCostCents:946560, varianceCents:333440, variancePct:0.352, flag:"overpriced", semanticScore:0.94 },
  { id:"m04", bidLine:{ rawLabel:"Bath tile — full surround + floor", rawCostCents:840000, parsedQuantity:280, parsedUnit:"sf" }, activity:{ scopeKey:"tile.bath_walls", displayName:"Tile install — bath walls", trade:"tile", unit:"sf" }, allocationPct:0.78, allocatedCostCents:655200, baselineCostCents:514800, varianceCents:140400, variancePct:0.273, flag:"overpriced", semanticScore:0.82 },
  { id:"m05", bidLine:{ rawLabel:"Cabinet install — kitchen", rawCostCents:1860000, parsedQuantity:38, parsedUnit:"lf" }, activity:{ scopeKey:"finish.cabinet_install", displayName:"Cabinet install — linear", trade:"finish_carpentry", unit:"lf" }, allocationPct:1.0, allocatedCostCents:1860000, baselineCostCents:872100, varianceCents:987900, variancePct:1.13, flag:"overpriced", semanticScore:0.67 },
  // Aligned
  { id:"m06", bidLine:{ rawLabel:"Selective demo — interior partitions", rawCostCents:520000, parsedQuantity:1100, parsedUnit:"sf" }, activity:{ scopeKey:"demo.interior_walls", displayName:"Selective demo — interior walls", trade:"demo", unit:"sf" }, allocationPct:1.0, allocatedCostCents:520000, baselineCostCents:530420, varianceCents:-10420, variancePct:-0.02, flag:"aligned", semanticScore:0.96 },
  { id:"m07", bidLine:{ rawLabel:"Interior partition framing + sheathing", rawCostCents:890000, parsedQuantity:124, parsedUnit:"lf" }, activity:{ scopeKey:"framing.interior_partition", displayName:"Interior partition framing", trade:"framing", unit:"lf" }, allocationPct:1.0, allocatedCostCents:890000, baselineCostCents:884460, varianceCents:5540, variancePct:0.006, flag:"aligned", semanticScore:0.93 },
  { id:"m08", bidLine:{ rawLabel:"Paint — walls + ceilings throughout", rawCostCents:680000, parsedQuantity:3200, parsedUnit:"sf" }, activity:{ scopeKey:"paint.walls", displayName:"Paint — walls, 2 coat", trade:"paint", unit:"sf" }, allocationPct:0.65, allocatedCostCents:442000, baselineCostCents:425170, varianceCents:16830, variancePct:0.040, flag:"aligned", semanticScore:0.88 },
  // Underpriced
  { id:"m09", bidLine:{ rawLabel:"Trim — base + case throughout", rawCostCents:420000, parsedQuantity:480, parsedUnit:"lf" }, activity:{ scopeKey:"finish.trim_base_case", displayName:"Trim — base + case", trade:"finish_carpentry", unit:"lf" }, allocationPct:1.0, allocatedCostCents:420000, baselineCostCents:668160, varianceCents:-248160, variancePct:-0.371, flag:"underpriced", semanticScore:0.84 },
  { id:"m10", bidLine:{ rawLabel:"Floor demo — main + upper", rawCostCents:180000, parsedQuantity:1400, parsedUnit:"sf" }, activity:{ scopeKey:"demo.flooring", displayName:"Floor finish demo", trade:"demo", unit:"sf" }, allocationPct:1.0, allocatedCostCents:180000, baselineCostCents:512400, varianceCents:-332400, variancePct:-0.649, flag:"underpriced", semanticScore:0.71 },
];

const MISSING_SCOPE = [
  { scopeKey:"hvac.commissioning", displayName:"HVAC commissioning + balance", estimatedCostCents:480000, reason:"Standard for new ducted systems — not itemized in bid." },
  { scopeKey:"structural.engineer_signoff", displayName:"Structural engineer sign-off", estimatedCostCents:850000, reason:"Required for the kitchen slab cut — referenced in scope email but not priced." },
  { scopeKey:"permits.plan_check", displayName:"Plan check + permit fees", estimatedCostCents:510000, reason:"Carried as 'allowance' in bid — should be passed-through itemized." },
];

const LEVERS = [
  { title:"Cabinet install vs market", description:"Hollister's $489/lf is well above the $174–$240/lf range we've seen from finish-only subs. Bid the install separately from the GC scope.", estimatedSavingsCents: 750000 },
  { title:"Plumbing — request hourly basis", description:"Bath rough is +35%. Asking for a $/hr + materials breakdown often reveals labor padding on multi-bath jobs.", estimatedSavingsCents: 220000 },
  { title:"Hardwood — owner-supplied install bid", description:"You're already supplying material. Soliciting one floor-install-only sub usually beats GC markup by 18–25%.", estimatedSavingsCents: 280000 },
  { title:"Tile — clarify rectified vs handmade", description:"Variance suggests bid assumes handmade tile setting. Confirming spec could close the gap.", estimatedSavingsCents: 90000 },
];

const VARIANCE_BUCKETS = [
  { bucket:"≤ −20%", count:2, color:"#38bdf8" },
  { bucket:"−20–−10%", count:1, color:"#7dd3fc" },
  { bucket:"aligned", count:3, color:"#a1a1aa" },
  { bucket:"+10–20%", count:0, color:"#fde68a" },
  { bucket:"+20–50%", count:3, color:"#fbbf24" },
  { bucket:"> +50%", count:1, color:"#fb7185" },
];

const TRADE_BARS = [
  { trade:"Demo", bid:7000, baseline:10500 },
  { trade:"Framing", bid:8900, baseline:8845 },
  { trade:"Plumbing", bid:14800, baseline:11200 },
  { trade:"Electrical", bid:9200, baseline:7200 },
  { trade:"HVAC", bid:11500, baseline:11200 },
  { trade:"Flooring", bid:12800, baseline:9466 },
  { trade:"Tile", bid:8400, baseline:6600 },
  { trade:"Finish carp.", bid:22800, baseline:15400 },
  { trade:"Paint", bid:6800, baseline:6520 },
];

// ---------- Hero banner ----------
function HeroBanner() {
  return (
    <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-8">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <Chip tone="amber" icon="alert-triangle" className="!px-2.5 !py-1 !text-xs">Investigate</Chip>
            <span className="text-xs text-zinc-500">received {BID.receivedAt}</span>
            <span className="text-xs text-zinc-700">·</span>
            <span className="text-xs text-zinc-500 font-mono">{BID.id}</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{BID.contractorName}</h2>
          <p className="mt-4 text-sm text-zinc-300 leading-relaxed max-w-3xl">{BID.aiSummary}</p>
          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" icon="send" size="sm">Send negotiation memo</Button>
            <Button variant="secondary" icon="file-text" size="sm">Open original PDF</Button>
            <Button variant="ghost" icon="archive" size="sm">Archive bid</Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 min-w-[420px] py-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Total bid</div>
            <div className="text-3xl font-mono tabular-nums text-zinc-50 font-medium">{fmtCents(BID.totalBidCents)}</div>
            <div className="text-xs text-zinc-500 mt-1">contractor priced</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Truth Table</div>
            <div className="text-3xl font-mono tabular-nums text-zinc-300 font-medium">{fmtCents(BID.totalTruthTableCents)}</div>
            <div className="text-xs text-zinc-500 mt-1">baseline</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Variance</div>
            <div className="text-3xl font-mono tabular-nums text-amber-300 font-medium">{fmtPct(BID.variancePct, { decimals:1, sign:true })}</div>
            <div className="text-xs text-zinc-500 mt-1">{fmtCents(BID.totalBidCents - BID.totalTruthTableCents, { sign:true })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Hero charts ----------
function HeroCharts() {
  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <SectionTitle>By trade — bid vs baseline</SectionTitle>
        <p className="text-xs text-zinc-500 mt-1.5">Finish carpentry, plumbing, and flooring drive the variance.</p>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={TRADE_BARS} layout="vertical" margin={{ top:5, right:30, left:0, bottom:5 }}>
              <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`}/>
              <YAxis type="category" dataKey="trade" tick={{ fill: "#fafafa", fontSize: 11 }} axisLine={false} tickLine={false} width={92}/>
              <RTooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#18181b", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                labelStyle={{ color: "#fafafa", fontSize: 11 }}
                itemStyle={{ color: "#a1a1aa" }}
                formatter={(v) => `$${(v/1000).toFixed(1)}k`}/>
              <Bar dataKey="baseline" fill="#3f3f46" radius={[2,2,2,2]} barSize={10}/>
              <Bar dataKey="bid" fill="oklch(0.70 0.18 50)" radius={[2,2,2,2]} barSize={10}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 bg-zinc-700 rounded-sm"></span>Truth Table baseline</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{background:"oklch(0.70 0.18 50)"}}></span>Bid amount</span>
        </div>
      </Card>

      <Card>
        <SectionTitle>Variance distribution</SectionTitle>
        <p className="text-xs text-zinc-500 mt-1.5">10 mapped line items across 6 buckets.</p>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={VARIANCE_BUCKETS} margin={{ top:5, right:5, left:-10, bottom:5 }}>
              <XAxis dataKey="bucket" tick={{ fill: "#fafafa", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false}/>
              <RTooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#18181b", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                labelStyle={{ color: "#fafafa", fontSize: 11 }}
                itemStyle={{ color: "#a1a1aa" }}/>
              <Bar dataKey="count" radius={[2,2,0,0]}>
                {VARIANCE_BUCKETS.map((b, i) => <Cell key={i} fill={b.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ---------- Mapping table ----------
function MappingTable({ rows, tab }) {
  if (!rows.length) {
    return (
      <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 py-16 text-center text-sm text-zinc-500">
        No line items in this bucket.
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <th className="pl-6 pr-3 py-3 font-medium">Bid line</th>
            <th className="px-3 py-3 font-medium w-28">Allocation</th>
            <th className="px-3 py-3 font-medium">Mapped activity</th>
            <th className="px-3 py-3 py-3 font-medium text-right">Baseline</th>
            <th className="px-3 py-3 font-medium text-right">Variance</th>
            <th className="px-3 py-3 font-medium w-24">Match</th>
            <th className="pr-6 pl-3 py-3 font-medium text-right w-32"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rows.map(r => <MappingRow key={r.id} r={r} tab={tab}/>)}
        </tbody>
      </table>
    </div>
  );
}

function MappingRow({ r, tab }) {
  const isOver = r.flag === "overpriced";
  const isUnder = r.flag === "underpriced";
  const accentColor = isOver ? "#fb7185" : isUnder ? "#38bdf8" : "#34d399";
  return (
    <tr className="group hover:bg-zinc-900/40 transition-colors relative">
      {/* left edge accent for overpriced — pseudo via inline svg div */}
      {isOver && <td className="absolute left-0 top-0 bottom-0 w-[2px] p-0" style={{ background: accentColor }}></td>}
      <td className="pl-6 pr-3 py-4">
        <div className="text-sm text-zinc-200">{r.bidLine.rawLabel}</div>
        <div className="mt-1 flex items-center gap-3 text-[11px]">
          <span className="font-mono tabular-nums text-zinc-400">{fmtCents(r.bidLine.rawCostCents)}</span>
          {r.bidLine.parsedQuantity && (
            <span className="text-zinc-500">{r.bidLine.parsedQuantity} {r.bidLine.parsedUnit}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-4 w-28">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-zinc-300" style={{ width: `${r.allocationPct * 100}%` }}></div>
          </div>
          <span className="text-[10px] font-mono tabular-nums text-zinc-500">{Math.round(r.allocationPct*100)}%</span>
        </div>
        <div className="mt-1 text-[10px] font-mono text-zinc-500">{fmtCents(r.allocatedCostCents)}</div>
      </td>
      <td className="px-3 py-4">
        <div className="text-[11px] font-mono text-zinc-500">{r.activity.scopeKey}</div>
        <div className="text-sm text-zinc-100">{r.activity.displayName}</div>
        <div className="mt-1"><Chip tone={TRADE_TONE[r.activity.trade]}>{TRADE_LABEL[r.activity.trade]}</Chip></div>
      </td>
      <td className="px-3 py-4 text-right">
        <span className="text-sm font-mono tabular-nums text-zinc-300">{fmtCents(r.baselineCostCents)}</span>
      </td>
      <td className="px-3 py-4 text-right">
        <div className="inline-flex flex-col items-end">
          <span className={`text-sm font-mono tabular-nums font-medium ${isOver ? "text-rose-300" : isUnder ? "text-sky-300" : "text-emerald-300"}`}>
            {fmtCents(r.varianceCents, { sign: true })}
          </span>
          <span className={`text-[11px] font-mono tabular-nums ${isOver ? "text-rose-400/80" : isUnder ? "text-sky-400/80" : "text-emerald-400/80"}`}>
            {fmtPct(r.variancePct, { decimals:1, sign:true })}
          </span>
        </div>
      </td>
      <td className="px-3 py-4 w-24">
        <ConfidenceBar value={r.semanticScore}/>
      </td>
      <td className="pr-6 pl-3 py-4 text-right">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
          <button className="h-7 px-2 text-xs rounded-sm text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1">
            <Icon name="sliders" size={12}/> Override
          </button>
          <button className="h-7 px-2 text-xs rounded-sm text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1">
            <Icon name="check" size={12}/> Confirm
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------- Missing scope tab content ----------
function MissingScopeList() {
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 overflow-hidden">
      <div className="divide-y divide-zinc-800/60">
        {MISSING_SCOPE.map(m => (
          <div key={m.scopeKey} className="px-6 py-5 hover:bg-zinc-900/30">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-zinc-500">{m.scopeKey}</div>
                <div className="text-sm text-zinc-100 font-medium">{m.displayName}</div>
                <div className="mt-1 text-xs text-zinc-500 max-w-xl">{m.reason}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-mono tabular-nums text-amber-300">{fmtCents(m.estimatedCostCents)}</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">est. if added</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="secondary" size="sm">Add to RFI</Button>
                <Button variant="ghost" size="sm">Dismiss</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Negotiation rail ----------
function NegotiationRail() {
  const total = LEVERS.reduce((s,l) => s + l.estimatedSavingsCents, 0);
  return (
    <aside className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-6 sticky top-20">
      <div className="flex items-center justify-between">
        <SectionTitle>Negotiation levers</SectionTitle>
        <Chip tone="sky" icon="sparkles">AI</Chip>
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Potential savings</div>
        <div className="text-3xl font-mono tabular-nums text-emerald-300 font-medium mt-1">{fmtCents(total)}</div>
        <div className="text-[11px] text-zinc-500 mt-1">across {LEVERS.length} levers</div>
      </div>
      <div className="mt-5 divide-y divide-zinc-800/60">
        {LEVERS.map((l, i) => (
          <div key={i} className="py-4 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-100">{l.title}</div>
                <div className="mt-1 text-xs text-zinc-500 leading-relaxed">{l.description}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono tabular-nums text-emerald-300">−{fmtCents(l.estimatedSavingsCents)}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button className="text-[11px] text-zinc-400 hover:text-zinc-100">Draft email →</button>
              <span className="text-zinc-700">·</span>
              <button className="text-[11px] text-zinc-500 hover:text-zinc-300">Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---------- Tabs region ----------
function MappingTabs() {
  const [tab, setTab] = useState("overpriced");
  const groups = useMemo(() => {
    return {
      overpriced: BID_MAPPINGS.filter(m => m.flag === "overpriced").sort((a,b)=>b.varianceCents - a.varianceCents),
      aligned: BID_MAPPINGS.filter(m => m.flag === "aligned"),
      underpriced: BID_MAPPINGS.filter(m => m.flag === "underpriced"),
      missing: MISSING_SCOPE,
    };
  }, []);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id:"overpriced", label:"Overpriced", badge: groups.overpriced.length },
          { id:"aligned", label:"Aligned", badge: groups.aligned.length },
          { id:"underpriced", label:"Underpriced", badge: groups.underpriced.length },
          { id:"missing", label:"Missing scope", badge: groups.missing.length },
        ]}/>
        <div className="text-[11px] text-zinc-500 font-mono">sorted by variance desc</div>
      </div>
      {tab === "missing"
        ? <MissingScopeList/>
        : <MappingTable rows={groups[tab]} tab={tab}/>}
    </div>
  );
}

// ---------- Mobile variant ----------
function BidMobile() {
  return (
    <div className="px-4 pb-6">
      <div className="py-4">
        <div className="flex items-center gap-2 mb-2">
          <Chip tone="amber" icon="alert-triangle">Investigate</Chip>
          <span className="text-[10px] text-zinc-500 font-mono">{BID.id}</span>
        </div>
        <h1 className="text-xl font-semibold text-zinc-50">{BID.contractorName}</h1>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 p-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Bid</div>
            <div className="text-lg font-mono tabular-nums text-zinc-50">{fmtCents(BID.totalBidCents)}</div>
          </div>
          <div className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 p-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Variance</div>
            <div className="text-lg font-mono tabular-nums text-amber-300">{fmtPct(BID.variancePct, { decimals:1, sign:true })}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-400 leading-relaxed">{BID.aiSummary.slice(0, 220)}…</p>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-2 mb-3">
        {["Overpriced (5)","Aligned (3)","Under (2)","Missing (3)"].map((c,i)=>(
          <button key={c} className={`shrink-0 h-7 px-3 text-xs rounded-full ${i===0 ? "bg-zinc-100 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800"}`}>{c}</button>
        ))}
      </div>
      <div className="space-y-2">
        {BID_MAPPINGS.filter(m=>m.flag==="overpriced").slice(0,3).map(r => (
          <div key={r.id} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-3 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-rose-400"></div>
            <div className="text-sm text-zinc-200 truncate">{r.bidLine.rawLabel}</div>
            <div className="mt-1 flex items-center justify-between">
              <Chip tone={TRADE_TONE[r.activity.trade]}>{TRADE_LABEL[r.activity.trade]}</Chip>
              <div className="text-right">
                <div className="text-sm font-mono text-rose-300">{fmtCents(r.varianceCents, { sign:true })}</div>
                <div className="text-[10px] font-mono text-rose-400/80">{fmtPct(r.variancePct, { decimals:1, sign:true })}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Loading skeleton ----------
function LoadingState() {
  return (
    <div>
      <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-8">
        <Skeleton className="h-5 w-32 mb-4 rounded-full"/>
        <Skeleton className="h-7 w-64 mb-3"/>
        <Skeleton className="h-4 w-full max-w-3xl mb-2"/>
        <Skeleton className="h-4 w-2/3 max-w-2xl"/>
        <div className="mt-6 grid grid-cols-3 gap-6 max-w-md">
          {[0,1,2].map(i => <div key={i}><Skeleton className="h-3 w-16 mb-2"/><Skeleton className="h-7 w-24"/></div>)}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-6">
        <Skeleton className="h-80 rounded-xl"/>
        <Skeleton className="h-80 rounded-xl"/>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-2">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl"/>)}
        </div>
        <Skeleton className="h-96 rounded-xl"/>
      </div>
    </div>
  );
}

// ---------- Page ----------
function BidAnalyzerPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <Navbar active="bid-analyzer" surface="Bid Analyzer"/>
      <div className="mx-auto max-w-[1400px] px-6 pb-24">
        <PageHeader
          eyebrow="Bid analysis"
          title={<>Hollister Builders <span className="text-zinc-500 font-normal">· whole-home remodel</span></>}
          description="Single-bid teardown against the Truth Table. Line-item mapping, variance buckets, and AI-suggested negotiation levers."
          actions={
            <>
              <Button variant="ghost" icon="external-link" size="md">All bids (4)</Button>
              <Button variant="secondary" icon="share" size="md">Share read-only</Button>
            </>
          }/>

        {/* DATA */}
        <StateLabel state="DATA" hint="post-analysis · 10 line items mapped · 3 missing scopes flagged"/>
        <HeroBanner/>
        <HeroCharts/>
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><MappingTabs/></div>
          <div className="lg:col-span-1"><NegotiationRail/></div>
        </div>

        {/* EMPTY */}
        <StateLabel state="EMPTY" hint="bid received but not yet analyzed"/>
        <EmptyState
          icon="inbox"
          title="Bid uploaded — analysis pending"
          description="Hollister Builders' bid PDF (4 pages, 47 line items) was ingested 6 minutes ago. Run the analyzer to map line items against your Truth Table."
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" icon="sparkles">Run analysis</Button>
              <Button variant="secondary" icon="eye">View raw bid</Button>
            </div>
          }/>

        {/* LOADING */}
        <StateLabel state="LOADING" hint="analyzer running — embedding line items + computing variances"/>
        <LoadingState/>

        {/* ERROR */}
        <StateLabel state="ERROR" hint="parser failed on bid PDF — likely OCR garble"/>
        <ErrorBanner
          title="Couldn't parse this bid"
          message="The uploaded PDF appears to be a scanned image, not native text. We ran OCR but ~14% of line items came back with unreadable amounts. Re-upload a digitally-generated PDF or paste the bid as text to retry."
          onRetry={()=>{}}
        />
        <div className="mt-6 opacity-50 pointer-events-none">
          <HeroBanner/>
        </div>

        {/* MOBILE */}
        <StateLabel state="MOBILE" hint="375px · charts collapse, tabs become pill scroller"/>
        <div className="flex justify-center pt-4">
          <MobileFrame label="iPhone 15 · 375 · bid detail">
            <BidMobile/>
          </MobileFrame>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<BidAnalyzerPage/>);
