// Surface 5 (v2): Contractor Portal — interactive, with floor plans, photos, room detail,
// bid mechanic w/ AI validation, and contextual assistant. ZERO pricing of homeowner's budget anywhere.
// (Contractor's OWN bid prices ARE shown — they're the contractor's input.)

// ---------- Lightbox state hook ----------
function useLightbox() {
  const [active, setActive] = useState(null);
  return { active, open: (p) => setActive(p), close: () => setActive(null) };
}

// ---------- Portal nav (with bid pill) ----------
function PortalNav({ bidTotal, bidCount, onOpenBid }) {
  return (
    <header className="bg-zinc-950 border-b border-zinc-800 sticky top-0 z-30">
      <div className="mx-auto max-w-[1280px] flex items-center justify-between px-8 h-14">
        <div className="flex items-center gap-3">
          <span className="font-mono tracking-tighter text-zinc-100">
            <span className="text-zinc-500">/</span>the_monolith
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs uppercase tracking-[0.22em] text-zinc-400">Scope &amp; bid portal</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="hidden md:inline text-zinc-500">Shared by <span className="text-zinc-300">{OWNER.name}</span></span>
          <span className="hidden md:inline text-zinc-700">·</span>
          <span className="hidden md:inline text-zinc-500">expires <span className="text-zinc-400 font-mono">{PROJECT.expiresOn}</span></span>
          <button onClick={onOpenBid}
            className="ml-2 inline-flex items-center gap-2 px-3 h-9 rounded-md bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800 hover:ring-zinc-700 transition-all">
            <Chip tone="amber" className="!text-[10px] !px-1.5 !py-0">Draft</Chip>
            <span className="text-[12px] font-mono tabular-nums">
              {bidCount > 0 ? `${fmtCents(bidTotal.min)} – ${fmtCents(bidTotal.max)}` : "Your bid"}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">{bidCount}</span>
            <Icon name="chevron-right" size={12} className="text-zinc-500"/>
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------- Owner intro + welcome ----------
function OwnerWelcome() {
  return (
    <section className="pt-14 pb-12">
      <div className="flex items-start gap-6 mb-6">
        <div className="size-12 rounded-full bg-zinc-900 ring-1 ring-zinc-800 grid place-items-center text-zinc-300 font-medium text-sm font-mono">
          {OWNER.initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">A note from the owner</div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl tracking-tight text-zinc-50"
                style={{ fontFamily: '"Newsreader", ui-serif, Georgia, serif', fontWeight: 500 }}>
              Welcome, and thank you.
            </h1>
            <span className="text-xs text-zinc-500 font-mono">— {OWNER.name}</span>
          </div>
        </div>
      </div>
      <p className="text-base text-zinc-300 leading-relaxed max-w-3xl">{OWNER.greeting}</p>
      <div className="mt-6 flex items-center gap-3 flex-wrap text-[12px]">
        <a href={`mailto:${OWNER.email}`} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100">
          <Icon name="send" size={12}/> {OWNER.email}
        </a>
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-500 font-mono">{PROJECT.address}, {PROJECT.city}</span>
      </div>
    </section>
  );
}

// ---------- Project header ----------
function ProjectHeader() {
  return (
    <section className="pb-12">
      <div className="rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800/40 p-8">
        <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-4">Scope</div>
        <h2 className="text-4xl tracking-tight text-zinc-50 leading-[1.05] max-w-3xl"
            style={{ fontFamily: '"Newsreader", ui-serif, Georgia, serif', fontWeight: 500 }}>
          {PROJECT.scenarioName}
        </h2>
        <p className="mt-6 text-base text-zinc-400 leading-relaxed max-w-2xl">{PROJECT.scenarioDescription}</p>
        <div className="mt-8 flex items-center gap-6 flex-wrap text-xs text-zinc-500">
          <span className="inline-flex items-center gap-2"><Icon name="home" size={13}/> 20 rooms across 2 levels</span>
          <span className="inline-flex items-center gap-2"><Icon name="layers" size={13}/> {TOGGLES_PUBLISHED.length} active scope toggles</span>
          <span className="inline-flex items-center gap-2"><Icon name="package" size={13}/> {PORTAL_MATERIALS.length} material specs</span>
          <span className="inline-flex items-center gap-2"><Icon name="file-text" size={13}/> {DOCS.length} supporting docs</span>
        </div>
      </div>
    </section>
  );
}

// ---------- Collaborators ----------
function CollaboratorsSection() {
  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Project team</div>
          <h2 className="text-xl font-semibold text-zinc-100">Who you'll be working with</h2>
        </div>
        <span className="text-[11px] font-mono text-zinc-600">{COLLABORATORS.length} collaborators</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {COLLABORATORS.map(c => (
          <div key={c.role} className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 px-5 py-4 hover:ring-zinc-700 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-1">{c.role}</div>
                <div className="text-sm font-medium text-zinc-100">{c.name}</div>
                <div className="text-[12px] text-zinc-400 mt-0.5">{c.firm}</div>
              </div>
              <Icon name="user" size={14} className="text-zinc-600 mt-1 shrink-0"/>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500">
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-zinc-200"><Icon name="send" size={10}/> {c.email}</a>}
              {c.phone && <span className="font-mono">{c.phone}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Photo gallery ----------
function PhotoGallery({ onOpen }) {
  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">The home as it stands</div>
          <h2 className="text-xl font-semibold text-zinc-100">Listing photos</h2>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">Captured from the original 2024 listing. Click any to expand.</p>
        </div>
        <span className="text-[11px] font-mono text-zinc-600">{LISTING_PHOTOS.length} photos</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LISTING_PHOTOS.map(p => (
          <button key={p.id} onClick={() => onOpen(p)} className="group block text-left rounded-lg overflow-hidden ring-1 ring-zinc-800/60 hover:ring-zinc-600 transition-all">
            <div className="aspect-[4/3] overflow-hidden bg-zinc-900">
              <img src={p.src} alt={p.caption} loading="lazy"
                   className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"/>
            </div>
            <div className="px-3 py-2.5 bg-zinc-900/60">
              <div className="text-[12px] text-zinc-200 leading-tight line-clamp-1">{p.caption}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">
                {p.roomKeys.length > 0 ? ROOMS.find(r => r.key === p.roomKeys[0])?.name : "—"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Floor plans (real uploaded JPGs, open modal on click) ----------
function FloorPlansSection({ onOpenPlan }) {
  const cards = [
    { floor: "upper", label: "Upper level", src: FLOORPLAN_IMAGES.upper, rooms: ROOMS.filter(r => r.floor === "upper").length },
    { floor: "lower", label: "Lower level", src: FLOORPLAN_IMAGES.lower, rooms: ROOMS.filter(r => r.floor === "lower").length },
  ];
  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Layout</div>
          <h2 className="text-xl font-semibold text-zinc-100">Floor plans</h2>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">Tap either level to open the plan full-size in an overlay — works the same on phone or laptop.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(c => (
          <button key={c.floor} onClick={() => onOpenPlan(c.floor)}
            className="group text-left rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/60 hover:ring-zinc-600 transition-all overflow-hidden">
            <div className="flex items-stretch">
              <div className="shrink-0 w-32 bg-white grid place-items-center p-2">
                <img src={c.src} alt={`${c.label} thumbnail`} className="w-full h-auto block max-h-[140px] object-contain" loading="lazy"/>
              </div>
              <div className="flex-1 min-w-0 p-4 flex flex-col justify-center">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Floor plan</div>
                <div className="text-base font-medium text-zinc-100 mt-0.5">{c.label}</div>
                <div className="text-[11px] font-mono text-zinc-500 mt-1">{c.rooms} rooms · existing condition</div>
                <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 group-hover:text-zinc-100">
                  <Icon name="eye" size={11}/>
                  <span>Open full plan</span>
                  <Icon name="arrow-up-right" size={10}/>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Rooms grid (with photos when available) ----------
function RoomsSection({ onPickRoom, bidLines }) {
  const grouped = useMemo(() => {
    const out = { upper: [], lower: [] };
    for (const r of ROOMS) out[r.floor].push(r);
    return out;
  }, []);

  const lineCounts = useMemo(() => {
    const out = {};
    for (const l of bidLines) out[l.roomKey] = (out[l.roomKey] || 0) + 1;
    return out;
  }, [bidLines]);

  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Scope by space</div>
          <h2 className="text-xl font-semibold text-zinc-100">Rooms</h2>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">Click any room for dimensions, intent, materials, supporting docs, and to bid for the space.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-rose-400"></span><span className="text-zinc-400">Gut</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-400"></span><span className="text-zinc-400">Open / absorb</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-violet-400"></span><span className="text-zinc-400">Convert</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-sky-400"></span><span className="text-zinc-400">Refresh</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-zinc-600"></span><span className="text-zinc-400">No work</span></span>
        </div>
      </div>

      {["upper", "lower"].map(floor => (
        <div key={floor} className="mb-10 last:mb-0">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400 mb-4">{floor} level · {grouped[floor].length}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {grouped[floor].map(r => (
              <RoomCard key={r.key} room={r} onClick={() => onPickRoom(r.key)} bidCount={lineCounts[r.key] || 0}/>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function RoomCard({ room, onClick, bidCount }) {
  const photo = room.listingPhotoId ? LISTING_PHOTOS.find(p => p.id === room.listingPhotoId) : null;
  const scope = SCOPE_TONE[room.scope];

  const fallbackIcon = room.name.toLowerCase().includes("bed") ? "bed"
    : room.name.toLowerCase().includes("kitchen") ? "utensils"
    : room.name.toLowerCase().includes("bath") ? "bath"
    : room.name.toLowerCase().includes("garage") ? "package"
    : room.name.toLowerCase().includes("laundry") ? "wind"
    : room.name.toLowerCase().includes("entry") ? "home"
    : "home";

  return (
    <button onClick={onClick}
      className="group text-left rounded-xl overflow-hidden bg-zinc-900/60 ring-1 ring-zinc-800/60 hover:ring-zinc-600 transition-all flex flex-col">
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-900">
        {photo ? (
          <img src={photo.src} alt={room.name} loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"/>
        ) : (
          <div className="w-full h-full grid place-items-center">
            <Icon name={fallbackIcon} size={36} className="text-zinc-700" strokeWidth={1.25}/>
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <Chip tone={scope.tone} className="!bg-zinc-950/70 !backdrop-blur-sm">{scope.label}</Chip>
        </div>
        {bidCount > 0 && (
          <div className="absolute top-2 right-2">
            <Chip tone="emerald" className="!bg-zinc-950/70 !backdrop-blur-sm">{bidCount} line{bidCount === 1 ? "" : "s"}</Chip>
          </div>
        )}
        {!photo && (
          <div className="absolute bottom-2 right-2 text-[9px] uppercase tracking-wider text-zinc-600 font-mono">no photo</div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-100">{room.name}</div>
            <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{room.dims !== "—" ? `${room.dims} · ~${room.sf} sf` : `~${room.sf} sf`}</div>
          </div>
          <Icon name="arrow-up-right" size={13} className="text-zinc-600 group-hover:text-zinc-300 transition-colors mt-0.5"/>
        </div>
        <div className="mt-2 text-[12px] text-zinc-400 leading-relaxed line-clamp-2">{room.intent}</div>
      </div>
    </button>
  );
}

// ---------- Active toggles ----------
function ActiveTogglesSection() {
  const grouped = useMemo(() => {
    const out = {};
    for (const t of TOGGLES_PUBLISHED) (out[t.category] = out[t.category] || []).push(t);
    return out;
  }, []);
  const order = ["structural", "layout", "systems", "finish"];
  return (
    <section className="pb-14">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Scope decisions</div>
        <h2 className="text-xl font-semibold text-zinc-100">Active toggles</h2>
        <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">High-level decisions the owner has locked in. Each affects which trades + tasks belong in your bid.</p>
      </div>
      <div className="space-y-6">
        {order.filter(k => grouped[k]).map(cat => {
          const meta = PORTAL_CATEGORY_META[cat];
          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <div className="size-1.5 rounded-full" style={{ background: meta.color }}></div>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.22em]" style={{ color: meta.color }}>{meta.label}</h3>
                <span className="text-[11px] font-mono text-zinc-600">{grouped[cat].length}</span>
              </div>
              <div className="space-y-2">
                {grouped[cat].map((t, i) => (
                  <div key={i} className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 px-5 py-4">
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
    </section>
  );
}

// ---------- Materials (compact, since detail is in room overlays) ----------
function MaterialsSection() {
  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Specs</div>
          <h2 className="text-xl font-semibold text-zinc-100">Materials specified</h2>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">Owner-supplied where noted. Room-level assignments live inside each room view.</p>
        </div>
        <span className="text-[11px] font-mono text-zinc-600">{PORTAL_MATERIALS.length} items</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PORTAL_MATERIALS.map(m => (
          <div key={m.id} className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-1">{m.category}</div>
                <div className="text-sm text-zinc-100 font-medium">{m.productName}</div>
                <div className="text-[12px] text-zinc-400 mt-0.5">{m.brand}</div>
              </div>
            </div>
            {m.roomKeys.length > 0 && (
              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                {m.roomKeys.slice(0, 4).map(rk => (
                  <span key={rk} className="text-[10px] text-zinc-400 bg-zinc-800/60 rounded-sm px-1.5 py-0.5">{ROOMS.find(r => r.key === rk)?.name}</span>
                ))}
                {m.roomKeys.length > 4 && <span className="text-[10px] text-zinc-500">+{m.roomKeys.length - 4} more</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Supporting documents ----------
function DocsSection() {
  return (
    <section className="pb-14">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Reference</div>
          <h2 className="text-xl font-semibold text-zinc-100">Supporting documents</h2>
          <p className="text-[12px] text-zinc-500 mt-1 max-w-xl">Permit drawings, calcs, energy compliance. Worth reviewing — especially for spaces with structural work.</p>
        </div>
        <span className="text-[11px] font-mono text-zinc-600">{DOCS.length} files</span>
      </div>
      <div className="space-y-2">
        {DOCS.map(d => (
          <a key={d.id} href="#" className="flex items-center gap-4 px-5 py-3.5 rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 hover:ring-zinc-700 transition-all">
            <div className="size-10 rounded-md bg-zinc-900 grid place-items-center text-zinc-500 ring-1 ring-zinc-800">
              <Icon name="file-text" size={16}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-100 truncate">{d.name}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">{d.type.toUpperCase()} · {d.size}</div>
            </div>
            {d.roomKeys.length > 0 && (
              <span className="text-[11px] text-zinc-500 hidden md:inline">applies to {d.roomKeys.length} room{d.roomKeys.length === 1 ? "" : "s"}</span>
            )}
            <Icon name="download" size={14} className="text-zinc-500"/>
          </a>
        ))}
      </div>
    </section>
  );
}

// ---------- Lightbox ----------
function Lightbox({ photo, onClose }) {
  if (!photo) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-8">
      <div onClick={e => e.stopPropagation()} className="max-w-5xl w-full">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-zinc-200">{photo.caption}</div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="x" size={16}/>
          </button>
        </div>
        <img src={photo.src} alt={photo.caption} className="w-full h-auto max-h-[78vh] object-contain rounded-lg ring-1 ring-zinc-800"/>
      </div>
    </div>
  );
}

// ---------- Mobile ----------
function PortalMobile({ onPickRoom }) {
  return (
    <div className="overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-zinc-900 flex items-center justify-between">
        <div>
          <div className="font-mono text-sm tracking-tighter text-zinc-100">/the_monolith</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mt-0.5">Scope &amp; bid</div>
        </div>
        <Chip tone="amber" icon="lock">Draft</Chip>
      </div>
      <div className="px-4 py-5 border-b border-zinc-900">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-zinc-900 ring-1 ring-zinc-800 grid place-items-center text-[11px] font-mono text-zinc-300">{OWNER.initial}</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">From {OWNER.shortName}</div>
            <div className="text-sm text-zinc-100">Welcome, and thank you.</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-zinc-400 leading-relaxed">{OWNER.greeting.slice(0, 180)}…</p>
      </div>
      <div className="px-4 py-5">
        <h1 className="text-xl tracking-tight text-zinc-50" style={{ fontFamily: '"Newsreader", serif', fontWeight: 500 }}>{PROJECT.scenarioName}</h1>
        <p className="mt-2 text-[12px] text-zinc-400 leading-relaxed">{PROJECT.scenarioDescription.slice(0,160)}…</p>
      </div>
      <div className="px-4 pb-4">
        <h3 className="text-[10px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Rooms · {ROOMS.length}</h3>
        <div className="grid grid-cols-2 gap-2">
          {ROOMS.slice(0, 6).map(r => {
            const photo = r.listingPhotoId ? LISTING_PHOTOS.find(p => p.id === r.listingPhotoId) : null;
            return (
              <button key={r.key} onClick={() => onPickRoom && onPickRoom(r.key)} className="text-left rounded-lg overflow-hidden bg-zinc-900/60 ring-1 ring-zinc-800/60">
                <div className="aspect-[4/3] bg-zinc-900 overflow-hidden">
                  {photo
                    ? <img src={photo.src} alt={r.name} className="w-full h-full object-cover" loading="lazy"/>
                    : <div className="w-full h-full grid place-items-center"><Icon name="home" size={20} className="text-zinc-700"/></div>}
                </div>
                <div className="p-2.5">
                  <div className="text-[12px] text-zinc-100 font-medium leading-tight">{r.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{r.dims}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="sticky bottom-0 left-0 right-0 px-4 py-3 bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Chip tone="amber" className="!text-[9px]">Draft</Chip>
          <span className="text-[11px] font-mono text-zinc-300">$0 – $0</span>
        </div>
        <button className="text-[11px] text-zinc-100 bg-zinc-800 px-3 py-1.5 rounded-md">Open bid →</button>
      </div>
    </div>
  );
}

// ---------- Page ----------
function ContractorPortalPageV2() {
  const [bidLines, setBidLines] = useState([
    // Seed one demo line so the bid drawer has content
    { id: "bl_seed_1", roomKey: "kitchen", activity: "demo", minCents: 320000, maxCents: 480000,
      notes: "Full strip-out of existing cabinetry, counters, appliances, and flooring within kitchen footprint. Includes wall sheathing to studs at island wall, dump fees, dust containment. Excludes plumbing/electrical cap-off (separate line)." },
    { id: "bl_seed_2", roomKey: "primary_bath", activity: "tile", minCents: 580000, maxCents: 720000,
      notes: "Tile install per Heath spec, ~180 sf wet area. Includes waterproofing, schluter edge, grout. Material owner-supplied. Excludes prep beyond standard cement board." },
  ]);

  const [openRoom, setOpenRoom] = useState(null);
  const [bidOpen, setBidOpen] = useState(false);
  const [planModalState, setPlanModalState] = useState({ open: false, floor: null });
  const lightbox = useLightbox();

  const bidTotal = useMemo(() => bidLines.reduce(
    (a, l) => ({ min: a.min + (l.minCents || 0), max: a.max + (l.maxCents || 0) }),
    { min: 0, max: 0 }
  ), [bidLines]);

  const addBidLine = (line) => setBidLines(prev => [...prev, line]);
  const removeBidLine = (id) => setBidLines(prev => prev.filter(l => l.id !== id));
  const sendBid = () => {
    alert(`Mock send: ${bidLines.length} line items would be locked & emailed to ${OWNER.email}. (No actual send in mock.)`);
  };

  const assistantContext = useMemo(() => ({
    roomKey: openRoom,
    section: !openRoom && "portal overview"
  }), [openRoom]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <PortalNav bidTotal={bidTotal} bidCount={bidLines.length} onOpenBid={() => setBidOpen(true)}/>

      <div className="mx-auto max-w-[1280px] px-8 pb-32">
        {/* DATA */}
        <StateLabel state="DATA" hint="contractor's live view · 2 mock bid lines seeded · click any room to dig in"/>
        <OwnerWelcome/>
        <ProjectHeader/>
        <CollaboratorsSection/>
        <PhotoGallery onOpen={lightbox.open}/>
        <FloorPlansSection onOpenPlan={(f) => setPlanModalState({ open: true, floor: f })}/>
        <RoomsSection onPickRoom={setOpenRoom} bidLines={bidLines}/>
        <ActiveTogglesSection/>
        <MaterialsSection/>
        <DocsSection/>

        <footer className="pt-12 pb-4 mt-10">
          <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 p-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-zinc-200">Questions or want to schedule a walk-through?</div>
              <div className="text-xs text-zinc-500 mt-0.5">Reach {OWNER.shortName} directly, or chat with Monty (bottom right) for anything on this page.</div>
            </div>
            <Button variant="secondary" icon="send">Request walk-through</Button>
          </div>
          <div className="mt-8 flex items-center justify-between text-[11px] text-zinc-600">
            <span>The Monolith · {PROJECT.address} · v3 · expires {PROJECT.expiresOn}</span>
            <span className="font-mono">share_token: tk_a4f9_…</span>
          </div>
        </footer>

        {/* EMPTY (compact — share link valid but scope unpublished) */}
        <StateLabel state="EMPTY" hint="link valid but owner hasn't published scope yet"/>
        <EmptyState
          icon="file-text"
          title="Scope is being prepared"
          description={`${OWNER.shortName} shared this link but hasn't published rooms, toggles, or materials yet. Check back — you'll be notified when it's live.`}
          action={<Button variant="secondary" icon="bell">Notify me when ready</Button>}
        />

        {/* LOADING */}
        <StateLabel state="LOADING" hint="initial portal hydration"/>
        <div className="space-y-6">
          <Skeleton className="h-32 rounded-2xl"/>
          <div className="grid grid-cols-4 gap-3">{[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-44 rounded-xl"/>)}</div>
          <Skeleton className="h-96 rounded-2xl"/>
        </div>

        {/* ERROR */}
        <StateLabel state="ERROR" hint="share token expired"/>
        <div className="rounded-xl bg-rose-950/40 ring-1 ring-rose-500/30 text-rose-200 p-6">
          <div className="flex items-start gap-4">
            <Icon name="lock" size={20} className="text-rose-300 mt-0.5"/>
            <div className="flex-1">
              <div className="text-sm font-medium text-rose-100">This share link has expired</div>
              <div className="mt-2 text-sm text-rose-300/90 leading-relaxed max-w-xl">
                The owner shared this on Apr 14, 2026; it was valid for 30 days. Reach out to <span className="font-mono">{OWNER.name}</span> for a fresh link.
              </div>
            </div>
            <Button variant="danger" icon="send" size="sm">Request new link</Button>
          </div>
        </div>

        {/* MOBILE */}
        <StateLabel state="MOBILE" hint="375px · sticky bid pill on bottom"/>
        <div className="flex justify-center pt-4">
          <MobileFrame label="iPhone 15 · 375 · contractor portal v2">
            <PortalMobile onPickRoom={() => {}}/>
          </MobileFrame>
        </div>
      </div>

      {/* Overlays */}
      <BidDrawer
        open={bidOpen}
        onClose={() => setBidOpen(false)}
        bidLines={bidLines}
        onAddLine={addBidLine}
        onRemoveLine={removeBidLine}
        onSend={sendBid}
        onJumpToRoom={(rk) => { setBidOpen(false); setTimeout(() => setOpenRoom(rk), 200); }}
      />
      {openRoom && (
        <RoomDetailOverlay
          roomKey={openRoom}
          onClose={() => setOpenRoom(null)}
          bidLines={bidLines}
          onAddBidLine={addBidLine}
          onRemoveBidLine={removeBidLine}
        />
      )}
      <Lightbox photo={lightbox.active} onClose={lightbox.close}/>

      <FloorPlanModal open={planModalState.open} onClose={() => setPlanModalState({ open: false })} initialFloor={planModalState.floor || "upper"}/>

      {/* Monty assistant FAB always present */}
      <MontyFAB context={assistantContext}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ContractorPortalPageV2/>);
