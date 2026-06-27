// Portal v2 — feature modules: bid drawer, AI validation, room detail overlay,
// Monty (the friendly assistant), floor plan modal w/ blinking room marker.

// =====================================================================
// Activity options + typical price reference (used by Monty for sanity checks)
// =====================================================================

const ACTIVITY_OPTIONS = [
  { id: "demo", label: "Demo" },
  { id: "framing", label: "Framing" },
  { id: "plumbing_rough", label: "Plumbing — rough" },
  { id: "plumbing_finish", label: "Plumbing — finish" },
  { id: "electrical_rough", label: "Electrical — rough" },
  { id: "electrical_finish", label: "Electrical — finish" },
  { id: "hvac", label: "HVAC" },
  { id: "drywall", label: "Drywall + plaster" },
  { id: "flooring", label: "Flooring install" },
  { id: "tile", label: "Tile install" },
  { id: "cabinetry", label: "Cabinetry install" },
  { id: "trim", label: "Trim + millwork" },
  { id: "paint", label: "Paint" },
  { id: "fixtures", label: "Fixture install" },
  { id: "appliances", label: "Appliance install" },
  { id: "permits", label: "Permits + fees" },
  { id: "cleanup", label: "Final clean + punch" },
];

// Per-activity typical bid sanity ranges (cents). Used to flag obvious typos.
// "perSf" = $ per square foot. "perRoom" = $ total for a single room.
const ACTIVITY_TYPICAL = {
  demo:             { perSf:   { min: 400,    max: 1500 },   label: "demo" },
  framing:          { perSf:   { min: 1500,   max: 5500 },   label: "framing" },
  plumbing_rough:   { perRoom: { min: 350000, max: 1500000 }, label: "plumbing rough" },
  plumbing_finish:  { perRoom: { min: 100000, max: 800000 },  label: "plumbing finish" },
  electrical_rough: { perSf:   { min: 600,    max: 1800 },   label: "electrical rough" },
  electrical_finish:{ perRoom: { min: 80000,  max: 500000 },  label: "electrical finish" },
  hvac:             { perRoom: { min: 150000, max: 600000 },  label: "HVAC" },
  drywall:          { perSf:   { min: 300,    max: 800 },    label: "drywall" },
  flooring:         { perSf:   { min: 800,    max: 3500 },   label: "flooring install" },
  tile:             { perSf:   { min: 1500,   max: 4500 },   label: "tile install" },
  cabinetry:        { perRoom: { min: 400000, max: 4000000 }, label: "cabinetry install" },
  trim:             { perRoom: { min: 50000,  max: 400000 },  label: "trim work" },
  paint:            { perSf:   { min: 200,    max: 800 },    label: "paint" },
  fixtures:         { perRoom: { min: 50000,  max: 600000 },  label: "fixture install" },
  appliances:       { perRoom: { min: 20000,  max: 300000 },  label: "appliance install" },
  permits:          { perRoom: { min: 30000,  max: 200000 },  label: "permits" },
  cleanup:          { perRoom: { min: 30000,  max: 200000 },  label: "final clean" },
};

// =====================================================================
// Monty validation — never blocks, always offers a heads up if needed.
// =====================================================================

function typicalForActivityRoom(activity, room) {
  const ref = ACTIVITY_TYPICAL[activity];
  if (!ref || !room) return null;
  if (ref.perRoom) return { min: ref.perRoom.min, max: ref.perRoom.max, basis: "for a room this size", label: ref.label };
  // perSf — scale by room SF
  if (ref.perSf && room.sf) {
    return {
      min: ref.perSf.min * room.sf,
      max: ref.perSf.max * room.sf,
      basis: `for ~${room.sf} sf`,
      label: ref.label,
    };
  }
  return null;
}

function fmtRange(min, max) {
  return `${fmtCents(min)}–${fmtCents(max)}`;
}

