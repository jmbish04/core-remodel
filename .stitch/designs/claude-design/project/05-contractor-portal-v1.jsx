// Surface 5: Contractor Portal — public read-only view via share token.
// CRITICAL CONSTRAINT: ZERO pricing must appear anywhere.

const PORTAL = {
  scenarioName: "Kitchen Downstairs, Family Up",
  scenarioDescription: "Whole-home remodel. Relocate the kitchen to the ground floor with an open dining-living plan; keep the primary suite upstairs. Selective demo, ducted HVAC throughout, mid-tier finishes with one premium counter slab.",
  ownerName: "M. Asado",
  expiresOn: "Jun 12, 2026",
  rooms: [
    { name: "Kitchen", floor: "Main", proposedUse: "Cooking + casual dining for 4", notes: "Island seats 4. Wall ovens, induction range. Honed stone counter run." },
    { name: "Dining", floor: "Main", proposedUse: "Formal dining, 8 seats", notes: "Open to kitchen. Pendant cluster centered on table position." },
    { name: "Living", floor: "Main", proposedUse: "Family living + media", notes: "Flush-mount media wall on north elevation. Refresh fireplace surround." },
    { name: "Powder", floor: "Main", proposedUse: "Guest powder", notes: "New full bath conversion from existing closet — see structural notes." },
    { name: "Primary suite", floor: "Upper", proposedUse: "Owner bedroom + closet", notes: "Existing footprint, refresh finishes only. Bath gut deferred." },
    { name: "Bedroom 2", floor: "Upper", proposedUse: "Child #1", notes: "Refresh; new flooring run continuous from hall." },
    { name: "Bedroom 3", floor: "Upper", proposedUse: "Child #2 / guest", notes: "Refresh; refit closet system." },
    { name: "Hall bath", floor: "Upper", proposedUse: "Shared kids bath", notes: "Full gut. Tile floor + walls, new vanity, single sink." },
    { name: "Laundry", floor: "Upper", proposedUse: "Stacked laundry + linen", notes: "Converted from existing hall bath. Vent through roof." },
    { name: "Office", floor: "Garage attic", proposedUse: "Remote work, two desks", notes: "Phase 2 — informational only." },
  ],
  togglesEnabled: [
    { label: "Kitchen layout · downstairs slab cut", description: "Concrete slab cut for new kitchen plumbing + drainage on the main level.", category: "structural" },
    { label: "Convert hall bath to laundry", description: "Repurpose existing upstairs hall bath as stacked laundry + linen.", category: "structural" },
    { label: "Engineered wood — main level", description: "6\" wide-plank engineered euro oak, matte UV finish.", category: "finish" },
    { label: "Mid-range quartz counters", description: "Quartz across baths + powder; one honed stone slab at kitchen.", category: "finish" },
    { label: "Ducted high-velocity HVAC", description: "Whole-home ducted system, low-profile registers.", category: "systems" },
    { label: "200A panel upgrade", description: "Service panel upgrade required for induction range + EV charger.", category: "systems" },
    { label: "Open dining ↔ kitchen", description: "Remove non-bearing wall between dining + kitchen; new island.", category: "layout" },
  ],
  materialsSelected: [
    { category: "Cabinetry", productName: "Rift white oak slab front, full overlay", brand: "Reform", imageRef: "oak-cabinet" },
    { category: "Countertop", productName: "Calacatta Lincoln honed slab", brand: "Stone Source", imageRef: "calacatta" },
    { category: "Flooring", productName: "6\" engineered euro oak, matte UV", brand: "DuChâteau", imageRef: "engineered-oak" },
    { category: "Plumbing", productName: "Vola HV1 wall-mount lav faucet", brand: "Vola", imageRef: "vola-faucet" },
    { category: "Lighting", productName: "Bocci 28 series — 7 pendant cluster", brand: "Bocci", imageRef: "bocci" },
    { category: "Tile", productName: "Heath 4×4 hand-glazed wall tile, fog", brand: "Heath", imageRef: "heath-tile" },
    { category: "Appliance", productName: "Wolf 48\" dual-fuel range", brand: "Wolf", imageRef: "wolf-range" },
    { category: "Hardware", productName: "Sun Valley Bronze · Foundry knurled pull, 8\"", brand: "Sun Valley", imageRef: "hardware" },
  ],
};

