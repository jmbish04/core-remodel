/* eslint-disable */
// =============================================================
// Build-Vision PDF preview
// Light-theme paginated layout that approximates the
// react-pdf output you'd render server-side.
// =============================================================

(() => {
const { useState } = React;

function PdfPreview({ link, persona, visibleSections, budgetMode, rollups, cap, comments, onClose }) {
  const [zoom, setZoom] = useState(0.78);

  // Assign page numbers — each section ≈ 1 page; long ones 2.
  let p = 2; // page 1 is cover (which we emit first); section pages start at 2
  const sectionPages = new Map();
  visibleSections.forEach(s => {
    sectionPages.set(s.id, p);
    if (s.id === "cover") p += 1;
    else if (s.kind === "comparator") p += 2;
    else if (s.lineItems && s.lineItems.length > 4) p += 2;
    else p += 1;
  });
  const totalPages = 1 + visibleSections.length; // rough — actual depends on overflow
  // commentsAppendix is +1 page if there are any
  const commentsPages = comments.length > 0 ? 1 : 0;
  const lastPageNum = 1 + visibleSections.length + commentsPages;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bv-pdf-overlay">
      <div className="bv-pdf-shell">
        <div className="bv-pdf-bar">
          <div className="title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            PDF preview — {link.recipient.company} · {link.uuid.slice(0,8)}
          </div>
          <div className="right">
            <div style={{display:"flex",alignItems:"center",gap:6,marginRight:8}}>
              <button className="bv-btn" onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}>−</button>
              <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-muted)",minWidth:40,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
              <button className="bv-btn" onClick={() => setZoom(z => Math.min(1.4, z + 0.1))}>+</button>
            </div>
            <button className="bv-btn" onClick={handlePrint}>Print</button>
            <button className="bv-btn is-primary" onClick={() => alert('In production this hits a server endpoint that renders react-pdf and returns a .pdf download.')}>
              Download .pdf
            </button>
            <button className="bv-btn" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="bv-pdf-scroll">
          <div style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            width: 816,
            margin: "0 auto",
          }}>
            <PdfCover link={link} persona={persona} budgetMode={budgetMode} rollups={rollups} cap={cap} totalSections={visibleSections.length} lastPageNum={lastPageNum} />
            <PdfTOC link={link} visibleSections={visibleSections} sectionPages={sectionPages} lastPageNum={lastPageNum} />
            {visibleSections.filter(s => s.id !== "cover" && s.id !== "end-of-brief").map(s => (
              <PdfSection
                key={s.id}
                section={s}
                budgetMode={budgetMode}
                pageNum={sectionPages.get(s.id)}
                lastPageNum={lastPageNum}
                link={link}
              />
            ))}
            {comments.length > 0 && (
              <PdfComments
                comments={comments}
                visibleSections={visibleSections}
                pageNum={lastPageNum}
                lastPageNum={lastPageNum}
                link={link}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// PAGES
// -------------------------------------------------------------
function PdfPageRunning({ link, pageNum, lastPageNum, label }) {
  return (
    <>
      <div className="bv-page-running">
        <span>126 Colby Remodel · Build vision · {label}</span>
        <span>{link.recipient.company}</span>
      </div>
      <div className="bv-page-num">{pageNum} / {lastPageNum}</div>
    </>
  );
}

function PdfCover({ link, persona, budgetMode, rollups, cap, totalSections, lastPageNum }) {
  return (
    <div className="bv-page">
      <PdfPageRunning link={link} pageNum={1} lastPageNum={lastPageNum} label="Cover" />
      <div style={{height: 80}} />
      <p className="bv-p-eyebrow">126 Colby · Build vision · for {persona.label.toLowerCase()}</p>
      <h1 className="bv-p-title" style={{fontSize:54, lineHeight:0.98, margin:"0 0 12px"}}>
        126 Colby<br/><span style={{color:"#888",fontWeight:400}}>Remodel.</span>
      </h1>
      <p style={{fontSize:18, color:"#555", margin:"6px 0 28px", maxWidth:"34ch"}}>
        Scope, photos, and bid context — prepared for <strong>{link.recipient.company}</strong>.
      </p>

      <div className="bv-p-welcome">
        <div style={{fontFamily:"Geist Mono",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c8530b",marginBottom:6}}>Welcome, {link.recipient.name}</div>
        {link.welcome}
      </div>

      <div className="bv-p-fact-grid">
        <div className="bv-p-fact"><div className="k">Recipient</div><div className="v">{link.recipient.company}</div></div>
        <div className="bv-p-fact"><div className="k">Role</div><div className="v">{persona.label}</div></div>
        <div className="bv-p-fact"><div className="k">Issued</div><div className="v" style={{fontSize:14}}>{new Date(link.createdAt).toLocaleDateString()}</div></div>
        <div className="bv-p-fact"><div className="k">Expires</div><div className="v" style={{fontSize:14}}>{new Date(link.expiresAt).toLocaleDateString()}</div></div>
      </div>

      {budgetMode !== "off" && (
        <div className="bv-p-budget" style={{marginTop:28}}>
          <div className="col is-min"><div className="k">Min</div><div className="v">${Math.round(rollups.min/1000)}k</div></div>
          <div className="col"><div className="k">Avg</div><div className="v">${Math.round(rollups.avg/1000)}k</div></div>
          <div className="col is-max"><div className="k">Cap</div><div className="v">${Math.round(cap/1000)}k</div></div>
        </div>
      )}

      <div style={{marginTop: "auto", paddingTop: 32, fontFamily: "Geist Mono", fontSize: 10, color: "#999", letterSpacing: "0.1em"}}>
        Confidential · prepared for {link.recipient.company} · link {link.uuid.slice(0,8)} · do not redistribute
      </div>
    </div>
  );
}

function PdfTOC({ link, visibleSections, sectionPages, lastPageNum }) {
  return (
    <div className="bv-page">
      <PdfPageRunning link={link} pageNum={2} lastPageNum={lastPageNum} label="Contents" />
      <div className="bv-p-section-head" style={{marginTop:48}}>
        <p className="bv-p-eyebrow">Contents</p>
        <h1 className="bv-p-title">What's in this brief.</h1>
      </div>
      <div className="bv-p-toc">
        {visibleSections.map(s => (
          <div className="bv-p-toc-row" key={s.id}>
            <span className="n">{s.group}</span>
            <span className="t">{s.title}</span>
            <span className="b">{s.eyebrow || s.groupLabel}</span>
            <span className="p">{sectionPages.get(s.id) || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PdfSection({ section, budgetMode, pageNum, lastPageNum, link }) {
  const detailed = budgetMode === "detailed";
  const rounded  = budgetMode === "rounded";
  const showBudget = budgetMode !== "off";
  const fmt = (n) => rounded ? `$${Math.round(n/1000)}k` : `$${n.toLocaleString()}`;

  return (
    <div className="bv-page">
      <PdfPageRunning link={link} pageNum={pageNum} lastPageNum={lastPageNum} label={section.title} />
      <div className="bv-p-section-head" style={{marginTop:48}}>
        <p className="bv-p-eyebrow">{section.group} · {section.eyebrow || section.groupLabel}</p>
        <h1 className="bv-p-title">{section.title}.</h1>
      </div>
      {section.summary && <p style={{fontSize:14.5,color:"#333",lineHeight:1.55,maxWidth:"64ch",margin:"0 0 18px"}}>{section.summary}</p>}

      {section.photos && section.photos.length > 0 && (() => {
        const items = section.photos.slice(0, 6).map(p =>
          typeof p === "string" ? { src: p, caption: "" } : { src: p.src, caption: p.caption || "" }
        );
        const overrides = link?.permissions?.photoCaptions || {};
        return (
          <div className={`bv-p-photos cols-${items.length >= 3 ? 3 : 2}`}>
            {items.map((p, i) => (
              <figure className="bv-p-photo" key={i}>
                <div className="bv-p-photo-img">
                  <img src={p.src} alt={overrides[p.src] || p.caption} />
                </div>
                <figcaption className="bv-p-photo-cap">
                  {overrides[p.src] || p.caption || p.src.split("/").pop()}
                </figcaption>
              </figure>
            ))}
          </div>
        );
      })()}

      {section.budget && showBudget && (
        <div className="bv-p-budget">
          <div className="col is-min"><div className="k">Optimistic · Min</div><div className="v">{fmt(section.budget.min)}</div></div>
          <div className="col"><div className="k">Realistic · Avg</div><div className="v">{fmt(section.budget.avg)}</div></div>
          <div className="col is-max"><div className="k">Risk · Max</div><div className="v">{fmt(section.budget.max)}</div></div>
        </div>
      )}

      {section.lineItems && section.lineItems.length > 0 && (
        <div className="bv-p-lines">
          <div className="bv-p-line bv-p-line-head">
            <span className="scope">Line item</span>
            <span className="num">Min</span>
            <span className="num">Avg</span>
            <span className="num">Max</span>
          </div>
          {section.lineItems.map(it => (
            <div className="bv-p-line" key={it.id}>
              <span className="scope">
                {it.scope}
                <span className="trades">{it.trades.map(t => window.BV_TRADES[t]?.abbr || t).join(" · ")}</span>
              </span>
              <span className="num">{showBudget ? (detailed ? fmt(it.min) : `≈${Math.round(it.min/1000)}k`) : "—"}</span>
              <span className="num">{showBudget ? (detailed ? fmt(it.avg) : `≈${Math.round(it.avg/1000)}k`) : "—"}</span>
              <span className="num">{showBudget ? (detailed ? fmt(it.max) : `≈${Math.round(it.max/1000)}k`) : "—"}</span>
            </div>
          ))}
        </div>
      )}

      {section.kind === "comparator" && (
        <div style={{marginTop:18}}>
          <div className="bv-p-line bv-p-line-head">
            <span className="scope">Scenario</span>
            <span className="num">A</span>
            <span className="num">B</span>
            <span className="num">C</span>
          </div>
          {section.comparison.map((r, i) => (
            <div className="bv-p-line" key={i}>
              <span className="scope">{r.label}</span>
              <span className="num">{showBudget ? (detailed ? fmt(r.a) : `≈${Math.round(r.a/1000)}k`) : "—"}</span>
              <span className="num">{showBudget ? (detailed ? fmt(r.b) : `≈${Math.round(r.b/1000)}k`) : "—"}</span>
              <span className="num">{showBudget ? (detailed ? fmt(r.c) : `≈${Math.round(r.c/1000)}k`) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PdfComments({ comments, visibleSections, pageNum, lastPageNum, link }) {
  const sectionsById = Object.fromEntries(visibleSections.map(s => [s.id, s]));
  const order = visibleSections.map(s => s.id);
  const grouped = order
    .map(id => ({ section: sectionsById[id], comments: comments.filter(c => c.sectionId === id) }))
    .filter(g => g.section && g.comments.length > 0);

  return (
    <div className="bv-page">
      <PdfPageRunning link={link} pageNum={pageNum} lastPageNum={lastPageNum} label="Questions" />
      <div className="bv-p-section-head" style={{marginTop:48}}>
        <p className="bv-p-eyebrow">Appendix · {comments.length} {comments.length === 1 ? "question" : "questions"}</p>
        <h1 className="bv-p-title">Your questions &amp; comments.</h1>
      </div>
      {grouped.map(g => (
        <div key={g.section.id} style={{marginBottom: 18}}>
          <div style={{fontFamily:"Geist Mono",fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"#777",paddingBottom:6,borderBottom:"1px solid #ddd",marginBottom:10}}>
            {g.section.group} · {g.section.title}
          </div>
          {g.comments.map(c => {
            const isAi    = c.kind === "ai-chat";
            const isAnnot = c.photoSrc && c.annotations && c.annotations.length > 0;
            const isPhoto = c.photoSrc && !isAnnot;
            return (
              <div className="bv-p-q" key={c.id}>
                <div className="anchor">
                  {isAi    && <span className="kind-tag is-ai">AI chat</span>}
                  {isAnnot && <span className="kind-tag is-annot">Annotation</span>}
                  {isPhoto && <span className="kind-tag is-photo">Photo</span>}
                  {!isAi && !isPhoto && !isAnnot && <span className="kind-tag">Comment</span>}
                  {c.anchor}
                </div>
                {c.photoSrc && (
                  <div className="bv-p-q-photo">
                    <div className="img">
                      <img src={c.photoSrc} alt="" />
                      {(c.annotations || []).map((a, i) => (
                        <div
                          key={i}
                          className="annot"
                          style={{ left: `${a.x*100}%`, top: `${a.y*100}%`, width: `${a.w*100}%`, height: `${a.h*100}%` }}
                        >
                          <span className="num">{i+1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="body">{c.text}</div>
                {c.messages && c.messages.length > 0 && (
                  <div className="bv-p-q-chat">
                    {c.messages.map((m, i) => (
                      <div key={i} className={`turn ${m.role}`}>
                        <span className="role">{m.role === "assistant" ? "AI" : "User"}</span>
                        <span>{m.content}</span>
                      </div>
                    ))}
                  </div>
                )}
                {c.reply && (
                  <div className="reply">
                    <div className="from">Reply · 126 Colby team</div>
                    {c.reply.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { PdfPreview });
})();
