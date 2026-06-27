// Surface 3: Material Cart (grid view) + Compare drawer.

const MATERIALS = [
  { id:"m01", category:"countertop", productName:"Calacatta Lincoln honed slab", brand:"Stone Source", sku:"CL-128H", sourceUrl:"#", sourceVendor:"Stone Source SF", primaryImageUrl:"calacatta", unit:"slab", unitPriceCents:920000, leadTimeDays:21, status:"selected", scoreAesthetic:5, scoreDurability:4, scoreValue:3, roomAssignments:[{ roomName:"Kitchen", quantity:2 }], aiSummary:"Premium Italian marble. Honed finish hides etching better than polished." },
  { id:"m02", category:"cabinetry", productName:"Rift white oak slab front, full overlay", brand:"Reform", sku:"RF-OAK-FO", sourceUrl:"#", sourceVendor:"Reform CPH", primaryImageUrl:"oak-cabinet", unit:"linear ft", unitPriceCents:48000, leadTimeDays:62, status:"selected", scoreAesthetic:5, scoreDurability:5, scoreValue:4, roomAssignments:[{ roomName:"Kitchen", quantity:38 }], aiSummary:"Long lead time but unmatched grain consistency. Confirmed in stock as of 5/8." },
  { id:"m03", category:"flooring", productName:"7\" wide-plank white oak, matte oil finish", brand:"Carlisle", sku:"CWP-7-MO", sourceUrl:"#", sourceVendor:"Carlisle Direct", primaryImageUrl:"oak-floor", unit:"sf", unitPriceCents:1480, leadTimeDays:35, status:"shortlist", scoreAesthetic:5, scoreDurability:4, scoreValue:3, roomAssignments:[{ roomName:"Main level", quantity:680 }, { roomName:"Upper hall", quantity:120 }], aiSummary:"Site-finished only. Need flooring sub confirmation before order." },
  { id:"m04", category:"flooring", productName:"6\" engineered euro oak, matte UV", brand:"DuChâteau", sku:"DC-EO-6", sourceUrl:"#", sourceVendor:"DuChâteau LA", primaryImageUrl:"engineered-oak", unit:"sf", unitPriceCents:980, leadTimeDays:14, status:"shortlist", scoreAesthetic:4, scoreDurability:4, scoreValue:5, roomAssignments:[{ roomName:"Main level", quantity:680 }], aiSummary:"Pre-finished alternative. Saves ~$3.4k vs site-finished." },
  { id:"m05", category:"flooring", productName:"5\" white oak engineered, satin lacquer", brand:"Mirage", sku:"MIR-WO-5", sourceUrl:"#", sourceVendor:"Galleher", primaryImageUrl:"mirage-floor", unit:"sf", unitPriceCents:680, leadTimeDays:7, status:"considering", scoreAesthetic:3, scoreDurability:4, scoreValue:5, roomAssignments:[{ roomName:"Upper level", quantity:540 }], aiSummary:"Budget option. Acceptable for bedroom level." },
  { id:"m06", category:"plumbing_fixture", productName:"Vola HV1 wall-mount lav faucet", brand:"Vola", sku:"HV1-16", sourceUrl:"#", sourceVendor:"Vola US", primaryImageUrl:"vola-faucet", unit:"ea", unitPriceCents:148000, leadTimeDays:56, status:"selected", scoreAesthetic:5, scoreDurability:5, scoreValue:3, roomAssignments:[{ roomName:"Primary bath", quantity:1 }], aiSummary:"Wall-mount requires plumbing in stud — coordinate with rough." },
  { id:"m07", category:"plumbing_fixture", productName:"Toto Neorest 750H smart toilet", brand:"Toto", sku:"NR-750H", sourceUrl:"#", sourceVendor:"Ferguson", primaryImageUrl:"toto-toilet", unit:"ea", unitPriceCents:680000, leadTimeDays:21, status:"considering", scoreAesthetic:4, scoreDurability:5, scoreValue:2, roomAssignments:[{ roomName:"Primary bath", quantity:1 }], aiSummary:"Mark called this 'over the line.' Hold until end of fixture spec." },
  { id:"m08", category:"lighting", productName:"Bocci 28 series — 7 pendant cluster", brand:"Bocci", sku:"28.7-CL", sourceUrl:"#", sourceVendor:"Lumens", primaryImageUrl:"bocci", unit:"set", unitPriceCents:840000, leadTimeDays:42, status:"shortlist", scoreAesthetic:5, scoreDurability:4, scoreValue:2, roomAssignments:[{ roomName:"Dining", quantity:1 }], aiSummary:"Visual centerpiece. Vetted with structural for support detail." },
  { id:"m09", category:"lighting", productName:"Apparatus Cloud 19 chandelier", brand:"Apparatus", sku:"CL-19", sourceUrl:"#", sourceVendor:"Apparatus NYC", primaryImageUrl:"apparatus", unit:"ea", unitPriceCents:1280000, leadTimeDays:112, status:"rejected", scoreAesthetic:5, scoreDurability:4, scoreValue:1, roomAssignments:[], aiSummary:"Lead time pushes past dining install. Rejected on schedule." },
  { id:"m10", category:"tile", productName:"Heath 4x4 hand-glazed wall tile, fog", brand:"Heath", sku:"H-4-FOG", sourceUrl:"#", sourceVendor:"Heath SF", primaryImageUrl:"heath-tile", unit:"sf", unitPriceCents:4200, leadTimeDays:84, status:"shortlist", scoreAesthetic:5, scoreDurability:4, scoreValue:3, roomAssignments:[{ roomName:"Primary bath", quantity:180 }], aiSummary:"Variation desired but ask about shade lot before locking." },
  { id:"m11", category:"appliance", productName:"Wolf 48\" dual-fuel range, sealed burners", brand:"Wolf", sku:"DF48-G", sourceUrl:"#", sourceVendor:"Sub-Zero Wolf", primaryImageUrl:"wolf-range", unit:"ea", unitPriceCents:1280000, leadTimeDays:84, status:"selected", scoreAesthetic:5, scoreDurability:5, scoreValue:4, roomAssignments:[{ roomName:"Kitchen", quantity:1 }], aiSummary:"Order placed 4/18. ETA 7/11." },
  { id:"m12", category:"hardware", productName:"Sun Valley Bronze — Foundry knurled pull, 8\"", brand:"Sun Valley", sku:"SVB-FK-8", sourceUrl:"#", sourceVendor:"SVB Direct", primaryImageUrl:"hardware", unit:"ea", unitPriceCents:24800, leadTimeDays:28, status:"selected", scoreAesthetic:5, scoreDurability:5, scoreValue:3, roomAssignments:[{ roomName:"Kitchen", quantity:24 }], aiSummary:"Solid bronze, will patina. Match across kitchen + butlery." },
];