const PORTAL_CATEGORY_META = {
  structural: { tone: "amber", color: "#fbbf24", label: "Structural" },
  finish:     { tone: "emerald", color: "#34d399", label: "Finish" },
  systems:    { tone: "sky", color: "#38bdf8", label: "Systems" },
  layout:     { tone: "violet", color: "#a78bfa", label: "Layout" },
};

// reuse MaterialImage placeholder palette from surface 3 — duplicated here so file is self-contained
function PortalMaterialImage({ id, category }) {
  const palettes = {
    Cabinetry: ["#8b6f4a", "#a48962", "#c9a570", "#4a3a26"],
    Countertop: ["#e5e5e3", "#d4d4d0", "#f0eeea", "#1f1f1f"],
    Flooring: ["#8b6f4a", "#a8896a", "#c9a570", "#6b5238"],
    Plumbing: ["#3f3f46", "#71717a", "#a1a1aa", "#18181b"],
    Lighting: ["#1a1a1a", "#3a3a3a", "#c9a570", "#2a2a2a"],
    Tile: ["#9ca3af", "#6b7280", "#d1d5db", "#4b5563"],
    Appliance: ["#1a1a1a", "#3a3a3a", "#525252", "#0a0a0a"],
    Hardware: ["#5a4530", "#7a623e", "#3a2e1e", "#9a7e58"],
  };
  const colors = palettes[category] || ["#3f3f46","#52525b","#71717a","#27272a"];
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const rand = (mn, mx) => mn + ((h = (h * 9301 + 49297) >>> 0) % 1000) / 1000 * (mx - mn);
  return (
    <div className="aspect-[4/3] w-full overflow-hidden">
      <svg viewBox="0 0 100 75" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="75" fill={colors[0]}/>
        {category === "Countertop" && (
          <>
            <path d={`M0,${rand(15,30)} Q${rand(30,50)},${rand(20,40)} ${rand(55,75)},${rand(30,45)} T100,${rand(40,60)}`} stroke={colors[3]} strokeWidth="0.4" fill="none" opacity="0.6"/>
            <path d={`M0,${rand(40,55)} Q${rand(20,50)},${rand(50,65)} ${rand(60,90)},${rand(55,70)} T100,${rand(55,70)}`} stroke={colors[3]} strokeWidth="0.3" fill="none" opacity="0.5"/>
          </>
        )}
        {category === "Flooring" && Array.from({length: 5}).map((_, i) => (
          <g key={i}>
            <rect x={(i*17 - 20 + (i%2)*8) % 100} y={i*16 + 2} width="40" height="12" fill={colors[Math.floor(rand(0,3))]} opacity={0.6 + (i%3)*0.1}/>
            <rect x={((i*17 - 20 + (i%2)*8) + 42) % 100} y={i*16 + 2} width="40" height="12" fill={colors[Math.floor(rand(0,3))]} opacity={0.6 + ((i+1)%3)*0.1}/>
          </g>
        ))}
        {category === "Cabinetry" && Array.from({length: 12}).map((_, i) => (
          <line key={i} x1="0" y1={i*6 + 2} x2="100" y2={i*6 + 2.5 + rand(-0.4,0.4)} stroke={colors[3]} strokeWidth="0.25" opacity="0.5"/>
        ))}
        {category === "Lighting" && (
          <>
            <radialGradient id={`p-glow-${id}`} cx="50%" cy="40%" r="40%">
              <stop offset="0%" stopColor={colors[2]} stopOpacity="0.4"/>
              <stop offset="100%" stopColor={colors[2]} stopOpacity="0"/>
            </radialGradient>
            <rect width="100" height="75" fill={`url(#p-glow-${id})`}/>
            {[35, 50, 65, 50, 42, 58].map((cx,i) => (
              <circle key={i} cx={cx} cy={15 + i*7 + rand(-2,2)} r={2.5 + rand(0,1)} fill={colors[2]} opacity={0.7 + rand(0,0.3)}/>
            ))}
          </>
        )}
        {category === "Plumbing" && (
          <>
            <rect x="20" y="14" width="60" height="46" rx="5" fill={colors[1]}/>
            <rect x="44" y="22" width="12" height="30" rx="2" fill={colors[2]}/>
            <circle cx="50" cy="56" r="5" fill={colors[3]}/>
          </>
        )}
        {category === "Tile" && Array.from({length: 15}).map((_, i) => {
          const x = (i % 5) * 20, y = Math.floor(i / 5) * 25;
          return <rect key={i} x={x+1} y={y+1} width={18} height={23} fill={colors[Math.floor(rand(0,3))]} opacity={0.7 + (i%4)*0.07}/>;
        })}
        {category === "Appliance" && (
          <>
            <rect x="14" y="12" width="72" height="50" fill={colors[1]} rx="2"/>
            <rect x="20" y="18" width="60" height="28" fill={colors[3]} rx="1"/>
            <circle cx="24" cy="56" r="2.5" fill={colors[2]}/>
            <circle cx="36" cy="56" r="2.5" fill={colors[2]}/>
            <circle cx="64" cy="56" r="2.5" fill={colors[2]}/>
            <circle cx="76" cy="56" r="2.5" fill={colors[2]}/>
          </>
        )}
        {category === "Hardware" && (
          <>
            <rect x="22" y="32" width="56" height="8" rx="4" fill={colors[1]}/>
            {Array.from({length: 8}).map((_, i) => <line key={i} x1={28 + i*6} y1="28" x2={28 + i*6} y2="44" stroke={colors[3]} strokeWidth="0.4"/>)}
            <circle cx="22" cy="36" r="3" fill={colors[3]}/>
            <circle cx="78" cy="36" r="3" fill={colors[3]}/>
          </>
        )}
      </svg>
    </div>
  );
}

