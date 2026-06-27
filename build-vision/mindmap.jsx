/* eslint-disable */
// =============================================================
// Build-Vision Scenario Mind Map
// ---------------------------------------------------------------
// A vertical mind map that mirrors the page outline: the brief's
// trunk runs top-to-bottom (flooring → bathrooms → kitchen → …)
// and branches fan out into per-room variations + deviations.
// The map scrolls along its trunk like the page does and the
// branches scale out / scale back in as they enter view.
// =============================================================

(() => {
const { useState, useEffect, useRef, useMemo } = React;

// Build the mind-map tree from BV_SECTIONS. Kitchen pulls its
// scenarios from the comparator section's `scenarios` array.
function buildTree() {
  const sections = window.BV_SECTIONS || [];
  const kitchen = sections.find(s => s.id === "kitchen");
  const k = (id) => sections.find(s => s.id === id);

  return [
    { id: "cover", side: "left", title: "Cover", sub: "126 Colby · brief", color: "neutral" },
    {
      id: "backyard", side: "right", title: "Backyard", sub: "Primary goal · drainage + patio", color: "blue",
      branches: [
        { id: "bk-drain", title: "French drain", sub: "Existing storm tie-in · ~80 lf" },
        { id: "bk-patio", title: "New concrete patio", sub: "320 sf · tied to deck footing" },
        { id: "bk-retain", title: "Retaining wall swap", sub: "Wood pony wall → CMU/PT" },
      ],
    },
    {
      id: "flooring", side: "left", title: "Flooring", sub: "Whole-house refinish · no new coverings", color: "emerald",
      branches: [
        { id: "fl-up", title: "Upper · white oak", sub: "1,840 sf refinish · 3-pass + Bona Traffic" },
        { id: "fl-lo", title: "Lower · concrete", sub: "920 sf polish + densifier + seal" },
      ],
    },
    {
      id: "bathrooms", side: "right", title: "Bathrooms", sub: "Two non-primary baths · refresh only", color: "neutral",
      branches: [
        { id: "ba-hall", title: "Hall bath", sub: "Vanity + faucet + LED + paint" },
        { id: "ba-lower", title: "Lower bath", sub: "Same scope · stock vanity" },
      ],
    },
    {
      id: "primary-suite", side: "left", title: "Primary suite", sub: "Suite + TBD shower assembly", color: "violet",
      branches: [
        { id: "ps-pan",  title: "Curbless pan + linear drain", sub: "Subfloor lowered 1.5″" },
        { id: "ps-tile", title: "Tile · 110 sf", sub: "Large-format porcelain · Schluter" },
        { id: "ps-steam",title: "Optional · steam generator", sub: "Mr.Steam MS90 · 240V (toggle)" },
        { id: "ps-smart",title: "Optional · smart controller", sub: "U by Moen · 4-outlet (toggle)" },
        { id: "ps-laun", title: "Laundry stack relocation", sub: "Wall move · new 2″ vent" },
        { id: "ps-van",  title: "Double vanity + sconces", sub: "Custom walnut · flanking sconces" },
      ],
    },
    {
      id: "kitchen", side: "right", title: "Kitchen", sub: "Four scenarios under evaluation", color: "accent",
      isTrunk: true,
      branches: (kitchen?.scenarios || []).map(sc => ({
        id: `k-${sc.key}`,
        title: `${sc.label} · ${sc.layout}`,
        sub: `${sc.loc} · ${sc.sub} · Δ $${(sc.deviation/1000).toFixed(0)}k`,
        status: sc.status,
        photoCount: (k(`kitchen-${sc.key}`)?.photos || []).length,
      })),
    },
    {
      id: "utilities", side: "left", title: "Utilities", sub: "Panel upgrade · cooling bundle", color: "amber",
      branches: [
        { id: "ut-pge",   title: "PG&E 125A → 200A", sub: "Mast + meter + main · 8–14 wk lead" },
        { id: "ut-panel", title: "Main + sub panel swap", sub: "Square D QO 40 · AFCI/GFCI" },
        { id: "ut-mr",    title: "MrCool mini-split", sub: "3-zone · linesets in soffit" },
        { id: "ut-gas",   title: "Gas meter (contingent)", sub: "Only if clearance triggers" },
      ],
    },
    { id: "end-of-brief", side: "right", title: "Wrap", sub: "Questions · sign-off", color: "neutral" },
  ];
}

function ScenarioMindmap({ onClose, onJumpToSection }) {
  const tree = useMemo(buildTree, []);
  const stageRef = useRef(null);
  const [visible, setVisible] = useState(new Set([tree[0]?.id]));
  const [activeIndex, setActiveIndex] = useState(0);

  // Reveal nodes as they scroll into view (Stagger their branches out
  // from the trunk; collapse them back as they leave the viewport).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        const id = e.target.dataset.nodeId;
        if (!id) return;
        if (e.isIntersecting) {
          setVisible(v => { const n = new Set(v); n.add(id); return n; });
          const idx = tree.findIndex(t => t.id === id);
          if (idx >= 0 && e.intersectionRatio > 0.4) setActiveIndex(idx);
        } else {
          setVisible(v => { const n = new Set(v); n.delete(id); return n; });
        }
      });
    }, { root: stage, threshold: [0, 0.35, 0.7] });
    stage.querySelectorAll("[data-node-id]").forEach(n => obs.observe(n));
    return () => obs.disconnect();
  }, [tree]);

  // Keyboard close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jumpToNode = (i) => {
    const el = stageRef.current?.querySelector(`[data-node-index="${i}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="bv-mm-overlay" role="dialog" aria-modal="true" aria-label="Scenario mind map">
      <div className="bv-mm-scrim" onClick={onClose} />
      <div className="bv-mm-window">
        {/* Header */}
        <div className="bv-mm-head">
          <div className="bv-mm-head-l">
            <div className="eyebrow">
              <span className="num">04</span>
              <span className="sep">·</span>
              <span>Scenarios &amp; deviations</span>
            </div>
            <h2 className="bv-mm-title">Overall plan, branch by branch.</h2>
            <p className="bv-mm-lede">
              The trunk follows the brief order. Each branch shows the variations and deviations under that room. Scroll the map vertically — branches expand as you reach them.
            </p>
          </div>
          <button className="bv-mm-close" onClick={onClose} aria-label="Close mind map">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body: rail (left) + stage (right) */}
        <div className="bv-mm-body">
          {/* Rail */}
          <div className="bv-mm-rail">
            <div className="bv-mm-rail-h">Trunk</div>
            <ol className="bv-mm-rail-list">
              {tree.map((n, i) => (
                <li
                  key={n.id}
                  className={`bv-mm-rail-item ${i === activeIndex ? "is-active" : ""} c-${n.color || "neutral"}`}
                  onClick={() => jumpToNode(i)}
                >
                  <span className="dot" />
                  <span className="lbl">
                    <span className="t">{n.title}</span>
                    {n.branches && <span className="ct">{n.branches.length}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <div className="bv-mm-rail-foot">
              <button
                className="bv-btn"
                onClick={() => { onClose?.(); onJumpToSection?.(tree[activeIndex].id); }}
              >
                Open {tree[activeIndex].title} →
              </button>
            </div>
          </div>

          {/* Stage */}
          <div className="bv-mm-stage" ref={stageRef}>
            <div className="bv-mm-trunk" aria-hidden="true" />
            {tree.map((n, i) => {
              const isVisible = visible.has(n.id);
              return (
                <div
                  key={n.id}
                  className={`bv-mm-row side-${n.side} c-${n.color || "neutral"} ${isVisible ? "is-in" : ""}`}
                  data-node-id={n.id}
                  data-node-index={i}
                >
                  {/* Connector from trunk to node */}
                  <div className="bv-mm-connector" aria-hidden="true">
                    <svg viewBox="0 0 120 80" preserveAspectRatio="none">
                      <path
                        d={n.side === "left"
                          ? "M120,40 C90,40 60,10 30,10 L0,10"
                          : "M0,40 C30,40 60,10 90,10 L120,10"}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="2 4"
                      />
                    </svg>
                  </div>

                  {/* Node */}
                  <button
                    className="bv-mm-node"
                    onClick={() => { onClose?.(); onJumpToSection?.(n.id); }}
                  >
                    <div className="bv-mm-node-head">
                      <span className="dot" />
                      <span className="t">{n.title}</span>
                      {n.branches && <span className="ct">{n.branches.length}</span>}
                    </div>
                    <div className="bv-mm-node-sub">{n.sub}</div>
                  </button>

                  {/* Branches */}
                  {n.branches && n.branches.length > 0 && (
                    <div className="bv-mm-branches">
                      {n.branches.map((b, bi) => (
                        <div
                          key={b.id}
                          className={`bv-mm-branch ${b.status ? `s-${b.status}` : ""}`}
                          style={{ transitionDelay: `${80 + bi * 60}ms` }}
                        >
                          <div className="bv-mm-branch-line" aria-hidden="true" />
                          <div className="bv-mm-branch-card">
                            <div className="t">
                              {b.title}
                              {b.status === "active"   && <span className="tag t-active">Active</span>}
                              {b.status === "baseline" && <span className="tag t-baseline">Baseline</span>}
                              {b.status === "parked"   && <span className="tag t-parked">Parked</span>}
                            </div>
                            <div className="sub">{b.sub}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="bv-mm-end">
              <span>End of trunk</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScenarioMindmap });
})();