const CATEGORY_LABEL = {
  cabinetry: "Cabinetry", countertop: "Countertop", flooring: "Flooring", lighting: "Lighting",
  plumbing_fixture: "Plumbing", tile: "Tile", hardware: "Hardware", appliance: "Appliance",
};

const STATUS_TONE = { considering: "zinc", shortlist: "sky", selected: "emerald", rejected: "zinc", purchased: "violet" };

// Placeholder image — abstract material swatch, color-coded
function MaterialImage({ id, category, status, className = "" }) {
  const palettes = {
    countertop: ["#e5e5e3", "#d4d4d0", "#f0eeea", "#1f1f1f"],
    cabinetry: ["#8b6f4a", "#a48962", "#c9a570", "#4a3a26"],
    flooring: ["#8b6f4a", "#a8896a", "#c9a570", "#6b5238"],
    lighting: ["#1a1a1a", "#3a3a3a", "#c9a570", "#2a2a2a"],
    plumbing_fixture: ["#3f3f46", "#71717a", "#a1a1aa", "#18181b"],
    tile: ["#9ca3af", "#6b7280", "#d1d5db", "#4b5563"],
    hardware: ["#5a4530", "#7a623e", "#3a2e1e", "#9a7e58"],
    appliance: ["#1a1a1a", "#3a3a3a", "#525252", "#0a0a0a"],
  };
  const colors = palettes[category] || ["#3f3f46","#52525b","#71717a","#27272a"];
  const grayscale = status === "rejected" ? "grayscale(1) opacity(0.45)" : "";
  // generate a deterministic abstract composition from id hash
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const rand = (mn, mx) => mn + ((h = (h * 9301 + 49297) >>> 0) % 1000) / 1000 * (mx - mn);

  // Different composition per category
  const renderComposition = () => {
    if (category === "countertop") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          <path d={`M0,${rand(20,40)} Q${rand(30,50)},${rand(30,60)} ${rand(55,75)},${rand(40,60)} T100,${rand(60,80)}`} stroke={colors[3]} strokeWidth="0.4" fill="none" opacity="0.6"/>
          <path d={`M0,${rand(50,70)} Q${rand(20,50)},${rand(60,80)} ${rand(60,90)},${rand(70,90)} T100,${rand(70,90)}`} stroke={colors[3]} strokeWidth="0.3" fill="none" opacity="0.5"/>
          <path d={`M${rand(20,40)},0 L${rand(40,60)},${rand(40,80)} L${rand(60,90)},100`} stroke={colors[3]} strokeWidth="0.25" fill="none" opacity="0.4"/>
        </>
      );
    }
    if (category === "flooring") {
      const plankH = 14;
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          {Array.from({length: 7}).map((_, i) => (
            <g key={i}>
              <rect x={(i*17 - 30 + (i%2)*8) % 100} y={i*plankH + 2} width="40" height={plankH-2} fill={colors[Math.floor(rand(0,3))]} opacity={0.6 + (i%3)*0.1}/>
              <rect x={((i*17 - 30 + (i%2)*8) + 42) % 100} y={i*plankH + 2} width="40" height={plankH-2} fill={colors[Math.floor(rand(0,3))]} opacity={0.6 + ((i+1)%3)*0.1}/>
            </g>
          ))}
        </>
      );
    }
    if (category === "cabinetry") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          {Array.from({length: 16}).map((_, i) => (
            <line key={i} x1="0" y1={i*6 + 2} x2="100" y2={i*6 + 2.5 + rand(-0.4,0.4)} stroke={colors[3]} strokeWidth="0.25" opacity="0.5"/>
          ))}
          <rect x="42" y="58" width="3" height="14" rx="1" fill={colors[3]}/>
        </>
      );
    }
    if (category === "lighting") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          <radialGradient id={`glow-${id}`} cx="50%" cy="40%" r="40%">
            <stop offset="0%" stopColor={colors[2]} stopOpacity="0.4"/>
            <stop offset="100%" stopColor={colors[2]} stopOpacity="0"/>
          </radialGradient>
          <rect width="100" height="100" fill={`url(#glow-${id})`}/>
          {[35, 50, 65, 50, 42, 58].map((cx,i) => (
            <circle key={i} cx={cx} cy={20 + i*8 + rand(-2,2)} r={3 + rand(0,1.5)} fill={colors[2]} opacity={0.7 + rand(0,0.3)}/>
          ))}
        </>
      );
    }
    if (category === "plumbing_fixture") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          <rect x="20" y="20" width="60" height="60" rx="6" fill={colors[1]}/>
          <rect x="44" y="30" width="12" height="40" rx="2" fill={colors[2]}/>
          <circle cx="50" cy="74" r="6" fill={colors[3]}/>
        </>
      );
    }
    if (category === "tile") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          {Array.from({length: 25}).map((_, i) => {
            const x = (i % 5) * 20, y = Math.floor(i / 5) * 20;
            return <rect key={i} x={x+1} y={y+1} width={18} height={18} fill={colors[Math.floor(rand(0,3))]} opacity={0.7 + (i%4)*0.07}/>;
          })}
        </>
      );
    }
    if (category === "appliance") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          <rect x="14" y="20" width="72" height="60" fill={colors[1]} rx="2"/>
          <rect x="20" y="28" width="60" height="32" fill={colors[3]} rx="1"/>
          <circle cx="24" cy="68" r="3" fill={colors[2]}/>
          <circle cx="36" cy="68" r="3" fill={colors[2]}/>
          <circle cx="64" cy="68" r="3" fill={colors[2]}/>
          <circle cx="76" cy="68" r="3" fill={colors[2]}/>
        </>
      );
    }
    if (category === "hardware") {
      return (
        <>
          <rect width="100" height="100" fill={colors[0]}/>
          <rect x="22" y="46" width="56" height="8" rx="4" fill={colors[1]}/>
          {Array.from({length: 8}).map((_, i) => <line key={i} x1={28 + i*6} y1="42" x2={28 + i*6} y2="58" stroke={colors[3]} strokeWidth="0.4"/>)}
          <circle cx="22" cy="50" r="3" fill={colors[3]}/>
          <circle cx="78" cy="50" r="3" fill={colors[3]}/>
        </>
      );
    }
    return <rect width="100" height="100" fill={colors[0]}/>;
  };

  return (
    <div className={`relative w-full aspect-square overflow-hidden ${className}`} style={{ filter: grayscale }}>
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        {renderComposition()}
      </svg>
    </div>
  );
}