// ---------- Portal-specific (quieter) navbar ----------
function PortalNav() {
  return (
    <header className="bg-zinc-950 border-b border-zinc-800">
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-8 h-14">
        <div className="flex items-center gap-3">
          <span className="font-mono tracking-tighter text-zinc-100">
            <span className="text-zinc-500">/</span>the_monolith
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs uppercase tracking-[0.22em] text-zinc-400">Scope preview</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">Shared by <span className="text-zinc-300">{PORTAL.ownerName}</span></span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500">expires <span className="text-zinc-400 font-mono">{PORTAL.expiresOn}</span></span>
          <Chip tone="zinc" icon="lock">read-only</Chip>
        </div>
      </div>
    </header>
  );
}

// ---------- Floor groups for rooms ----------
function RoomsByFloor() {
  const grouped = useMemo(() => {
    const out = {};
    for (const r of PORTAL.rooms) {
      (out[r.floor] = out[r.floor] || []).push(r);
    }
    return out;
  }, []);
  return (
    <div className="space-y-10">
      {Object.entries(grouped).map(([floor, rooms]) => (
        <div key={floor}>
          <div className="flex items-baseline justify-between mb-5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">{floor} level</h3>
            <span className="text-[11px] font-mono text-zinc-600">{rooms.length} rooms</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map(r => {
              const icon = r.name.toLowerCase().includes("bed") ? "bed"
                : r.name.toLowerCase().includes("kitchen") ? "utensils"
                : r.name.toLowerCase().includes("bath") ? "bath"
                : r.name.toLowerCase().includes("powder") ? "bath"
                : "home";
              return (
                <div key={r.name} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-5 transition-all hover:ring-zinc-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon name={icon} size={14} className="text-zinc-500"/>
                        <span className="text-base text-zinc-100 font-medium">{r.name}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{r.proposedUse}</div>
                    </div>
                  </div>
                  {r.notes && (
                    <div className="mt-3 text-sm text-zinc-300 leading-relaxed">{r.notes}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Active toggles, grouped ----------
function ActiveToggles() {
  const grouped = useMemo(() => {
    const out = {};
    for (const t of PORTAL.togglesEnabled) (out[t.category] = out[t.category] || []).push(t);
    return out;
  }, []);
  const order = ["structural","layout","systems","finish"];
  return (
    <div className="space-y-8">
      {order.filter(k => grouped[k]).map(cat => {
        const meta = PORTAL_CATEGORY_META[cat];
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-4">
              <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.22em]" style={{ color: meta.color }}>{meta.label}</h3>
              <span className="text-[11px] font-mono text-zinc-600">{grouped[cat].length}</span>
            </div>
            <div className="space-y-2">
              {grouped[cat].map((t, i) => (
                <div key={i} className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 px-5 py-4 hover:ring-zinc-700 transition-all">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm text-zinc-100 font-medium">{t.label}</div>
                      <div className="mt-1 text-sm text-zinc-400 leading-relaxed max-w-xl">{t.description}</div>
                    </div>
                    <Icon name="check-circle" size={16} className="text-zinc-600 mt-0.5 shrink-0"/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Material grid (read-only) ----------
function PortalMaterials() {
  const grouped = useMemo(() => {
    const out = {};
    for (const m of PORTAL.materialsSelected) (out[m.category] = out[m.category] || []).push(m);
    return out;
  }, []);
  return (
    <div className="space-y-10">
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">{cat}</h3>
            <span className="text-[11px] font-mono text-zinc-600">{items.length}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((m, i) => (
              <div key={i} className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 overflow-hidden hover:ring-zinc-700 transition-all">
                <PortalMaterialImage id={`${cat}-${i}`} category={cat}/>
                <div className="p-4">
                  <div className="text-sm text-zinc-100 font-medium leading-snug">{m.productName}</div>
                  <div className="text-[11px] text-zinc-500 mt-1">{m.brand}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Mobile ----------
function PortalMobile() {
  return (
    <div className="px-4 pb-6">
      <div className="py-4 border-b border-zinc-900">
        <div className="font-mono text-sm tracking-tighter text-zinc-100">/the_monolith</div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mt-1">Scope preview</div>
      </div>
      <div className="py-5">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Scenario</div>
        <h1 className="text-xl font-semibold text-zinc-50 mt-1" style={{ fontFamily: '"Newsreader", serif', fontWeight: 500 }}>{PORTAL.scenarioName}</h1>
        <p className="mt-3 text-[13px] text-zinc-400 leading-relaxed">{PORTAL.scenarioDescription}</p>
      </div>
      <div className="space-y-6">
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Rooms · 10</h3>
          <div className="space-y-2">
            {PORTAL.rooms.slice(0,4).map(r => (
              <div key={r.name} className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-100 font-medium">{r.name}</span>
                  <span className="text-[10px] text-zinc-500">{r.floor}</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{r.proposedUse}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Active toggles · 7</h3>
          <div className="space-y-2">
            {PORTAL.togglesEnabled.slice(0,4).map((t,i) => {
              const meta = PORTAL_CATEGORY_META[t.category];
              return (
                <div key={i} className="rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/40 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  <div className="text-sm text-zinc-100">{t.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Loading ----------
function LoadingState() {
  return (
    <div className="space-y-10">
      <div><Skeleton className="h-5 w-32 mb-4"/><Skeleton className="h-10 w-96 mb-3"/><Skeleton className="h-4 w-full max-w-3xl"/></div>
      <div className="grid grid-cols-3 gap-4">
        {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-32 rounded-xl"/>)}
      </div>
      <div className="space-y-3">
        {[0,1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl"/>)}
      </div>
    </div>
  );
}

// ---------- Page ----------
function ContractorPortalPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <PortalNav/>
      <div className="mx-auto max-w-[1200px] px-8 pb-32">

        {/* DATA */}
        <StateLabel state="DATA" hint="contractor view · zero pricing visible anywhere on this surface"/>

        {/* Section 1 — Summary */}
        <section className="pt-16 pb-14">
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-5">Scope</div>
          <h1 className="text-4xl md:text-5xl tracking-tight text-zinc-50 leading-[1.05] max-w-3xl"
              style={{ fontFamily: '"Newsreader", ui-serif, Georgia, serif', fontWeight: 500 }}>
            {PORTAL.scenarioName}
          </h1>
          <p className="mt-7 text-base text-zinc-400 leading-relaxed max-w-2xl">{PORTAL.scenarioDescription}</p>
          <div className="mt-8 flex items-center gap-6 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-2"><Icon name="home" size={13}/> 10 rooms across 3 levels</span>
            <span className="inline-flex items-center gap-2"><Icon name="layers" size={13}/> 7 active scope toggles</span>
            <span className="inline-flex items-center gap-2"><Icon name="package" size={13}/> 8 material specs</span>
          </div>
        </section>

        {/* Section 2 — Rooms */}
        <section className="pt-10 pb-14">
          <header className="mb-10">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-3">Section 1</div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">Rooms</h2>
            <p className="mt-2 text-sm text-zinc-500 max-w-xl">Use this layout for bidding takeoff. Reach out with questions before walk-through.</p>
          </header>
          <RoomsByFloor/>
        </section>

        {/* Section 3 — Active toggles */}
        <section className="pt-10 pb-14">
          <header className="mb-10">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-3">Section 2</div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">Active scope toggles</h2>
            <p className="mt-2 text-sm text-zinc-500 max-w-xl">High-level decisions locked for this scenario. Each affects the trade mix.</p>
          </header>
          <ActiveToggles/>
        </section>

        {/* Section 4 — Materials */}
        <section className="pt-10 pb-14">
          <header className="mb-10">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-3">Section 3</div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">Material selections</h2>
            <p className="mt-2 text-sm text-zinc-500 max-w-xl">Specified by the owner. Sources noted where useful — confirm availability when bidding.</p>
          </header>
          <PortalMaterials/>
        </section>

        {/* Footer */}
        <footer className="pt-12 pb-4 mt-10">
          <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 p-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-zinc-200">Questions or clarifications?</div>
              <div className="text-xs text-zinc-500 mt-0.5">Reply to the email this link was shared from. We'll respond within 1 business day.</div>
            </div>
            <Button variant="secondary" icon="send">Request walk-through</Button>
          </div>
          <div className="mt-8 flex items-center justify-between text-[11px] text-zinc-600">
            <span>The Monolith · v3 · {PORTAL.expiresOn}</span>
            <span className="font-mono">share_token: tk_a4f9_…</span>
          </div>
        </footer>

        {/* EMPTY */}
        <StateLabel state="EMPTY" hint="share link valid but scenario has no scope yet"/>
        <EmptyState
          icon="file-text"
          title="This scope is being prepared"
          description="The owner has shared a link, but no rooms, toggles, or materials have been published yet. Check back after they've finalized the scenario."
          action={<Button variant="secondary" icon="bell">Notify me when ready</Button>}
        />

        {/* LOADING */}
        <StateLabel state="LOADING" hint="initial portal load"/>
        <LoadingState/>

        {/* ERROR */}
        <StateLabel state="ERROR" hint="share token expired or revoked"/>
        <div className="rounded-xl bg-rose-950/40 ring-1 ring-rose-500/30 text-rose-200 p-6">
          <div className="flex items-start gap-4">
            <Icon name="lock" size={20} className="text-rose-300 mt-0.5"/>
            <div className="flex-1">
              <div className="text-sm font-medium text-rose-100">This share link has expired</div>
              <div className="mt-2 text-sm text-rose-300/90 leading-relaxed max-w-xl">
                The owner shared this on Apr 14, 2026 and it was valid for 30 days. Reach out to <span className="font-mono">{PORTAL.ownerName}</span> for a fresh link.
              </div>
            </div>
            <Button variant="danger" icon="send" size="sm">Request new link</Button>
          </div>
        </div>

        {/* MOBILE */}
        <StateLabel state="MOBILE" hint="375px · single-column flow, sections collapse"/>
        <div className="flex justify-center pt-4">
          <MobileFrame label="iPhone 15 · 375 · contractor portal">
            <PortalMobile/>
          </MobileFrame>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ContractorPortalPage/>);
