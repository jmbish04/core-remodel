/* eslint-disable */
// =============================================================
// Build-Vision Comment Rail + Idle Hint
// - <CommentRail>: a small icon hanging in the right margin
//   (or bottom on mobile) that tracks the current section. Click
//   to drop a comment on that section without highlighting.
// - <IdleHint>: a minimal reminder that fades in after the user
//   stops scrolling for a few seconds; clears on the next scroll.
// =============================================================

(() => {
const { useState, useEffect, useRef, useCallback } = React;

// -------------------------------------------------------------
// CommentRail — persistent affordance to drop a comment on the
// current section. Watches scroll position, finds the section
// closest to viewport center, parks itself beside it (desktop)
// or fixed bottom-right (mobile).
// -------------------------------------------------------------
function CommentRail({ sections, openPopover, comments, enabled = true }) {
  const [current, setCurrent] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => {
      const centerY = window.innerHeight / 2;
      let best = null, bestDist = Infinity;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const dist = Math.abs((rect.top + rect.bottom) / 2 - centerY);
        if (dist < bestDist) { bestDist = dist; best = s; }
      }
      if (best && best.id !== current?.id) setCurrent(best);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections, current, enabled]);

  if (!enabled || !current) return null;

  // suppress on cover and end-of-brief — those have their own affordances
  if (current.id === "cover" || current.id === "end-of-brief") return null;

  const sectionComments = comments.filter(c => c.sectionId === current.id).length;

  const onClick = () => {
    const el = document.getElementById(current.id);
    const rect = el?.getBoundingClientRect();
    openPopover({
      sectionId: current.id,
      anchor: `${current.group} · ${current.title}`,
      rect: rect ? {
        left: isMobile ? 16 : window.innerWidth - 360,
        right: window.innerWidth - 40,
        top: isMobile ? window.innerHeight - 320 : 200,
        bottom: isMobile ? window.innerHeight - 250 : 240,
      } : { left: 100, right: 200, top: 200, bottom: 240 },
      comment: null,
    });
  };

  return (
    <div
      className={`bv-rail ${isMobile ? "is-mobile" : ""} ${hovered ? "is-hover" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      title={`Comment on ${current.title}`}
    >
      <div className="bv-rail-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        {sectionComments > 0 && (
          <span className="bv-rail-pip">{sectionComments}</span>
        )}
      </div>
      <div className="bv-rail-label">
        <div className="bv-rail-line">
          <span className="num">{current.group}</span>
          <span className="title">{current.title}</span>
        </div>
        <div className="bv-rail-cta">
          {sectionComments > 0 ? `Add another comment · ${sectionComments} on this page` : "Add a comment or question"}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// IdleHint — minimal reminder shown after scroll pauses
// -------------------------------------------------------------
function IdleHint({ enabled = true, delay = 4500 }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const dismissedRef = useRef(false);
  const showCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(false);
      // Stop reminding after the user has seen it 3 times
      if (dismissedRef.current || showCountRef.current >= 3) return;
      timerRef.current = setTimeout(() => {
        // Only show if user has scrolled at all
        if (window.scrollY < 200) return;
        showCountRef.current += 1;
        setVisible(true);
      }, delay);
    };

    const onScroll = () => schedule();
    const onTouch = () => schedule();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });

    schedule();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouch);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, delay]);

  if (!enabled || !visible) return null;

  return (
    <div
      className="bv-idle-hint"
      onClick={() => { setVisible(false); dismissedRef.current = true; }}
      role="button"
      tabIndex={0}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <div className="bv-idle-hint-body">
        <strong>Have a question?</strong>
        <span> Highlight any text — or use the comment chip — to add one.</span>
      </div>
      <button className="bv-idle-hint-x" onClick={(e) => { e.stopPropagation(); setVisible(false); dismissedRef.current = true; }}>×</button>
    </div>
  );
}

Object.assign(window, { CommentRail, IdleHint });
})();
