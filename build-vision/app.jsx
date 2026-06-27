/* eslint-disable */
// =============================================================
// Build-Vision main app
// =============================================================

(() => {
const { useState, useEffect, useMemo, useCallback, Fragment } = React;

function BuildVisionApp() {
  // ----- Tweakable controls (persisted by host) ---------------
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "selectionToolbar": true,
    "commentRail": true,
    "idleHint": true,
    "varianceBars": true,
    "density": "comfortable",
    "accent": "#c8530b"
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply density + accent via CSS custom properties on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bv-accent",
      tweaks.accent === "#c8530b" ? "oklch(0.78 0.13 30)" :
      tweaks.accent === "#2a6fdb" ? "oklch(0.72 0.16 245)" :
      tweaks.accent === "#1f8a5b" ? "oklch(0.72 0.16 155)" :
      tweaks.accent === "#a855f7" ? "oklch(0.72 0.18 305)" :
      "oklch(0.78 0.13 30)"
    );
    root.style.setProperty("--bv-accent-soft",
      tweaks.accent === "#c8530b" ? "oklch(0.78 0.13 30 / 0.18)" :
      tweaks.accent === "#2a6fdb" ? "oklch(0.72 0.16 245 / 0.18)" :
      tweaks.accent === "#1f8a5b" ? "oklch(0.72 0.16 155 / 0.18)" :
      tweaks.accent === "#a855f7" ? "oklch(0.72 0.18 305 / 0.18)" :
      "oklch(0.78 0.13 30 / 0.18)"
    );
    root.dataset.density = tweaks.density;
    root.dataset.variance = tweaks.varianceBars ? "on" : "off";
  }, [tweaks.accent, tweaks.density, tweaks.varianceBars]);

  // --- pick which mock link drives the view (demo-only)
  const initialUuid = (() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const m = hash.match(/uuid=([\w-]+)/);
      if (m) return m[1];
    }
    return window.BV_MOCK_LINKS[0].uuid;
  })();
  const [currentUuid, setCurrentUuid] = useState(initialUuid);

  const link = useMemo(
    () => window.BV_MOCK_LINKS.find(l => l.uuid === currentUuid) || window.BV_MOCK_LINKS[0],
    [currentUuid]
  );
  const persona = window.BV_PERSONAS[link.persona];

  // --- compute visible sections based on link config
  const visibleSections = useMemo(() => {
    return window.BV_SECTIONS.filter(s => {
      // Internal sections only if admin opted in
      if (s.kind === "internal") {
        return link.permissions.hiddenInternal?.includes(s.id);
      }
      // Must be in persona allowed list
      if (!persona.sections.includes(s.id)) return false;
      // And not in admin's hidden list
      if (link.permissions.hiddenSections?.includes(s.id)) return false;
      return true;
    });
  }, [link, persona]);

  const sectionsById = useMemo(
    () => Object.fromEntries(visibleSections.map(s => [s.id, s])),
    [visibleSections]
  );

  // --- sidebar mode (toc / thumbs)
  const [sbMode, setSbMode] = useState("toc");

  // --- active section based on scroll
  const [activeId, setActiveId] = useState(visibleSections[0]?.id);
  useEffect(() => {
    setActiveId(visibleSections[0]?.id);
  }, [visibleSections]);
  useEffect(() => {
    const handler = () => {
      // find topmost section within 200px of viewport top
      let best = visibleSections[0]?.id;
      for (const s of visibleSections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < 240) best = s.id;
      }
      setActiveId(best);
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, [visibleSections]);

  const onJumpTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

  // --- what-if config (local-only, doesn't mutate D1 in prototype)
  const [config, setConfig] = useState({
    kitchen: "c",
    shower: "A1",
    steam: false,
    smart: false,
  });

  const handleToggle = useCallback((key, val) => {
    setConfig(c => {
      if (key === "steam")   return { ...c, steam: !c.steam };
      if (key === "smart")   return { ...c, smart: !c.smart };
      if (key === "kitchen") return { ...c, kitchen: val };
      return c;
    });
  }, []);

  // --- rollups (recomputed from config)
  const rollups = useMemo(() => {
    // Sum all section budgets, then add config-specific kitchen overlay + addons
    let min = 0, avg = 0, max = 0;
    for (const s of visibleSections) {
      if (s.budget) {
        min += s.budget.min;
        avg += s.budget.avg;
        max += s.budget.max;
      }
    }
    // Kitchen scenario overlay (uses comparator data if present)
    const kitchenSec = window.BV_SECTIONS.find(s => s.id === "kitchen");
    if (kitchenSec && kitchenSec.comparison) {
      const total = kitchenSec.comparison.reduce((s, r) => s + (r[config.kitchen] || 0), 0);
      avg += total;
      min += total * 0.85;
      max += total * 1.25;
    }
    if (config.steam) { min += 6000; avg += 8000; max += 12500; }
    if (config.smart) { min += 1800; avg += 2450; max += 4000; }
    return { min: Math.round(min), avg: Math.round(avg), max: Math.round(max) };
  }, [visibleSections, config]);

  // --- decisions (accept/reject/counter) per line item
  const [decisions, setDecisions] = useState({});
  const onDecide = useCallback((itemId, decision) => {
    setDecisions(d => {
      const next = { ...d };
      if (decision === null) delete next[itemId];
      else next[itemId] = decision;
      return next;
    });
  }, []);

  // --- comments
  const [comments, setComments] = useState(link.questions || []);
  useEffect(() => { setComments(link.questions || []); }, [link]);
  const [popState, setPopState] = useState(null);
  const [toast, setToast] = useState(null);

  const flashToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const openPopover = useCallback((state) => {
    // If the selection toolbar already collected the user's text and
    // wants us to save immediately (autoSave), skip the popover UI.
    if (state && state.autoSave && state.seedText) {
      setComments(cs => [...cs, {
        id: "q_" + Math.random().toString(36).slice(2, 9),
        sectionId: state.sectionId,
        anchor: state.anchor,
        text: state.seedText,
        askedAt: new Date().toISOString(),
        reply: null,
      }]);
      flashToast("Comment saved · we'll respond within 24h");
      return;
    }
    setPopState(state);
  }, [flashToast]);

  const onSaveComment = useCallback((payload) => {
    setComments(cs => {
      if (payload.comment) {
        // edit
        flashToast("Comment updated");
        return cs.map(c => c.id === payload.comment.id ? { ...c, text: payload.text, editedAt: new Date().toISOString() } : c);
      }
      // new
      flashToast("Comment saved · we'll respond within 24h");
      return [...cs, {
        id: "q_" + Math.random().toString(36).slice(2, 9),
        sectionId: payload.sectionId,
        anchor: payload.anchor,
        text: payload.text,
        askedAt: new Date().toISOString(),
        reply: null,
      }];
    });
  }, [flashToast]);

  const onDeleteComment = useCallback((id) => {
    setComments(cs => cs.filter(c => c.id !== id));
    flashToast("Comment deleted");
  }, [flashToast]);

  const onEditComment = useCallback((c) => {
    // Open popover programmatically — anchor it near the bottom-right
    setPopState({
      sectionId: c.sectionId,
      anchor: c.anchor,
      rect: { left: window.innerWidth - 360, bottom: 100, top: 50, right: window.innerWidth - 40 },
      comment: c,
    });
  }, []);

  // --- Photo lightbox
  const [lightbox, setLightbox] = useState(null);
  const openLightbox = useCallback((state) => setLightbox(state), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  // Photo-comment add (called from inside the lightbox)
  const onAddPhotoComment = useCallback(({ sectionId, photoSrc, anchor, text, annotations }) => {
    setComments(cs => [...cs, {
      id: "q_" + Math.random().toString(36).slice(2, 9),
      sectionId,
      anchor,
      text,
      photoSrc,
      annotations: annotations || [],
      askedAt: new Date().toISOString(),
      reply: null,
    }]);
    flashToast(annotations && annotations.length
      ? "Annotation saved · visible on review"
      : "Comment saved · we'll respond within 24h");
  }, [flashToast]);

  const onEditPhotoComment = useCallback((c) => {
    setComments(cs => cs.map(x => x.id === c.id ? { ...x, text: c.text, editedAt: new Date().toISOString() } : x));
    flashToast("Comment updated");
  }, [flashToast]);

  // --- Scenario mind map
  const [mindmapOpen, setMindmapOpen] = useState(false);

  // --- Ask-AI modal (driven by the selection toolbar)
  const [askAi, setAskAi] = useState(null);
  const openAskAi = useCallback((ctx) => setAskAi(ctx), []);
  const closeAskAi = useCallback(() => setAskAi(null), []);

  // Persist (or update) the AI chat into the comments stream so the
  // reviewer sees it alongside written comments.
  const onPersistAiChat = useCallback((entry) => {
    setComments(cs => {
      const idx = cs.findIndex(c => c.id === entry.id);
      if (idx === -1) return [...cs, entry];
      const next = cs.slice(); next[idx] = entry; return next;
    });
  }, []);

  // Make the current uuid available to small helpers (toolbar note)
  useEffect(() => { window.__bvCurrentUuid = link.uuid; }, [link.uuid]);

  // --- PDF preview state
  const [pdfOpen, setPdfOpen] = useState(false);
  const [overrideUuid, setOverrideUuid] = useState(null); // demo switcher

  // --- whether the budget panel is shown
  const budgetVisible = link.permissions.budgetMode !== "off";

  // --- a section's photos respect "no photos" config
  const photosOk = link.permissions.showPhotos !== false;
  const sectionsForRender = useMemo(() =>
    visibleSections.map(s => ({
      ...s,
      photos: photosOk ? s.photos : undefined,
      hero:   photosOk ? s.hero   : undefined,
    })),
    [visibleSections, photosOk]
  );

  return (
    <div className="bv-app">
      <BvSidebar
        link={link}
        persona={persona}
        sections={sectionsForRender}
        mode={sbMode}
        setMode={setSbMode}
        activeId={activeId}
        onJumpTo={onJumpTo}
        onPdfPreview={() => setPdfOpen(true)}
        onAdminView={() => { window.location.href = "admin.html"; }}
        budgetVisible={budgetVisible}
        totalAvg={rollups.avg}
        cap={window.BV_BUDGET_CAP}
      />

      <main className="bv-main">
        {/* Status bar */}
        <div className="bv-statusbar">
          <div className="crumb">
            <span>build-vision</span>
            <span className="sep">/</span>
            <span className="here">{link.uuid.slice(0,8)}</span>
            <span className="sep">·</span>
            <span>{link.recipient.company}</span>
          </div>
          <div className="right">
            {(() => {
              const days = Math.round((new Date(link.expiresAt) - new Date()) / (1000*60*60*24));
              if (link.revoked) return <span className="bv-pill is-bad"><span className="dot"/>Revoked</span>;
              if (days <= 7) return <span className="bv-pill is-warn"><span className="dot"/>Expires in {days}d</span>;
              return <span className="bv-pill"><span className="dot"/>Active · {days}d left</span>;
            })()}
            <span className="bv-pill is-info"><span className="dot"/>{persona.label}</span>
            {budgetVisible
              ? <span className="bv-pill"><span className="dot"/>Budget {link.permissions.budgetMode}</span>
              : <span className="bv-pill"><span className="dot" style={{background:"var(--ink-faint)"}}/>Budget hidden</span>}
          </div>
        </div>

        {/* Render sections */}
        {sectionsForRender.map(s => {
          if (s.id === "cover") return <CoverSection key={s.id} section={s} link={link} persona={persona} />;
          if (s.kind === "internal") return <InternalSection key={s.id} section={s} />;
          if (s.kind === "comparator") {
            return <KitchenOverviewSection
              key={s.id}
              section={s}
              budgetMode={link.permissions.budgetMode}
              activeKitchen={config.kitchen}
              onSelectKitchen={(k) => handleToggle("kitchen", k)}
              showComparator={link.permissions.showComparator}
              link={link}
              comments={comments}
              openLightbox={openLightbox}
              onOpenMindmap={() => setMindmapOpen(true)}
            />;
          }
          if (s.id === "end-of-brief") {
            return <EndOfBriefSection
              key={s.id}
              section={s}
              link={link}
              comments={comments}
              sectionsById={sectionsById}
              onEdit={onEditComment}
              onDelete={onDeleteComment}
            />;
          }

          // Standard section: render budget panel ABOVE the first budget-bearing section
          // for vendors who see budget data.
          const showPulseBefore = budgetVisible && s.id === sectionsForRender.find(x => x.budget)?.id;

          return (
            <div key={s.id}>
              {showPulseBefore && (
                <div data-screen-label="Budget pulse" style={{paddingTop: 24}}>
                  <BudgetPulse
                    rollups={rollups}
                    cap={window.BV_BUDGET_CAP}
                    config={config}
                    onToggle={handleToggle}
                    budgetMode={link.permissions.budgetMode}
                  />
                </div>
              )}
              <StandardSection
                section={s}
                budgetMode={link.permissions.budgetMode}
                comments={comments}
                openPopover={openPopover}
                openLightbox={openLightbox}
                link={link}
                decisions={decisions}
                onDecide={onDecide}
              />
            </div>
          );
        })}
      </main>

      {/* Comment popover */}
      {popState && (
        <CommentPopover
          state={popState}
          onSave={onSaveComment}
          onDelete={onDeleteComment}
          onClose={() => setPopState(null)}
        />
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <PhotoLightbox
          state={lightbox}
          comments={comments}
          onChangeIndex={(i) => setLightbox(s => s ? { ...s, index: i } : s)}
          onAddComment={onAddPhotoComment}
          onEditComment={onEditPhotoComment}
          onDeleteComment={onDeleteComment}
          onClose={closeLightbox}
        />
      )}

      {/* Scenario mind map */}
      {mindmapOpen && (
        <ScenarioMindmap
          onClose={() => setMindmapOpen(false)}
          onJumpToSection={onJumpTo}
        />
      )}

      {/* Ask the AI */}
      {askAi && (
        <AskAiModal
          state={askAi}
          link={link}
          persona={persona}
          onClose={closeAskAi}
          onPersist={onPersistAiChat}
        />
      )}

      {/* Selection-to-comment toolbar */}
      <SelectionToolbar
        openPopover={openPopover}
        openAskAi={openAskAi}
        enabled={!pdfOpen && !popState && !lightbox && !mindmapOpen && !askAi && tweaks.selectionToolbar}
      />

      {/* Persistent comment rail (side margin / mobile bottom) */}
      <CommentRail
        sections={sectionsForRender}
        openPopover={openPopover}
        comments={comments}
        enabled={!pdfOpen && !popState && !lightbox && !mindmapOpen && !askAi && tweaks.commentRail}
      />

      {/* Idle scroll reminder */}
      <IdleHint enabled={!pdfOpen && !popState && !lightbox && !mindmapOpen && !askAi && tweaks.idleHint} />

      {/* PDF preview modal */}
      {pdfOpen && (
        <PdfPreview
          link={link}
          persona={persona}
          visibleSections={sectionsForRender}
          budgetMode={link.permissions.budgetMode}
          rollups={rollups}
          cap={window.BV_BUDGET_CAP}
          comments={comments}
          onClose={() => setPdfOpen(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="bv-toast">
          <span className="dot" />
          {toast}
        </div>
      )}

      {/* Demo persona switcher */}
      <DemoSwitch currentUuid={currentUuid} onPick={(u) => { setCurrentUuid(u); window.location.hash = "uuid=" + u; window.scrollTo({top:0}); }} />

      {/* Tweaks panel (toggled by toolbar) */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Comment affordances">
          <TweakToggle
            label="Selection toolbar"
            value={tweaks.selectionToolbar}
            onChange={(v) => setTweak("selectionToolbar", v)}
          />
          <TweakToggle
            label="Side comment rail"
            value={tweaks.commentRail}
            onChange={(v) => setTweak("commentRail", v)}
          />
          <TweakToggle
            label="Idle scroll reminder"
            value={tweaks.idleHint}
            onChange={(v) => setTweak("idleHint", v)}
          />
        </TweakSection>
        <TweakSection label="Visual">
          <TweakRadio
            label="Density"
            value={tweaks.density}
            options={[{value:"compact",label:"Compact"},{value:"comfortable",label:"Comfy"}]}
            onChange={(v) => setTweak("density", v)}
          />
          <TweakToggle
            label="Variance bars"
            value={tweaks.varianceBars}
            onChange={(v) => setTweak("varianceBars", v)}
          />
          <TweakColor
            label="Accent"
            value={tweaks.accent}
            options={["#c8530b", "#2a6fdb", "#1f8a5b", "#a855f7"]}
            onChange={(v) => setTweak("accent", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function DemoSwitch({ currentUuid, onPick }) {
  return (
    <div className="bv-demo-switch">
      <div className="h">
        <span>🛠</span>
        Demo · switch persona
      </div>
      <div className="links">
        {window.BV_MOCK_LINKS.map(l => (
          <a
            key={l.uuid}
            className={`link ${l.uuid === currentUuid ? "is-active" : ""}`}
            onClick={(e) => { e.preventDefault(); onPick(l.uuid); }}
            href={`#uuid=${l.uuid}`}
          >
            {l.persona.toUpperCase()} · {l.recipient.company.split(' ')[0]}
          </a>
        ))}
      </div>
      <div style={{fontSize:10.5, color:"var(--ink-faint)", lineHeight:1.4}}>
        In production, every recipient gets a unique <code style={{background:"oklch(1 0 0 / 6%)", padding:"1px 4px", borderRadius:3, fontSize:10}}>/build-vision/{`{uuid}`}</code> URL. This panel only appears in the prototype.
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<BuildVisionApp />);
})();
