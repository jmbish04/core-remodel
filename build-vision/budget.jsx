/* eslint-disable */
// =============================================================
// Build-Vision Budget Pulse
// - Animated KPI strip + budget progress bar
// - What-if toggles (steam shower, smart shower, kitchen swap)
// - Line items with variance bars + accept/reject/counter
// - Kitchen comparator
// =============================================================

(() => {
const { useState, useEffect, useMemo, useRef } = React;

// -------------------------------------------------------------
// AnimatedNumber — tween value
// -------------------------------------------------------------
function AnimatedCurrency({ value, prefix = "$", rounded = false }) {
  const [shown, setShown] = useState(value);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = shown;
    const end = value;
    const dur = 500;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (end - start) * e);
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  const v = Math.round(shown);
  if (rounded) {
    if (v >= 1000) return <>{prefix}{Math.round(v / 1000)}k</>;
    return <>{prefix}{v}</>;
  }
  return <>{prefix}{v.toLocaleString()}</>;
}

// -------------------------------------------------------------
// Budget Pulse — KPI strip + progress bar + what-if
// -------------------------------------------------------------
function BudgetPulse({ rollups, cap, config, onToggle, budgetMode }) {
  const isOver = rollups.avg > cap;
  const diff = Math.abs(rollups.avg - cap);
  const pct = Math.min((rollups.avg / cap) * 100, 100);

  const showRounded = budgetMode === "rounded";

  return (
    <section className="bv-budget-pulse">
      <div className="bv-kpi-grid">
        <div className="bv-kpi">
          <div className="k">Baseline Cap</div>
          <div className="v"><AnimatedCurrency value={cap} rounded={showRounded} /></div>
          <div className="sub">Phase 1 absolute ceiling</div>
        </div>
        <div className="bv-kpi is-good">
          <div className="k">Optimistic · Min</div>
          <div className="v"><AnimatedCurrency value={rollups.min} rounded={showRounded} /></div>
          <div className="sub">Best-case footprint, in-kind layouts</div>
        </div>
        <div className={`bv-kpi ${isOver ? "is-bad" : ""}`}>
          <div className="k">Realistic · Avg</div>
          <div className="v"><AnimatedCurrency value={rollups.avg} rounded={showRounded} /></div>
          <div className="sub">
            {isOver
              ? <>{`$${Math.round(diff / 1000)}k over cap`}</>
              : <>{`$${Math.round(diff / 1000)}k under cap`}</>}
          </div>
        </div>
        <div className="bv-kpi is-warn">
          <div className="k">Risk Ceiling · Max</div>
          <div className="v"><AnimatedCurrency value={rollups.max} rounded={showRounded} /></div>
          <div className="sub">Worst-case contingency burn</div>
        </div>
      </div>

      <div className="bv-progress">
        <div className="bv-progress-head">
          <span>Avg cost progress</span>
          <span style={{color: isOver ? "var(--bv-red)" : "var(--bv-emerald)"}}>
            {pct.toFixed(1)}% of cap
          </span>
        </div>
        <div className="bv-progress-bar">
          <div className={`bv-progress-fill ${isOver ? "is-over" : ""}`} style={{width: `${pct}%`}} />
          <div className="bv-progress-cap" style={{left: "100%"}} />
        </div>
        <div className="bv-progress-foot">
          <span>Active: kitchen {config.kitchen.toUpperCase()} · shower {config.shower} {config.steam && "· steam"} {config.smart && "· smart"}</span>
          <span style={{fontFamily: "var(--font-mono)"}}>${cap.toLocaleString()} cap</span>
        </div>
      </div>

      <div className="bv-whatif">
        <div className={`bv-whatif-card ${config.steam ? "is-on" : ""}`}>
          <div className="switch-row" style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <div className="lbl">Steam shower</div>
            <div className={`bv-switch ${config.steam ? "is-on" : ""}`} onClick={() => onToggle("steam")} />
          </div>
          <div className="v">+$8,000 avg</div>
          <div style={{fontSize:11, color:"var(--ink-faint)"}}>Mr.Steam MS90 · 240V circuit</div>
        </div>
        <div className={`bv-whatif-card ${config.smart ? "is-on" : ""}`}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <div className="lbl">Smart controller</div>
            <div className={`bv-switch ${config.smart ? "is-on" : ""}`} onClick={() => onToggle("smart")} />
          </div>
          <div className="v">+$2,450 avg</div>
          <div style={{fontSize:11, color:"var(--ink-faint)"}}>U by Moen 4-outlet · Wi-Fi</div>
        </div>
        <div className="bv-whatif-card">
          <div className="lbl">Kitchen scenario</div>
          <div style={{display:"flex", gap: 4, marginTop: 4}}>
            {["a","b","c","d"].map(k => (
              <button
                key={k}
                onClick={() => onToggle("kitchen", k)}
                style={{
                  flex: 1, padding: "6px 0",
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--rule)",
                  background: config.kitchen === k ? "var(--bv-accent-soft)" : "transparent",
                  color: config.kitchen === k ? "var(--bv-accent)" : "var(--ink-muted)",
                  borderColor: config.kitchen === k ? "var(--bv-accent)" : "var(--rule)",
                  borderRadius: 4, cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <div style={{fontSize:11, color:"var(--ink-faint)", marginTop: 4}}>What-if comparison only — won't save</div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// Line items list — with trade filter, variance bars, expand,
// accept/reject/counter actions
// -------------------------------------------------------------
function LineItems({ items, budgetMode, decisions, onDecide, comments, openPopover, sectionId }) {
  const [tradeFilter, setTradeFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const showVariance = budgetMode !== "off";
  const detailedBudget = budgetMode === "detailed";

  if (!items || items.length === 0) return null;

  // collect trades from items
  const trades = Array.from(new Set(items.flatMap(it => it.trades)));

  // min/max across set for variance scaling
  const maxOfAll = Math.max(...items.map(it => it.max));

  const visibleItems = tradeFilter
    ? items.filter(it => it.trades.includes(tradeFilter))
    : items;

  return (
    <div className="bv-lines">
      <div className="bv-lines-head">
        <div className="bv-lines-h">Line items · {items.length}{showVariance ? " · variance min/avg/max" : ""}</div>
        <div className="bv-trade-filter">
          {trades.map(t => (
            <button
              key={t}
              data-trade={t}
              className={`bv-trade-chip ${tradeFilter === t ? "is-active" : ""}`}
              onClick={() => setTradeFilter(tradeFilter === t ? null : t)}
            >
              {window.BV_TRADES[t]?.abbr || t}
            </button>
          ))}
          {tradeFilter && (
            <button className="bv-trade-chip" onClick={() => setTradeFilter(null)} style={{color: "var(--bv-accent)"}}>
              Clear
            </button>
          )}
        </div>
      </div>

      {visibleItems.map(it => {
        const dec = decisions[it.id] || null;
        const isExpanded = expanded === it.id;
        const min = it.min, avg = it.avg, max = it.max;
        const fillPct = max > 0 ? (max / maxOfAll) * 100 : 0;
        const minPct  = max > 0 ? (min / max) * 100 : 0;
        const avgPct  = max > 0 ? (avg / max) * 100 : 0;

        return (
          <React.Fragment key={it.id}>
            <div className="bv-line" onClick={() => setExpanded(isExpanded ? null : it.id)}>
              <div className="bv-line-l">
                <div className="bv-line-scope">
                  <CommentAnchor
                    sectionId={sectionId}
                    anchorText={it.scope}
                    comments={comments}
                    openPopover={openPopover}
                  />
                </div>
                <div className="bv-line-trades">
                  {it.trades.map(t => (
                    <span key={t} className="bv-line-trade" data-trade={t}>
                      {window.BV_TRADES[t]?.abbr || t}
                    </span>
                  ))}
                </div>
              </div>

              {showVariance && (
                <div className="bv-line-variance">
                  <div className="bv-variance-bar" style={{ width: `${fillPct * 1.8}px`, maxWidth: 220, minWidth: 120 }}>
                    <div
                      className="bv-variance-fill"
                      style={{ left: `${minPct}%`, width: `${100 - minPct}%` }}
                    />
                    <div className="bv-variance-avg" style={{ left: `${avgPct}%` }} />
                  </div>
                  <div className="bv-variance-nums">
                    <span className={detailedBudget ? "" : "blur"}>${(min/1000).toFixed(1)}k</span>
                    <span className={`avg ${detailedBudget ? "" : "blur"}`}>${(avg/1000).toFixed(1)}k</span>
                    <span className={detailedBudget ? "" : "blur"}>${(max/1000).toFixed(1)}k</span>
                  </div>
                </div>
              )}

              <div className="bv-line-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`bv-line-act ok ${dec === "ok" ? "is-on" : ""}`}
                  onClick={() => onDecide(it.id, dec === "ok" ? null : "ok")}
                  title="Accept this line as scoped"
                >Accept</button>
                <button
                  className={`bv-line-act no ${dec === "no" ? "is-on" : ""}`}
                  onClick={() => onDecide(it.id, dec === "no" ? null : "no")}
                  title="Reject — can't bid this scope"
                >Reject</button>
                <button
                  className={`bv-line-act ctr ${dec && dec.startsWith("ctr") ? "is-on" : ""}`}
                  onClick={() => onDecide(it.id, dec && dec.startsWith("ctr") ? null : "ctr:")}
                  title="Counter with my own number"
                >Counter</button>
              </div>
            </div>

            {isExpanded && (
              <div className="bv-line-expand">
                <div className="bv-line-source">
                  <span style={{color: "var(--ink-faint)"}}>D1 source row:</span>
                  <span className="pill">{it.source}</span>
                </div>
                <div className="bv-line-rationale">
                  {it.rationale}
                </div>
                {dec && dec.startsWith("ctr") && (
                  <div className="bv-line-counter">
                    <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:"0.1em"}}>Your number:</span>
                    <input
                      type="text"
                      placeholder="$0,000"
                      value={dec.slice(4)}
                      onChange={(e) => onDecide(it.id, "ctr:" + e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------
// Kitchen comparator
// -------------------------------------------------------------
function KitchenComparator({ section, budgetMode, activeKitchen, onSelectKitchen, onOpenMindmap }) {
  const detailed = budgetMode === "detailed";
  const showVariance = budgetMode !== "off";

  return (
    <div data-comment-anchor="kitchen-comparator">
      {onOpenMindmap && (
        <div className="bv-mm-trigger">
          <button className="bv-mm-trigger-btn" onClick={onOpenMindmap}>
            <span className="ic" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="6" cy="6" r="2.4"/>
                <circle cx="6" cy="18" r="2.4"/>
                <circle cx="18" cy="6" r="2.4"/>
                <circle cx="18" cy="18" r="2.4"/>
                <circle cx="12" cy="12" r="2.6"/>
                <path d="M8.2 7.2L9.8 10.6M8.2 16.8L9.8 13.4M15.8 7.2L14.2 10.6M15.8 16.8L14.2 13.4"/>
              </svg>
            </span>
            <span className="lbl">
              <span className="t">View scenario mind map</span>
              <span className="s">Overall plan · branches · room-by-room deviations</span>
            </span>
            <span className="arr" aria-hidden="true">→</span>
          </button>
        </div>
      )}
      <div className="bv-scen-grid">
        {section.scenarios.map(sc => {
          const isActive = activeKitchen === sc.key;
          const cls = isActive ? "is-active" : sc.status === "baseline" ? "is-baseline" : "";
          return (
            <div key={sc.key} className={`bv-scen ${cls}`}>
              {sc.status === "active"  && <span className="bv-badge active badge-pin">Active</span>}
              {sc.status === "baseline"&& <span className="bv-badge baseline badge-pin">Baseline</span>}
              {sc.status === "parked"  && <span className="bv-badge parked badge-pin">Parked</span>}
              <div className="h">{sc.label}</div>
              <div className="meta">{sc.loc} · {sc.sub}</div>
              <div className="row"><span className="k">Layout</span><span className="v">{sc.layout}</span></div>
              <div className="row"><span className="k">Plumbing</span><span className="v" style={{textAlign:"right",maxWidth:"60%"}}>{sc.plumbing}</span></div>
              <div className="dev">
                <span className="k">Δ vs in-kind</span>
                <span className={`v ${showVariance ? "" : "blur"}`}>${(sc.deviation/1000).toFixed(0)}k</span>
              </div>
              {onSelectKitchen && (
                <button
                  onClick={() => onSelectKitchen(sc.key)}
                  disabled={isActive}
                  style={{
                    marginTop: 10, padding: "8px 12px",
                    fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    border: "1px solid", borderRadius: 6,
                    background: isActive ? "var(--bv-emerald-soft)" : "var(--bv-accent)",
                    borderColor: isActive ? "var(--bv-emerald)" : "var(--bv-accent)",
                    color: isActive ? "var(--bv-emerald)" : "oklch(0.18 0 0)",
                    cursor: isActive ? "default" : "pointer",
                  }}
                >
                  {isActive ? "Currently active" : "Try this scenario"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="bv-comparison">
        <table>
          <thead>
            <tr>
              <th>Line item</th>
              <th style={{textAlign:"right"}}>A</th>
              <th style={{textAlign:"right"}}>B</th>
              <th style={{textAlign:"right"}}>C</th>
              <th style={{textAlign:"right"}}>D</th>
            </tr>
          </thead>
          <tbody>
            {section.comparison.map((row, idx) => {
              const vals = [row.a, row.b, row.c, row.d];
              const min = Math.min(...vals);
              const max = Math.max(...vals);
              return (
                <tr key={idx}>
                  <td className="lbl">{row.label}</td>
                  {["a","b","c","d"].map(k => {
                    const v = row[k];
                    const cls = v === min ? "is-low" : v === max ? "is-high" : "";
                    return (
                      <td key={k} className={`num ${cls} ${detailed ? "" : "blur"}`}>
                        ${v.toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* totals */}
            <tr>
              <td className="lbl" style={{fontWeight:600, paddingTop:14}}>Total deviation</td>
              {["a","b","c","d"].map(k => {
                const total = section.comparison.reduce((s, r) => s + r[k], 0);
                return (
                  <td key={k} className={`num ${detailed ? "" : "blur"}`} style={{paddingTop:14, fontWeight:600, color:"var(--ink-strong)"}}>
                    ${total.toLocaleString()}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { BudgetPulse, LineItems, KitchenComparator, AnimatedCurrency });
})();
