/* eslint-disable */
// =============================================================
// Build-Vision Selection Toolbar
// ---------------------------------------------------------------
// Medium-style floating action bar that appears when the user
// highlights any text inside the main column.
//
// Two states:
//   · collapsed — "Add comment or ask AI" + Copy + quote preview
//   · expanded  — inline textarea + Cancel / Save comment / Send to AI
//
// "Send to AI" hands off the captured context (anchor text, section,
// selection rect, the user's prompt) to the AskAiModal — which in
// production talks to a Cloudflare Agent worker and records the
// transcript to D1 so the reviewer (homeowner admin) can see what
// confused the recipient. In the prototype we call window.claude.complete.
// =============================================================

(() => {
const { useState, useEffect, useRef } = React;

function SelectionToolbar({ openPopover, openAskAi, enabled = true }) {
  const [state, setState]   = useState(null);     // { rect, text, sectionId }
  const [phase, setPhase]   = useState("idle");   // idle | compose
  const [draft, setDraft]   = useState("");
  const lastEvtRef = useRef(0);
  const taRef = useRef(null);

  // Re-evaluate the current selection
  useEffect(() => {
    if (!enabled) { setState(null); return; }

    const evaluate = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { if (phase === "idle") setState(null); return; }
      const text = sel.toString().trim();
      if (text.length < 3) { if (phase === "idle") setState(null); return; }

      const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range) { setState(null); return; }
      const container = range.commonAncestorContainer;
      const containerEl = container.nodeType === 3 ? container.parentElement : container;
      if (!containerEl || !containerEl.closest(".bv-main")) { setState(null); return; }
      if (containerEl.closest("textarea, input, button, .bv-comment-pop, .bv-pdf-overlay, .bv-toast, .bv-demo-switch, .twk-panel, .bv-seltool, .bv-lb-overlay, .bv-mm-overlay, .bv-ai-overlay")) {
        return;
      }
      if (containerEl.closest(".bv-annot")) { setState(null); return; }

      const sectionEl = containerEl.closest("section.bv-section");
      const sectionId = sectionEl?.id;
      if (!sectionId) { setState(null); return; }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { setState(null); return; }

      const anchor = text.length > 80 ? text.slice(0, 77) + "…" : text;
      setState({ rect, text: anchor, sectionId });
    };

    const onMouseUp    = () => { lastEvtRef.current = Date.now(); setTimeout(evaluate, 10); };
    const onTouchEnd   = () => setTimeout(evaluate, 120);
    const onSelChange  = () => {
      if (phase !== "idle") return;     // don't blow away the toolbar mid-compose
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setState(null);
    };
    const onScroll = () => { if (phase === "idle") setState(null); };
    const onKey = (e) => {
      if (e.key === "Escape") { setState(null); setPhase("idle"); setDraft(""); }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("selectionchange", onSelChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("selectionchange", onSelChange);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, phase]);

  // Auto-focus the textarea when we expand
  useEffect(() => {
    if (phase === "compose") setTimeout(() => taRef.current?.focus(), 30);
  }, [phase]);

  if (!state) return null;

  // Position the toolbar above the selection (collapsed) or below (expanded).
  // Compose form is wider so we re-center under the selection.
  const composeWidth = 460;
  const composeHeight = 200;
  const composeTop = Math.min(
    Math.max(8, state.rect.bottom + 10),
    window.innerHeight - composeHeight - 12
  );
  const composeLeft = Math.min(
    Math.max(12, state.rect.left + state.rect.width / 2 - composeWidth / 2),
    window.innerWidth - composeWidth - 12
  );

  const collapsedTop  = Math.max(8, state.rect.top - 44);
  const collapsedLeft = Math.min(
    Math.max(8, state.rect.left + state.rect.width / 2 - 150),
    window.innerWidth - 320
  );

  const clearSelection = () => { window.getSelection()?.removeAllRanges(); };

  const onCopy = () => {
    navigator.clipboard?.writeText(state.text);
    clearSelection();
    setState(null);
  };

  const onCompose = () => setPhase("compose");

  const onCancel = () => {
    setPhase("idle");
    setDraft("");
    setState(null);
    clearSelection();
  };

  const onSaveComment = () => {
    if (!draft.trim()) return;
    openPopover({
      sectionId: state.sectionId,
      anchor: state.text,
      rect: { left: state.rect.left, right: state.rect.right, top: state.rect.top, bottom: state.rect.bottom },
      comment: null,
      seedText: draft.trim(),     // pre-fill the popover and save immediately
      autoSave: true,
    });
    setPhase("idle");
    setDraft("");
    setState(null);
    clearSelection();
  };

  const onSendAi = () => {
    if (!draft.trim()) return;
    openAskAi?.({
      sectionId: state.sectionId,
      anchor: state.text,
      prompt: draft.trim(),
    });
    setPhase("idle");
    setDraft("");
    setState(null);
    clearSelection();
  };

  // ----- Expanded inline compose ---------------------------------
  if (phase === "compose") {
    return (
      <div
        className="bv-seltool-compose"
        style={{ top: composeTop, left: composeLeft, width: composeWidth }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="anchor">
          <span className="lbl">Commenting on</span>
          <span className="quote">"{state.text.length > 80 ? state.text.slice(0, 77) + "…" : state.text}"</span>
        </div>
        <textarea
          ref={taRef}
          rows={3}
          placeholder="Add a comment, ask a question, or send a prompt to the AI assistant…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) { e.preventDefault(); onSaveComment(); }
          }}
        />
        <div className="actions">
          <button className="bv-seltool-btn" onClick={onCancel}>Cancel</button>
          <div style={{flex:1}} />
          <button className="bv-seltool-btn ai" disabled={!draft.trim()} onClick={onSendAi}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Send prompt to AI
          </button>
          <button className="bv-seltool-btn primary" disabled={!draft.trim()} onClick={onSaveComment}>
            Save comment
          </button>
        </div>
        <div className="note">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          AI chats are recorded to the bid (uuid {window.__bvCurrentUuid?.slice(0, 8) || "—"}) so the homeowner can see what needed follow-up.
        </div>
      </div>
    );
  }

  // ----- Collapsed pill ------------------------------------------
  return (
    <div
      className="bv-seltool"
      style={{ top: collapsedTop, left: collapsedLeft }}
      onMouseDown={(e) => e.preventDefault()}    // don't clear selection
    >
      <button className="bv-seltool-btn primary" onClick={onCompose}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Add comment or ask AI
      </button>
      <div className="bv-seltool-sep" />
      <button className="bv-seltool-btn" onClick={onCopy} title="Copy text">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <div className="bv-seltool-quote">
        "{state.text.length > 32 ? state.text.slice(0, 30) + "…" : state.text}"
      </div>
    </div>
  );
}

Object.assign(window, { SelectionToolbar });
})();