function validateBidLine({ activity, minCents, maxCents, notes, roomKey }) {
  const tips = [];
  const room = ROOMS.find(r => r.key === roomKey);
  const note = (notes || "").trim();
  const wordCount = note ? note.split(/\s+/).length : 0;

  // ---- Empty checks (gentle heads-up, never block) ----
  if (!activity) tips.push("No activity picked yet — that's a required field before this can be added.");
  const haveMin = minCents != null && minCents > 0;
  const haveMax = maxCents != null && maxCents > 0;
  if (!haveMin || !haveMax) tips.push("Heads up — both a min and a max ballpark are needed to add this to your draft.");
  else if (minCents > maxCents) tips.push("Your min is higher than your max — probably a swap. Worth double-checking.");

  // ---- Price sanity vs activity + room ----
  if (haveMin && haveMax && activity && room) {
    const typical = typicalForActivityRoom(activity, room);
    if (typical) {
      const midUser = (minCents + maxCents) / 2;
      const midTypical = (typical.min + typical.max) / 2;
      const ratio = midUser / midTypical;
      if (ratio > 4) {
        tips.push(
          `That's ${ratio.toFixed(1)}× the usual range for ${typical.label} ${typical.basis} (typically ${fmtRange(typical.min, typical.max)}). If it isn't a typo, mention what's driving the cost in the notes — Marcus will compare against the other bids.`
        );
      } else if (ratio > 2) {
        tips.push(
          `Coming in well above the usual ${typical.label} range ${typical.basis} (typically ${fmtRange(typical.min, typical.max)}). Worth a sentence in the notes about why.`
        );
      } else if (ratio < 0.4 && midTypical > 50000) {
        tips.push(
          `That looks lean — ${typical.label} ${typical.basis} typically runs ${fmtRange(typical.min, typical.max)}. If you're scoping less than the others, call that out so Marcus knows what's excluded.`
        );
      }
    }
    // Wide range
    if (maxCents > minCents * 4) {
      tips.push("Your max is more than 4× your min. Tightening it shows confidence — and helps Marcus compare apples to apples.");
    }
  }

  // ---- Notes quality ----
  const junkPattern = /^(test|asdf|qwerty|tbd|tba|n\/a|see above|same as before|—|\.|,|stuff|things|whatever)+$/i;
  if (haveMin && haveMax && activity) {
    if (wordCount === 0) {
      tips.push("No notes at all? Even one line explaining what's included goes a long way for a bid this size.");
    } else if (junkPattern.test(note) || (wordCount <= 4 && /old|stuff|things|various/i.test(note))) {
      tips.push("The notes read pretty generic — \"lots of old stuff\" doesn't really help Marcus compare bids. Mentioning fixture count, demo extent, or what's excluded would land better.");
    } else if (wordCount < 8) {
      tips.push("Notes are a bit thin — what specifically did you price against? Fixtures, square footage, demo, exclusions all help.");
    }
    const allCaps = note.length > 10 && note === note.toUpperCase();
    if (allCaps) tips.push("Caps lock-only reads pretty intense. Sentence case probably lands better.");
    const padding = ["depends on site conditions", "tbd", "will determine on walk", "see plans"].some(p => note.toLowerCase().includes(p));
    if (padding && wordCount < 25) tips.push("\"Depends on site conditions\" on its own isn't enough — what specifically would shift the price?");
  }

  // ---- Status: only "missing required" blocks, everything else is advisory ----
  const missingRequired = !activity || !haveMin || !haveMax || (haveMin && haveMax && minCents > maxCents);
  const status = missingRequired ? "missing" : (tips.length ? "advice" : "ok");

  return { status, tips, missingRequired };
}

