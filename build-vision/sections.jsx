/* eslint-disable */
// =============================================================
// Build-Vision section renderers
// One render function per section "kind"; default = standard.
// =============================================================

(() => {
const { Fragment } = React;

// -------------------------------------------------------------
// Photo grid — auto picks columns based on count
//
// Each photo is { src, caption } (legacy: a plain src string).
// The caption is a default; link.permissions.photoCaptions[src]
// overrides it when the admin customized the bid link.
// Clicking a photo opens the lightbox (caption visible, supports
// whole-photo + area-rectangle annotations).
// -------------------------------------------------------------
function normalizePhoto(p) {
  if (!p) return null;
  if (typeof p === "string") return { src: p, caption: "" };
  return { src: p.src, caption: p.caption || "" };
}

function PhotoGrid({ photos, sectionId, link, comments, onOpenLightbox }) {
  if (!photos || photos.length === 0) return null;
  const items = photos.map(normalizePhoto).filter(Boolean);
  const overrides = link?.permissions?.photoCaptions || {};
  const cols = items.length === 1 ? 1 : items.length === 2 ? 2 : items.length <= 4 ? 2 : 3;
  return (
    <div className={`bv-photos cols-${cols}`}>
      {items.map((p, i) => {
        const caption = overrides[p.src] || p.caption;
        const photoComments = (comments || []).filter(c => c.photoSrc === p.src);
        const annotCount = photoComments.reduce((n, c) => n + (c.annotations ? c.annotations.length : 0), 0);
        const hasOverall = photoComments.some(c => !c.annotations || c.annotations.length === 0);
        const pinCount = photoComments.length;
        return (
          <button
            type="button"
            className="bv-photo"
            key={p.src + i}
            onClick={() => onOpenLightbox && onOpenLightbox({
              photos: items.map(x => ({ ...x, caption: overrides[x.src] || x.caption })),
              index: i,
              sectionId,
            })}
            aria-label={`Open photo: ${caption || p.src.split("/").pop()}`}
          >
            <img src={p.src} alt={caption} loading="lazy" />
            {pinCount > 0 && (
              <div className="bv-photo-pins" aria-hidden="true">
                {hasOverall && <span className="pin pin-overall" title="Comment on photo">💬</span>}
                {annotCount > 0 && <span className="pin pin-annot" title={`${annotCount} annotation${annotCount===1?"":"s"}`}>{annotCount}</span>}
              </div>
            )}
            <div className="bv-photo-heading">
              <span className="bv-photo-heading-txt">{caption || "\u00A0"}</span>
              <span className="bv-photo-heading-zoom" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
                </svg>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------
// Section head shared chrome
// -------------------------------------------------------------
function SecHead({ section }) {
  return (
    <header className="bv-sec-head">
      <p className="bv-eyebrow">
        <span className="num">{section.group}</span>
        <span className="sep">·</span>
        <span>{section.eyebrow || section.groupLabel}</span>
        {section.flag === "primary" && <><span className="sep">·</span><span className="tag">primary goal</span></>}
        {section.badge === "active" && <><span className="sep">·</span><span className="tag" style={{color:"var(--bv-emerald)"}}>active</span></>}
        {section.badge === "parked" && <><span className="sep">·</span><span className="tag" style={{color:"var(--ink-muted)"}}>parked</span></>}
        {section.badge === "baseline" && <><span className="sep">·</span><span className="tag" style={{color:"var(--bv-blue)"}}>baseline</span></>}
      </p>
      <h2 className="bv-title">{section.title}.</h2>
      {section.summary && <p className="bv-lede">{section.summary}</p>}
    </header>
  );
}

// -------------------------------------------------------------
// Cover
// -------------------------------------------------------------
function CoverSection({ section, link, persona }) {
  return (
    <section
      id="cover"
      className="bv-section"
      style={{paddingTop: 24, borderBottom: "1px solid var(--rule)"}}
      data-screen-label="00 Cover"
    >
      <div className="bv-cover">
        <div className="bv-cover-l">
          <p className="bv-eyebrow">
            <span className="num">126 Colby</span>
            <span className="sep">/</span>
            <span>Build vision · v1</span>
            <span className="sep">/</span>
            <span className="tag">For {link.recipient.role}</span>
          </p>
          <h1 className="bv-cover-display">
            126 Colby<br/>
            <span className="lite">Remodel.</span>
          </h1>
          <div className="bv-welcome">
            {link.welcome}
          </div>
          <div className="bv-cover-facts">
            <div className="bv-cover-fact"><div className="k">Recipient</div><div className="v">{link.recipient.company}</div></div>
            <div className="bv-cover-fact"><div className="k">Role</div><div className="v">{persona.label}</div></div>
            <div className="bv-cover-fact"><div className="k">Link expires</div><div className="v" style={{fontSize:18}}>{new Date(link.expiresAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</div></div>
            <div className="bv-cover-fact"><div className="k">Link ID</div><div className="v" style={{fontFamily:"var(--font-mono)", fontSize:14, letterSpacing:0}}>{link.uuid.slice(0, 8)}</div></div>
          </div>
        </div>
        <div className="bv-cover-r">
          <img src={section.hero} alt="126 Colby" />
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// Standard section (with optional budget + line items + photos)
// -------------------------------------------------------------
function StandardSection({ section, budgetMode, comments, openPopover, openLightbox, link, decisions, onDecide }) {
  return (
    <section
      id={section.id}
      className="bv-section"
      data-screen-label={`${section.group} ${section.title}`}
    >
      <SecHead section={section} />

      {section.photos && section.photos.length > 0 && (
        <PhotoGrid
          photos={section.photos}
          sectionId={section.id}
          link={link}
          comments={comments}
          onOpenLightbox={openLightbox}
        />
      )}

      {section.budget && budgetMode !== "off" && (
        <SectionBudgetCallout budget={section.budget} budgetMode={budgetMode} />
      )}

      {section.lineItems && (
        <LineItems
          items={section.lineItems}
          budgetMode={budgetMode}
          comments={comments}
          openPopover={openPopover}
          decisions={decisions}
          onDecide={onDecide}
          sectionId={section.id}
        />
      )}
    </section>
  );
}

function SectionBudgetCallout({ budget, budgetMode }) {
  const detailed = budgetMode === "detailed";
  const rounded = budgetMode === "rounded";
  const fmt = (n) => rounded ? `$${Math.round(n / 1000)}k` : `$${n.toLocaleString()}`;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12,
      background: "var(--card)", border: "var(--hairline)", borderRadius: "var(--radius-xl)",
      padding: "16px 20px", margin: "20px 0 8px",
    }}>
      <div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:10.5,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--ink-muted)"}}>Optimistic · Min</div>
        <div style={{fontFamily:"var(--font-heading)",fontSize:24,fontWeight:500,color:"var(--bv-emerald)",letterSpacing:"-0.01em"}}>{fmt(budget.min)}</div>
      </div>
      <div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:10.5,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--ink-muted)"}}>Realistic · Avg</div>
        <div style={{fontFamily:"var(--font-heading)",fontSize:28,fontWeight:500,color:"var(--ink-strong)",letterSpacing:"-0.01em"}}>{fmt(budget.avg)}</div>
      </div>
      <div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:10.5,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--ink-muted)"}}>Risk · Max</div>
        <div style={{fontFamily:"var(--font-heading)",fontSize:24,fontWeight:500,color:"var(--bv-amber)",letterSpacing:"-0.01em"}}>{fmt(budget.max)}</div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Internal-only section — only renders when admin opted in.
// No generic "DO NOT SHARE" label; every internal block carries
// its own unique title so the reader knows exactly what's inside.
// -------------------------------------------------------------
function InternalSection({ section }) {
  return (
    <section
      id={section.id}
      className="bv-section"
      data-screen-label={`${section.group} ${section.title}`}
    >
      <SecHead section={section} />
      <div className="bv-internal" data-comment-anchor={`internal-${section.id}`}>
        <div className="bv-internal-pin">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Shared with you only · {section.title}</span>
        </div>
        <h3 className="bv-internal-h">
          {section.internalTitle || `${section.title} — restricted view`}
        </h3>
        <p className="bv-internal-body">
          {section.internalBody || "The $300k Phase 1 cap, scenario triage, parked items, and phasing rationale live here. The admin explicitly opted to share this with you because your scope touches the load-bearing decisions. Please don't forward."}
        </p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// Kitchen overview (with comparator)
// -------------------------------------------------------------
function KitchenOverviewSection({ section, budgetMode, activeKitchen, onSelectKitchen, showComparator, link, comments, openLightbox, onOpenMindmap }) {
  return (
    <section id={section.id} className="bv-section" data-screen-label={`${section.group} ${section.title}`}>
      <SecHead section={section} />
      {section.photos && (
        <PhotoGrid
          photos={section.photos}
          sectionId={section.id}
          link={link}
          comments={comments}
          onOpenLightbox={openLightbox}
        />
      )}
      {showComparator && (
        <KitchenComparator
          section={section}
          budgetMode={budgetMode}
          activeKitchen={activeKitchen}
          onSelectKitchen={onSelectKitchen}
          onOpenMindmap={onOpenMindmap}
        />
      )}
    </section>
  );
}

// -------------------------------------------------------------
// End-of-brief — recap + comments stack
// -------------------------------------------------------------
function EndOfBriefSection({ section, comments, sectionsById, onEdit, onDelete, link }) {
  return (
    <section id="end-of-brief" className="bv-section" data-screen-label="06 End of brief">
      <SecHead section={section} />
      <div style={{
        padding: "24px 0",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24,
      }}>
        <div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--ink-muted)",marginBottom:8}}>What's next</div>
          <p style={{color:"var(--ink-soft)", fontSize: 14, lineHeight: 1.6, margin: 0}}>
            Review any questions you've left below, edit or delete before sending, and we'll respond within 24 hours. When you're ready to submit a formal bid, use the link in your follow-up email — your comments are saved against this UUID and travel with the bid.
          </p>
        </div>
        <div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--ink-muted)",marginBottom:8}}>This view</div>
          <div style={{fontSize:13, color:"var(--ink-soft)", lineHeight:1.7, fontFamily:"var(--font-mono)"}}>
            UUID · <span style={{color:"var(--ink-strong)"}}>{link.uuid}</span><br/>
            Issued · <span style={{color:"var(--ink-strong)"}}>{new Date(link.createdAt).toLocaleDateString()}</span><br/>
            Expires · <span style={{color:"var(--ink-strong)"}}>{new Date(link.expiresAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div style={{marginTop:32}}>
        <h3 style={{fontFamily:"var(--font-heading)",fontSize:24,fontWeight:500,letterSpacing:"-0.015em",margin:"0 0 6px",color:"var(--ink-strong)"}}>
          Your questions &amp; comments
        </h3>
        <p style={{color:"var(--ink-muted)",fontSize:13,margin:"0 0 18px",lineHeight:1.55}}>
          Highlight any line item, scope text, or paragraph above to ask a question. Comments are grouped by page below — edit or delete any time before submitting.
        </p>
        <CommentsStack
          comments={comments}
          sectionsById={sectionsById}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </section>
  );
}

Object.assign(window, {
  SecHead, PhotoGrid,
  CoverSection, StandardSection, InternalSection,
  KitchenOverviewSection, EndOfBriefSection,
});
})();