// ---------- Material Card ----------
function MaterialCard({ m, selected, onToggleCompare }) {
  return (
    <div className="group rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 transition-all duration-300 hover:ring-zinc-700 overflow-hidden flex flex-col">
      <div className="relative">
        <MaterialImage id={m.id} category={m.category} status={m.status}/>
        {/* status chip */}
        <div className="absolute top-3 left-3">
          <Chip tone={STATUS_TONE[m.status]} className="!bg-zinc-950/70 !backdrop-blur-sm">{m.status}</Chip>
        </div>
        {/* compare checkbox top-right */}
        <button onClick={onToggleCompare}
          className={`absolute top-3 right-3 size-7 grid place-items-center rounded-md transition-all ${selected ? "bg-emerald-400 text-zinc-950" : "bg-zinc-950/60 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-zinc-900"}`}>
          <Icon name={selected ? "check" : "plus"} size={14} strokeWidth={selected ? 3 : 1.75}/>
        </button>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{CATEGORY_LABEL[m.category]}</div>
            <div className="text-sm font-medium text-zinc-100 leading-snug">{m.productName}</div>
            <div className="text-xs text-zinc-500 mt-1">{m.brand}</div>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-base font-mono tabular-nums text-zinc-50 font-medium">{fmtCents(m.unitPriceCents)}</div>
            <div className="text-[10px] text-zinc-500">/{m.unit}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {m.leadTimeDays !== null && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${m.leadTimeDays > 60 ? "bg-amber-400/10 text-amber-300" : "bg-zinc-800 text-zinc-400"}`}>
                {m.leadTimeDays}d lead
              </span>
            )}
          </div>
        </div>
        {m.roomAssignments.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {m.roomAssignments.map((r, i) => (
              <span key={i} className="text-[10px] text-zinc-400 bg-zinc-800/60 rounded-sm px-1.5 py-0.5">
                {r.roomName} <span className="text-zinc-500 font-mono">· {r.quantity}</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto pt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="h-7 px-2 text-[11px] rounded-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 inline-flex items-center gap-1">
            <Icon name="edit" size={11}/> Edit
          </button>
          <button className="h-7 px-2 text-[11px] rounded-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 inline-flex items-center gap-1">
            <Icon name="archive" size={11}/> Archive
          </button>
          <button className="h-7 px-2 text-[11px] rounded-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 inline-flex items-center gap-1">
            <Icon name="external-link" size={11}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Intake bar ----------
function IntakeBar() {
  return (
    <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-3 flex items-center gap-2 flex-wrap">
      <Button variant="secondary" icon="camera" size="sm">Snap photo</Button>
      <div className="h-7 w-px bg-zinc-800"></div>
      <Input icon="link" placeholder="Paste vendor URL — we'll fetch the spec" className="flex-1 min-w-[280px]"/>
      <Button variant="secondary" icon="sparkles" size="sm">Quick add drawer</Button>
      <div className="ml-auto text-[11px] text-zinc-500 font-mono">{MATERIALS.length} items · {MATERIALS.filter(m=>m.status==="selected").length} selected</div>
    </div>
  );
}

// ---------- Category pills ----------
function CategoryPills({ active, onChange, counts }) {
  const cats = [
    { id:"all", label:"All", count: counts.all },
    ...Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label, count: counts[id] || 0 }))
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {cats.map(c => (
        <button key={c.id} onClick={() => onChange(c.id)}
          className={`shrink-0 h-8 px-3 text-xs rounded-full transition-colors ${active === c.id ? "bg-zinc-100 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800 hover:ring-zinc-700"}`}>
          {c.label}
          <span className={`ml-2 font-mono tabular-nums text-[10px] ${active === c.id ? "text-zinc-500" : "text-zinc-600"}`}>{c.count}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- Compare tray (sticky bottom) ----------
function CompareTray({ selected, onOpen, onClear }) {
  if (selected.length < 2) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-xl bg-zinc-900 ring-1 ring-zinc-700 shadow-xl shadow-black/40 flex items-center gap-3 p-2 pr-3">
      <div className="flex -space-x-2 pl-1">
        {selected.slice(0, 4).map(m => (
          <div key={m.id} className="size-9 rounded-lg ring-2 ring-zinc-900 bg-zinc-800 overflow-hidden">
            <MaterialImage id={m.id} category={m.category} status={m.status}/>
          </div>
        ))}
      </div>
      <div className="text-sm text-zinc-200">
        <span className="font-mono tabular-nums text-zinc-100">{selected.length}</span> selected
      </div>
      <Button variant="primary" size="sm" iconRight="arrow-right" onClick={onOpen}>Compare</Button>
      <button onClick={onClear} className="size-7 grid place-items-center text-zinc-500 hover:text-zinc-200">
        <Icon name="x" size={14}/>
      </button>
    </div>
  );
}

// ---------- Compare drawer ----------
function CompareDrawer({ items }) {
  const StarRow = ({ value }) => (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <div key={i} className={`size-2 rounded-full ${i <= value ? "bg-zinc-100" : "bg-zinc-800"}`}></div>
      ))}
      <span className="ml-1 text-[11px] font-mono tabular-nums text-zinc-500">{value}/5</span>
    </div>
  );

  const rows = [
    { label: "Brand", get: m => m.brand },
    { label: "SKU", get: m => <span className="font-mono">{m.sku}</span> },
    { label: "Unit price", get: m => <span className="font-mono tabular-nums text-zinc-100">{fmtCents(m.unitPriceCents)} <span className="text-zinc-500">/{m.unit}</span></span> },
    { label: "Lead time", get: m => <span className={m.leadTimeDays > 60 ? "text-amber-300" : ""}>{m.leadTimeDays}d</span> },
    { label: "Aesthetic", get: m => <StarRow value={m.scoreAesthetic}/> },
    { label: "Durability", get: m => <StarRow value={m.scoreDurability}/> },
    { label: "Value", get: m => <StarRow value={m.scoreValue}/> },
    { label: "Status", get: m => <Chip tone={STATUS_TONE[m.status]}>{m.status}</Chip> },
    { label: "AI summary", get: m => <span className="text-xs text-zinc-400">{m.aiSummary}</span> },
  ];

  return (
    <div className="rounded-xl bg-zinc-950 ring-1 ring-zinc-800/60 overflow-hidden">
      {/* drawer header */}
      <div className="px-6 py-4 flex items-center justify-between bg-zinc-900/60">
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Compare drawer</div>
          <div className="text-sm text-zinc-200">{items.length} materials</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon="copy" size="sm">Save view</Button>
          <Button variant="ghost" icon="x" size="sm">Close</Button>
        </div>
      </div>
      {/* drawer body */}
      <div className="grid divide-x divide-zinc-800/60" style={{ gridTemplateColumns: `160px repeat(${items.length}, minmax(0, 1fr))` }}>
        {/* column headers */}
        <div className="bg-zinc-900/40 px-5 py-5"></div>
        {items.map(m => (
          <div key={m.id} className="px-5 py-5 bg-zinc-900/40">
            <div className="aspect-square rounded-lg overflow-hidden mb-3">
              <MaterialImage id={m.id} category={m.category} status={m.status}/>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{CATEGORY_LABEL[m.category]}</div>
            <div className="text-sm font-medium text-zinc-100 leading-snug">{m.productName}</div>
          </div>
        ))}
        {/* rows */}
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "contents" }}>
            <div className={`px-5 py-4 text-[11px] uppercase tracking-wider text-zinc-500 ${ri > 0 ? "border-t-0" : ""}`} style={{ borderTop: "1px solid rgba(39,39,42,0.6)" }}>{row.label}</div>
            {items.map(m => (
              <div key={m.id} className="px-5 py-4 text-sm text-zinc-200" style={{ borderTop: "1px solid rgba(39,39,42,0.6)" }}>
                {row.get(m)}
              </div>
            ))}
          </div>
        ))}
        {/* action row */}
        <div className="px-5 py-5" style={{ borderTop: "1px solid rgba(39,39,42,0.6)" }}></div>
        {items.map(m => (
          <div key={m.id} className="px-5 py-5" style={{ borderTop: "1px solid rgba(39,39,42,0.6)" }}>
            <Button variant={m.status === "selected" ? "accent" : "primary"} size="sm" icon={m.status === "selected" ? "check" : undefined} className="w-full">
              {m.status === "selected" ? "Already selected" : "Decide on this one"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Mobile material card ----------
function MaterialMobile() {
  const items = MATERIALS.slice(0, 6);
  return (
    <div className="px-4 pb-6">
      <div className="py-4">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Procurement</div>
        <h1 className="text-2xl font-semibold text-zinc-50">Material Cart</h1>
        <p className="mt-1 text-xs text-zinc-400">12 items · 5 selected</p>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Button variant="secondary" icon="camera" size="sm" className="flex-1">Snap</Button>
        <Button variant="secondary" icon="link" size="sm" className="flex-1">Paste URL</Button>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 pb-2 mb-3">
        {["All","Cabinet","Counter","Flooring","Lighting","Tile"].map((c,i) => (
          <button key={c} className={`shrink-0 h-7 px-3 text-xs rounded-full ${i===0 ? "bg-zinc-100 text-zinc-950" : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800"}`}>{c}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(m => (
          <div key={m.id} className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 overflow-hidden">
            <div className="relative">
              <MaterialImage id={m.id} category={m.category} status={m.status}/>
              <div className="absolute top-2 left-2">
                <Chip tone={STATUS_TONE[m.status]} className="!text-[9px] !px-1.5 !py-0">{m.status}</Chip>
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[10px] uppercase text-zinc-500 mb-0.5">{CATEGORY_LABEL[m.category]}</div>
              <div className="text-[12px] font-medium text-zinc-100 leading-tight line-clamp-2">{m.productName}</div>
              <div className="mt-1 text-sm font-mono tabular-nums text-zinc-100">{fmtCents(m.unitPriceCents)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Loading ----------
function LoadingState() {
  return (
    <div>
      <Skeleton className="h-14 rounded-xl mb-5"/>
      <div className="flex gap-2 mb-5">
        {[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-20 rounded-full"/>)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0,1,2,3,4,5,6,7].map(i => (
          <div key={i} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 overflow-hidden">
            <Skeleton className="aspect-square rounded-none"/>
            <div className="p-4">
              <Skeleton className="h-3 w-20 mb-2"/>
              <Skeleton className="h-4 w-full mb-1"/>
              <Skeleton className="h-3 w-3/4 mb-3"/>
              <Skeleton className="h-5 w-20"/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Page ----------
function MaterialCartPage() {
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState(["m03","m04","m05"]);

  const counts = useMemo(() => {
    const out = { all: MATERIALS.length };
    for (const m of MATERIALS) out[m.category] = (out[m.category] || 0) + 1;
    return out;
  }, []);

  const filtered = useMemo(() => cat === "all" ? MATERIALS : MATERIALS.filter(m => m.category === cat), [cat]);
  const compareItems = useMemo(() => MATERIALS.filter(m => selected.includes(m.id)), [selected]);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <Navbar active="materials" surface="Materials"/>
      <div className="mx-auto max-w-[1400px] px-6 pb-32">
        <PageHeader
          eyebrow="Procurement"
          title="Material Cart"
          description="Tracking finishes, fixtures, and appliances under consideration. Pull from product URLs, photos, or pasted SKUs."
          actions={
            <>
              <Button variant="ghost" icon="filter" size="md">Filter</Button>
              <Button variant="secondary" icon="share" size="md">Share with designer</Button>
              <Button variant="primary" icon="plus" size="md">Add material</Button>
            </>
          }
        />

        {/* DATA */}
        <StateLabel state="DATA" hint="grid · 3 items selected → compare tray surfaces at bottom"/>
        <IntakeBar/>
        <div className="mt-5"><CategoryPills active={cat} onChange={setCat} counts={counts}/></div>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(m => (
            <MaterialCard key={m.id} m={m}
              selected={selected.includes(m.id)}
              onToggleCompare={() => toggle(m.id)}/>
          ))}
        </div>
        <CompareTray selected={compareItems} onOpen={()=>{}} onClear={()=>setSelected([])}/>

        {/* COMPARE DRAWER */}
        <StateLabel state="DATA · COMPARE" hint="three flooring options side-by-side"/>
        <CompareDrawer items={compareItems}/>

        {/* EMPTY */}
        <StateLabel state="EMPTY" hint="brand-new project — no materials added yet"/>
        <IntakeBar/>
        <div className="mt-5">
          <EmptyState
            icon="package"
            title="Your cart is empty"
            description="Snap a photo of a showroom display, paste a vendor URL, or import from your Pinterest mood board to populate."
            action={
              <div className="flex items-center gap-2">
                <Button variant="primary" icon="camera">Start with a photo</Button>
                <Button variant="secondary" icon="link">Paste URL</Button>
              </div>
            }/>
        </div>

        {/* LOADING */}
        <StateLabel state="LOADING" hint="fetching specs from 4 vendors + generating AI summaries"/>
        <LoadingState/>

        {/* ERROR */}
        <StateLabel state="ERROR" hint="vendor URL paste failed — bot challenge"/>
        <ErrorBanner
          title="Couldn't fetch that product page"
          message="Reform.cph blocked the scrape with a bot challenge. We can retry through the proxy or you can save the page as PDF and drop it in instead."
          onRetry={()=>{}}
        />
        <div className="mt-6 opacity-50 pointer-events-none">
          <div className="grid grid-cols-4 gap-4">
            {MATERIALS.slice(0,4).map(m => <MaterialCard key={m.id} m={m} selected={false} onToggleCompare={()=>{}}/>)}
          </div>
        </div>

        {/* MOBILE */}
        <StateLabel state="MOBILE" hint="375px · 2-col grid, intake collapses to two pills"/>
        <div className="flex justify-center pt-4">
          <MobileFrame>
            <MaterialMobile/>
          </MobileFrame>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<MaterialCartPage/>);
