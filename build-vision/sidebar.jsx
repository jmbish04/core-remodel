/* eslint-disable */
// =============================================================
// Build-Vision Sidebar
// Two modes: TOC (text outline) and Thumbs (PDF page strip)
// =============================================================

(() => {
const { useMemo, useState } = React;

function BvSidebar({
  link, persona, sections, mode, setMode,
  activeId, onJumpTo,
  onPdfPreview, onAdminView,
  budgetVisible, totalAvg, cap,
}) {
  // group sections for TOC + thumbnails
  const groups = useMemo(() => {
    const seen = new Map();
    sections.forEach(s => {
      if (!seen.has(s.group)) seen.set(s.group, { group: s.group, label: s.groupLabel, items: [] });
      seen.get(s.group).items.push(s);
    });
    return Array.from(seen.values());
  }, [sections]);

  const fmt = (v) => "$" + Math.round(v / 1000) + "k";

  return (
    <aside className="bv-sb">
      {/* Head */}
      <div className="bv-sb-head">
        <div className="mark">
          <span className="dot" />
          <span>126 Colby</span>
        </div>
        <div className="recipient">
          For
          <span className="who">
            {link.recipient.name} · {link.recipient.company}
          </span>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="bv-sb-modes">
        <button
          className={`bv-sb-mode ${mode === "toc" ? "is-active" : ""}`}
          onClick={() => setMode("toc")}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          Outline
        </button>
        <button
          className={`bv-sb-mode ${mode === "thumbs" ? "is-active" : ""}`}
          onClick={() => setMode("thumbs")}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          Pages
        </button>
      </div>

      {/* Body */}
      <div className="bv-sb-body">
        {mode === "toc" && (
          <BvToc
            groups={groups}
            activeId={activeId}
            onJumpTo={onJumpTo}
            budgetVisible={budgetVisible}
            fmt={fmt}
          />
        )}
        {mode === "thumbs" && (
          <BvThumbs
            groups={groups}
            activeId={activeId}
            onJumpTo={onJumpTo}
          />
        )}
      </div>

      {/* Foot */}
      <div className="bv-sb-foot">
        {budgetVisible && (
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10.5,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: "var(--ink-muted)", display: "flex", justifyContent: "space-between",
            paddingBottom: 4,
          }}>
            <span>Total</span>
            <span style={{ color: "var(--ink-strong)" }}>{fmt(totalAvg)} <span style={{color:"var(--ink-faint)"}}>/ {fmt(cap)}</span></span>
          </div>
        )}
        <button className="bv-sb-btn is-primary" onClick={onPdfPreview}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          Download PDF
        </button>
        <button className="bv-sb-btn" onClick={onAdminView}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Admin
        </button>
      </div>
    </aside>
  );
}

function BvToc({ groups, activeId, onJumpTo, budgetVisible, fmt }) {
  return (
    <>
      {groups.map(g => (
        <div className="bv-toc-group" key={g.group}>
          <div className="bv-toc-glabel">
            <span className="gnum">{g.group}</span>
            <span>{g.label}</span>
            {g.items.some(it => it.flag === "primary") && (
              <span className="tag">· primary</span>
            )}
          </div>
          <ul className="bv-toc-list">
            {g.items.map(s => {
              let count = "";
              if (budgetVisible && s.budget) count = fmt(s.budget.avg);
              else if (s.kind === "comparator") count = "A/B/C/D";
              else if (s.kind === "cover") count = "brief";
              else if (s.kind === "wrap") count = "recap";
              else if (s.badge) count = s.badge;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={activeId === s.id ? "is-active" : ""}
                    onClick={(e) => { e.preventDefault(); onJumpTo(s.id); }}
                  >
                    <span className="marker" />
                    <span>{s.title}</span>
                    {count && <span className="count">{count}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function BvThumbs({ groups, activeId, onJumpTo }) {
  // Assign page numbers to each section (each section ≈ 1 page; complex ones get 2)
  let pageNum = 1;
  const sectionToPage = new Map();
  groups.forEach(g => g.items.forEach(s => {
    sectionToPage.set(s.id, pageNum);
    // multi-page sections
    if (s.kind === "comparator") pageNum += 2;
    else if (s.lineItems && s.lineItems.length > 4) pageNum += 2;
    else pageNum += 1;
  }));

  // Resolve a thumbnail preview: pick the first available photo, or null
  const thumbSrc = (s) => {
    if (s.photos && s.photos[0]) return s.photos[0];
    if (s.hero) return s.hero;
    return null;
  };

  return (
    <div className="bv-thumbs">
      {groups.map(g => (
        <div className="bv-thumb-group" key={g.group}>
          <div className="bv-thumb-glabel">
            <span style={{color: "var(--ink-muted)"}}>{g.group}</span>
            <span>{g.label}</span>
          </div>
          <div className="bv-thumb-list">
            {g.items.map(s => {
              const src = thumbSrc(s);
              const p = sectionToPage.get(s.id);
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={`bv-thumb ${activeId === s.id ? "is-active" : ""}`}
                  onClick={(e) => { e.preventDefault(); onJumpTo(s.id); }}
                >
                  {src ? (
                    <img className="bv-thumb-img" src={src} alt="" />
                  ) : (
                    <div className="bv-thumb-img" style={{background: "linear-gradient(135deg, oklch(0.22 0 0), oklch(0.18 0 0))"}} />
                  )}
                  <div className="bv-thumb-shade" />
                  <div className="bv-thumb-page">p.{p}</div>
                  <div className="bv-thumb-meta">
                    <div className="bv-thumb-num">{s.group}</div>
                    <div className="bv-thumb-title">{s.title}</div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { BvSidebar });
})();