// =====================================================================
// Monty validation callout — single warm paragraph block
// =====================================================================
function MontyCallout({ v }) {
  if (v.status === "ok") {
    return (
      <div className="rounded-md bg-emerald-950/30 ring-1 ring-emerald-400/20 px-3 py-2.5 flex items-start gap-2.5">
        <div className="size-5 rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/30 grid place-items-center shrink-0 mt-0.5">
          <Icon name="sparkles" size={11} className="text-emerald-300"/>
        </div>
        <div className="text-[12px] text-emerald-200 leading-relaxed">
          <span className="font-medium">Monty:</span> Looks solid — clear activity, sensible range, and notes Marcus can actually compare against. Good to go.
        </div>
      </div>
    );
  }
  const isMissing = v.status === "missing";
  return (
    <div className={`rounded-md px-3 py-2.5 flex items-start gap-2.5 ${
      isMissing ? "bg-zinc-900/60 ring-1 ring-zinc-800" : "bg-amber-950/25 ring-1 ring-amber-400/20"
    }`}>
      <div className={`size-5 rounded-full grid place-items-center shrink-0 mt-0.5 ${
        isMissing ? "bg-zinc-800 ring-1 ring-zinc-700" : "bg-amber-400/15 ring-1 ring-amber-400/30"
      }`}>
        <Icon name="sparkles" size={11} className={isMissing ? "text-zinc-400" : "text-amber-300"}/>
      </div>
      <div className={`text-[12px] leading-relaxed space-y-1.5 ${isMissing ? "text-zinc-300" : "text-amber-200"}`}>
        <div>
          <span className="font-medium">Monty:</span>{" "}
          {isMissing
            ? "Just finish filling these in and you're set — no pressure on the rest."
            : v.tips.length > 1
              ? "A couple things to double-check — these are just heads-ups, you can still add this to your draft as-is."
              : "One heads up — you can still add this as-is, but here's something worth a second look:"}
        </div>
        {v.tips.length > 0 && (
          <ul className="list-disc pl-4 space-y-0.5">
            {v.tips.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Bid drawer
// =====================================================================
function BidDrawer({ open, onClose, bidLines, onRemoveLine, onSend, onJumpToRoom }) {
  const total = bidLines.reduce((acc, l) => ({
    min: acc.min + (l.minCents || 0),
    max: acc.max + (l.maxCents || 0),
  }), { min: 0, max: 0 });

  const byRoom = useMemo(() => {
    const out = {};
    for (const l of bidLines) (out[l.roomKey] = out[l.roomKey] || []).push(l);
    return out;
  }, [bidLines]);

  return (
    <>
      <div onClick={onClose}
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}/>
      <aside
        className={`fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] bg-zinc-950 ring-1 ring-zinc-800/80 flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <header className="px-6 py-5 flex items-center justify-between ring-1 ring-zinc-800/60 ring-r-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Your bid</span>
              <Chip tone="amber">Draft</Chip>
            </div>
            <h2 className="text-base font-semibold text-zinc-50">Submission for {OWNER.name}</h2>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="x" size={16}/>
          </button>
        </header>

        <div className="px-6 py-5 ring-1 ring-zinc-800/60">
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-2">Total range</div>
          <div className="flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-2xl text-zinc-50 font-medium">{fmtCents(total.min)}</span>
            <span className="text-zinc-600">–</span>
            <span className="text-2xl text-zinc-50 font-medium">{fmtCents(total.max)}</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500">
            {bidLines.length} line item{bidLines.length === 1 ? "" : "s"} across {Object.keys(byRoom).length} room{Object.keys(byRoom).length === 1 ? "" : "s"}.
            Stays a draft until you hit send.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 min-h-0">
          {bidLines.length === 0 && (
            <div className="text-center py-12">
              <Icon name="file-text" size={36} className="text-zinc-700 mx-auto mb-3" strokeWidth={1.25}/>
              <div className="text-sm text-zinc-300">No line items yet</div>
              <div className="mt-1 text-xs text-zinc-500 max-w-xs mx-auto">Open any room and use "Add bid line for this room" to build up your submission.</div>
            </div>
          )}
          {Object.entries(byRoom).map(([rk, lines]) => {
            const room = ROOMS.find(r => r.key === rk);
            const roomMin = lines.reduce((s, l) => s + (l.minCents || 0), 0);
            const roomMax = lines.reduce((s, l) => s + (l.maxCents || 0), 0);
            return (
              <div key={rk}>
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => onJumpToRoom(rk)}
                    className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-300 hover:text-zinc-100 inline-flex items-center gap-1.5">
                    {room?.name || rk}
                    <Icon name="arrow-up-right" size={11}/>
                  </button>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                    {fmtCents(roomMin)} – {fmtCents(roomMax)}
                  </span>
                </div>
                <div className="rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60 divide-y divide-zinc-800/60">
                  {lines.map(l => (
                    <div key={l.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-zinc-100">{ACTIVITY_OPTIONS.find(a => a.id === l.activity)?.label || l.activity}</div>
                          <div className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{l.notes}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-mono tabular-nums text-zinc-200">{fmtCents(l.minCents)}</div>
                          <div className="text-[10px] font-mono text-zinc-500">– {fmtCents(l.maxCents)}</div>
                        </div>
                        <button onClick={() => onRemoveLine(l.id)} className="size-6 grid place-items-center rounded text-zinc-600 hover:text-rose-300 hover:bg-rose-500/10 shrink-0">
                          <Icon name="trash" size={12}/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="px-6 py-5 ring-1 ring-zinc-800/60 space-y-2 bg-zinc-950">
          <Button variant="primary" icon="send" className="w-full" onClick={onSend} disabled={bidLines.length === 0}>
            Send bid to {OWNER.shortName}
          </Button>
          <Button variant="ghost" icon="save" size="sm" className="w-full">Save draft &amp; exit</Button>
          <p className="text-[11px] text-zinc-500 text-center leading-relaxed mt-2">
            Once sent, your bid is locked. You can revise by submitting an updated version.
          </p>
        </footer>
      </aside>
    </>
  );
}

// =====================================================================
// Add-bid-line inline form (never blocks unless required field missing)
// =====================================================================
function AddBidLineForm({ roomKey, onAdd, onCancel }) {
  const [activity, setActivity] = useState("");
  const [minStr, setMinStr] = useState("");
  const [maxStr, setMaxStr] = useState("");
  const [notes, setNotes] = useState("");

  const minCents = parseFloat(minStr) > 0 ? Math.round(parseFloat(minStr) * 100) : null;
  const maxCents = parseFloat(maxStr) > 0 ? Math.round(parseFloat(maxStr) * 100) : null;

  const validation = useMemo(
    () => validateBidLine({ activity, minCents, maxCents, notes, roomKey }),
    [activity, minCents, maxCents, notes, roomKey]
  );

  // Only blocking case: missing required fields. AI advice never blocks.
  const canSubmit = !validation.missingRequired;

  return (
    <div className="rounded-xl bg-zinc-900/80 ring-1 ring-emerald-400/30 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="plus" size={14} className="text-emerald-300"/>
          <span className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">New bid line</span>
        </div>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-200">Cancel</button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">Activity</label>
        <select value={activity} onChange={e => setActivity(e.target.value)}
          className="w-full h-9 px-3 text-sm bg-zinc-950 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none">
          <option value="">Choose…</option>
          {ACTIVITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">Ballpark min</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm">$</span>
            <input value={minStr} onChange={e => setMinStr(e.target.value)} type="number" min="0" placeholder="0"
              className="w-full h-9 pl-7 pr-3 text-sm font-mono tabular-nums bg-zinc-950 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none"/>
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">Ballpark max</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm">$</span>
            <input value={maxStr} onChange={e => setMaxStr(e.target.value)} type="number" min="0" placeholder="0"
              className="w-full h-9 pl-7 pr-3 text-sm font-mono tabular-nums bg-zinc-950 text-zinc-100 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none"/>
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
          Notes — assumptions, what's included, how you arrived at the number
        </label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="e.g. Priced for 112 sf gut to studs, demo + dump fees included, owner-supplied appliances. Excludes structural eng. sign-off."
          className="w-full px-3 py-2 text-sm bg-zinc-950 text-zinc-100 placeholder:text-zinc-600 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none resize-none leading-relaxed"/>
      </div>

      <MontyCallout v={validation}/>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="accent" icon="check" size="sm" disabled={!canSubmit}
          onClick={() => onAdd({ activity, minCents, maxCents, notes, roomKey, id: `bl_${Date.now()}_${Math.floor(Math.random()*999)}` })}>
          Add to draft
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        {validation.status === "advice" && (
          <span className="text-[11px] text-amber-300/80 ml-1">Monty has notes — you can still add it.</span>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Blinking marker on the real floor plan image
// =====================================================================
function BlinkingMarkerOnPlan({ floor, marker, label, className = "" }) {
  return (
    <div className={`relative bg-white rounded-lg ring-1 ring-zinc-800/60 overflow-hidden ${className}`}>
      <img src={FLOORPLAN_IMAGES[floor]} alt={`${floor} level floor plan`}
           className="w-full h-auto block" loading="lazy"/>
      {marker && (
        <div className="absolute pointer-events-none"
             style={{ top: `${marker.topPct}%`, left: `${marker.leftPct}%`, transform: "translate(-50%, -50%)" }}>
          {/* outer halo */}
          <div className="blink-halo"></div>
          {/* core dot */}
          <div className="blink-dot"></div>
          {label && (
            <div className="absolute left-1/2 -translate-x-1/2 -top-7 px-2 py-0.5 rounded-md bg-zinc-950 text-zinc-100 text-[10px] font-medium whitespace-nowrap ring-1 ring-zinc-800 shadow-lg shadow-black/40">
              {label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Floor plan modal — shows both levels with optional active marker
// =====================================================================
function FloorPlanModal({ open, onClose, initialFloor = "upper", highlightRoomKey = null }) {
  const [floor, setFloor] = useState(initialFloor);
  useEffect(() => { if (open) setFloor(initialFloor); }, [open, initialFloor]);
  const room = ROOMS.find(r => r.key === highlightRoomKey);
  const marker = room && room.floor === floor ? room.marker : null;
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col" onClick={onClose}>
      <header className="px-6 py-4 flex items-center justify-between ring-1 ring-zinc-800/40 ring-r-0 ring-l-0 ring-t-0 bg-zinc-950/80"
              onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Floor plan</div>
            <div className="text-base font-medium text-zinc-100">{PROJECT.address}</div>
          </div>
          <div className="inline-flex bg-zinc-900 rounded-md p-0.5 ring-1 ring-zinc-800">
            {["upper", "lower"].map(f => (
              <button key={f} onClick={() => setFloor(f)}
                className={`h-7 px-3 text-xs rounded-sm transition-colors capitalize ${floor === f ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                {f} level
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={FLOORPLAN_IMAGES[floor]} target="_blank" rel="noopener"
             className="text-[11px] text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1.5 px-3 h-8 rounded-md hover:bg-zinc-900">
            <Icon name="external-link" size={12}/> Open original
          </a>
          <button onClick={onClose} className="size-9 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="x" size={16}/>
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 grid place-items-center" onClick={e => e.stopPropagation()}>
        <div className="max-w-3xl w-full" onClick={e => e.stopPropagation()}>
          <BlinkingMarkerOnPlan floor={floor} marker={marker} label={room?.name}/>
          {room && (
            <div className="mt-4 text-center text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-rose-500" style={{ boxShadow: "0 0 6px rgba(239,68,68,0.8)" }}></span>
                <span>Highlighted: <span className="text-zinc-100 font-medium">{room.name}</span> · {room.dims !== "—" ? `${room.dims} · ~${room.sf} sf` : `~${room.sf} sf`}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Room detail overlay
// =====================================================================
function RoomDetailOverlay({ roomKey, onClose, bidLines, onAddBidLine, onRemoveBidLine }) {
  const room = ROOMS.find(r => r.key === roomKey);
  const [addingBid, setAddingBid] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  if (!room) return null;
  const scope = SCOPE_TONE[room.scope];

  const listingPhotos = LISTING_PHOTOS.filter(p => p.roomKeys.includes(roomKey));
  const inspiration = INSPIRATION[roomKey] || [];
  const docs = DOCS.filter(d => d.roomKeys.includes(roomKey));
  const materials = PORTAL_MATERIALS.filter(m => m.roomKeys.includes(roomKey));
  const roomBids = bidLines.filter(b => b.roomKey === roomKey);
  const total = roomBids.reduce((a, l) => ({ min: a.min + l.minCents, max: a.max + l.maxCents }), { min: 0, max: 0 });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
      <div className="relative w-full lg:w-[1080px] max-w-full bg-zinc-950 ring-1 ring-zinc-800/80 overflow-y-auto">
        <header className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm px-8 py-5 flex items-center justify-between ring-1 ring-zinc-800/60">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{room.floor} level</span>
              <Chip tone={scope.tone}>{scope.label}</Chip>
            </div>
            <div className="flex items-baseline gap-4 mt-1">
              <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight">{room.name}</h2>
              <span className="text-sm font-mono tabular-nums text-zinc-500">{room.dims}{room.dims !== "—" ? ` · ~${room.sf} sf` : ""}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" icon="chevron-left" size="sm" onClick={onClose}>Back</Button>
            <Button variant="accent" icon="plus" size="sm" onClick={() => setAddingBid(v => !v)}>
              Bid this room
            </Button>
          </div>
        </header>

        <div className="px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div>
              <SectionTitle trailing={
                <button onClick={() => setPlanModalOpen(true)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1">
                  <Icon name="eye" size={11}/> Expand
                </button>
              }>Location on plan</SectionTitle>
              <button onClick={() => setPlanModalOpen(true)} className="mt-3 block w-full text-left">
                <BlinkingMarkerOnPlan floor={room.floor} marker={room.marker}/>
              </button>
              <div className="mt-2 text-[11px] text-zinc-500 flex items-center gap-2">
                <span className="size-2 rounded-full bg-rose-500" style={{ boxShadow: "0 0 6px rgba(239,68,68,0.8)" }}></span>
                Pulsing marker shows this room
              </div>
            </div>

            <div>
              <SectionTitle>Homeowner intent</SectionTitle>
              <p className="mt-3 text-sm text-zinc-200 leading-relaxed">{room.intent}</p>
            </div>

            {materials.length > 0 && (
              <div>
                <SectionTitle trailing={<span className="text-[10px] font-mono text-zinc-500">{materials.length}</span>}>
                  Materials specified
                </SectionTitle>
                <div className="mt-3 rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/40 divide-y divide-zinc-800/60">
                  {materials.map(m => (
                    <div key={m.id} className="px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{m.category}</div>
                      <div className="text-sm text-zinc-100">{m.productName}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{m.brand}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {docs.length > 0 && (
              <div>
                <SectionTitle trailing={<span className="text-[10px] font-mono text-zinc-500">{docs.length}</span>}>
                  Supporting docs
                </SectionTitle>
                <div className="mt-3 space-y-1.5">
                  {docs.map(d => (
                    <a key={d.id} href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-zinc-900/40 ring-1 ring-zinc-800/40 hover:ring-zinc-700 transition-all">
                      <Icon name="file-text" size={14} className="text-zinc-500"/>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-zinc-200 truncate">{d.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">{d.size} · {d.type.toUpperCase()}</div>
                      </div>
                      <Icon name="download" size={13} className="text-zinc-600"/>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-8">
            {listingPhotos.length > 0 && (
              <div>
                <SectionTitle>Listing photos — current condition</SectionTitle>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {listingPhotos.map(p => (
                    <figure key={p.id} className="rounded-lg overflow-hidden ring-1 ring-zinc-800/60 bg-zinc-900/40 group">
                      <div className="aspect-[4/3] overflow-hidden">
                        <img src={p.src} alt={p.caption} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" loading="lazy"/>
                      </div>
                      <figcaption className="px-3 py-2 text-[11px] text-zinc-400">{p.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {inspiration.length > 0 && (
              <div>
                <SectionTitle trailing={<Chip tone="violet" icon="sparkles">Owner uploads</Chip>}>
                  Inspiration
                </SectionTitle>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {inspiration.map(p => (
                    <figure key={p.id} className="rounded-lg overflow-hidden ring-1 ring-zinc-800/60 bg-zinc-900/40">
                      <div className="aspect-[4/3] overflow-hidden">
                        <img src={p.src} alt={p.caption} className="w-full h-full object-cover" loading="lazy"/>
                      </div>
                      <figcaption className="px-3 py-2 text-[11px] text-zinc-400">{p.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {listingPhotos.length === 0 && inspiration.length === 0 && (
              <div className="rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/40 px-6 py-10 text-center">
                <Icon name="camera" size={32} className="text-zinc-700 mx-auto mb-3" strokeWidth={1.25}/>
                <div className="text-sm text-zinc-300">No photos for this room</div>
                <div className="text-[11px] text-zinc-500 mt-1">The owner hasn't shared listing or inspiration photos here yet.</div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <SectionTitle>Your bid for this room</SectionTitle>
                {roomBids.length > 0 && (
                  <div className="text-[11px] font-mono tabular-nums text-zinc-300">
                    {fmtCents(total.min)} – {fmtCents(total.max)}
                  </div>
                )}
              </div>
              {roomBids.length > 0 && (
                <div className="rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/60 divide-y divide-zinc-800/60 mb-4">
                  {roomBids.map(l => (
                    <div key={l.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-zinc-100">{ACTIVITY_OPTIONS.find(a => a.id === l.activity)?.label}</div>
                        <div className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{l.notes}</div>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div className="text-sm text-zinc-200">{fmtCents(l.minCents)}</div>
                        <div className="text-[10px] text-zinc-500">– {fmtCents(l.maxCents)}</div>
                      </div>
                      <button onClick={() => onRemoveBidLine(l.id)} className="size-6 grid place-items-center rounded text-zinc-600 hover:text-rose-300 hover:bg-rose-500/10 shrink-0">
                        <Icon name="trash" size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {addingBid ? (
                <AddBidLineForm roomKey={room.key} onAdd={(l) => { onAddBidLine(l); setAddingBid(false); }} onCancel={() => setAddingBid(false)}/>
              ) : (
                <button onClick={() => setAddingBid(true)}
                  className="w-full h-12 rounded-lg ring-2 ring-dashed ring-zinc-800 hover:ring-emerald-400/60 text-zinc-400 hover:text-emerald-300 transition-all inline-flex items-center justify-center gap-2 text-sm">
                  <Icon name="plus" size={14}/>
                  Add bid line for {room.name}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <FloorPlanModal open={planModalOpen} onClose={() => setPlanModalOpen(false)} initialFloor={room.floor} highlightRoomKey={room.key}/>
    </div>
  );
}

// =====================================================================
// Monty — friendly contextual assistant
// =====================================================================
function MontyFAB({ context }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hey, I'm Monty — your sidekick here. Ask me anything: square footage, what's in scope, materials Marcus picked, where to find a doc. Happy to help." }
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const ctxLabel = context?.roomKey
    ? `Looking at: ${ROOMS.find(r => r.key === context.roomKey)?.name || context.roomKey}`
    : context?.section
      ? `Looking at: ${context.section}`
      : "Looking at: portal overview";

  const ctxFacts = useMemo(() => {
    if (context?.roomKey) {
      const r = ROOMS.find(x => x.key === context.roomKey);
      if (r) {
        const mats = PORTAL_MATERIALS.filter(m => m.roomKeys.includes(r.key));
        const matsList = mats.length ? mats.map(m => `${m.category}: ${m.productName} (${m.brand})`).join("; ") : "none specified";
        return `Current focus: room "${r.name}" on the ${r.floor} level. Dimensions: ${r.dims}. Approx ${r.sf} sf. Scope tier: ${SCOPE_TONE[r.scope]?.label}. Homeowner intent: ${r.intent}. Materials owner has specified: ${matsList}.`;
      }
    }
    return `Project: ${PROJECT.address}, ${PROJECT.city}. Scenario name: ${PROJECT.scenarioName}. ${PROJECT.scenarioDescription}`;
  }, [context]);

  const send = async () => {
    const q = draft.trim();
    if (!q || thinking) return;
    setDraft("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setThinking(true);
    let reply = "";
    try {
      if (window.claude?.complete) {
        reply = await window.claude.complete({
          messages: [
            { role: "user", content:
              `You are Monty, a friendly construction project assistant inside a contractor bidding portal called "The Monolith". Your personality: warm, plainspoken, brief. Always answer in 3–5 sentences max. Never invent prices or numbers — use only what the context gives you. When you don't know, say so and suggest the contractor reach out to the owner via the footer link. Sign off only when natural.\n\nContext you can use:\n${ctxFacts}\n\nThe contractor's question: ${q}`
            }
          ]
        });
      }
    } catch (e) { /* ignore */ }
    if (!reply) {
      reply = "I'd normally pull that from the project context — my connection's a bit flaky right now. The dimensions and scope notes are on this page; if you need something more, ping Marcus via the link in the footer.";
    }
    setMessages(m => [...m, { role: "assistant", text: reply }]);
    setThinking(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 z-30 h-12 pl-3 pr-5 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white shadow-xl shadow-black/40 inline-flex items-center gap-2.5 font-medium text-sm transition-all ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <span className="size-7 rounded-full bg-emerald-400 grid place-items-center text-zinc-950">
          <Icon name="sparkles" size={14} strokeWidth={2}/>
        </span>
        Ask Monty
      </button>

      <div className={`fixed bottom-6 right-6 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-zinc-950 rounded-2xl ring-1 ring-zinc-800 shadow-2xl shadow-black/60 flex flex-col transition-all duration-300 origin-bottom-right ${open ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"}`}>
        <header className="px-4 py-3 flex items-center justify-between ring-1 ring-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-full bg-emerald-400 grid place-items-center text-zinc-950 ring-2 ring-emerald-400/30">
              <Icon name="sparkles" size={14} strokeWidth={2}/>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-100 leading-tight">Monty</span>
              <span className="text-[10px] text-zinc-500 leading-tight">{ctxLabel}</span>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="size-7 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="x" size={14}/>
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "bg-zinc-100 text-zinc-950 rounded-br-md"
                  : "bg-zinc-900 text-zinc-200 rounded-bl-md"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="bg-zinc-900 text-zinc-300 rounded-2xl rounded-bl-md px-3 py-2 text-[13px] inline-flex items-center gap-2">
                <span className="inline-flex gap-1">
                  <span className="size-1.5 rounded-full bg-zinc-500 animate-pulse"></span>
                  <span className="size-1.5 rounded-full bg-zinc-500 animate-pulse" style={{ animationDelay: "150ms" }}></span>
                  <span className="size-1.5 rounded-full bg-zinc-500 animate-pulse" style={{ animationDelay: "300ms" }}></span>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
          {["What's the SF?", "Any structural docs?", "Materials owner picked?"].map(q => (
            <button key={q} onClick={() => setDraft(q)}
              className="text-[11px] px-2 py-1 rounded-full bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 ring-1 ring-zinc-800">
              {q}
            </button>
          ))}
        </div>

        <footer className="p-3 ring-1 ring-zinc-800/60">
          <form onSubmit={e => { e.preventDefault(); send(); }} className="flex items-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask Monty anything…"
              className="flex-1 h-9 px-3 text-sm bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none"/>
            <button type="submit" disabled={!draft.trim() || thinking}
              className="size-9 grid place-items-center rounded-md bg-zinc-100 text-zinc-950 hover:bg-white disabled:opacity-40 transition-all">
              <Icon name="send" size={14}/>
            </button>
          </form>
          <p className="text-[10px] text-zinc-600 mt-1.5 text-center">Monty sees what you're looking at. Doesn't see your bid totals.</p>
        </footer>
      </div>
    </>
  );
}

Object.assign(window, {
  BidDrawer, AddBidLineForm, MontyCallout, RoomDetailOverlay,
  MontyFAB, BlinkingMarkerOnPlan, FloorPlanModal,
  ACTIVITY_OPTIONS, ACTIVITY_TYPICAL, validateBidLine,
});
