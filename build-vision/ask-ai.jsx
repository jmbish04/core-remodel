/* eslint-disable */
// =============================================================
// Build-Vision · Ask the AI
// ---------------------------------------------------------------
// Chat modal that the recipient (contractor/architect/etc) can
// use to ask Claude about whatever part of the brief they're
// looking at. The selection-toolbar passes us the focused
// CONTEXT (section id, anchored text, and the user's seed prompt)
// so the model can answer in context.
//
// Production wiring (sketched in code below):
//   POST /api/ask/{bidUuid} { sectionId, anchor, messages } →
//     Cloudflare Worker → Agent SDK → D1 (`ask_chats`, `ask_turns`)
//   The reviewer (homeowner admin) sees these chats in the same
//   review surface as written comments so they can spot patterns
//   in what confused the recipient and clarify the next bid.
// =============================================================

(() => {
const { useState, useEffect, useRef, useCallback } = React;

function AskAiModal({ state, link, persona, onClose, onPersist }) {
  const { sectionId, anchor, prompt: seedPrompt } = state;
  const [messages, setMessages] = useState([]);            // [{role,content,ts}]
  const [pending, setPending]   = useState(false);
  const [draft, setDraft]       = useState("");
  const [chatId]                = useState(() => "ai_" + Math.random().toString(36).slice(2, 9));
  const [error, setError]       = useState(null);
  const scrollerRef = useRef(null);
  const sentSeedRef = useRef(false);

  const section = (window.BV_SECTIONS || []).find(s => s.id === sectionId);

  // Build a system prompt that bakes in the brief context so Claude
  // answers as if it has read the rest of the document.
  const systemPrompt = useCallback(() => {
    return [
      `You are a helpful assistant embedded in the "Build Vision" brief for the 126 Colby home remodel.`,
      `The recipient viewing this brief is ${link.recipient.name} from ${link.recipient.company} (${persona.label}).`,
      `They are looking at section "${section?.title || sectionId}" (${section?.eyebrow || ""}).`,
      section?.summary ? `Section summary: ${section.summary}` : "",
      `They highlighted this text from the brief: "${anchor}".`,
      `Answer their question as the homeowner's helper. Be concise, specific, and reference the project where it helps. If the answer truly isn't in the brief, say so and suggest leaving a comment for the homeowner to follow up.`,
      `Keep responses under ~120 words unless the question genuinely requires more depth.`,
    ].filter(Boolean).join("\n\n");
  }, [link, persona, section, anchor, sectionId]);

  // Helper — call Claude
  const callClaude = useCallback(async (history) => {
    const sys = systemPrompt();
    const conversationLines = history
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const full = `${sys}\n\n${conversationLines}\n\nAssistant:`;
    try {
      const text = await window.claude.complete(full);
      return text?.trim() || "(no response)";
    } catch (err) {
      throw err;
    }
  }, [systemPrompt]);

  // Send the seed prompt automatically on first render
  useEffect(() => {
    if (sentSeedRef.current) return;
    sentSeedRef.current = true;
    const initial = [{ role: "user", content: seedPrompt, ts: new Date().toISOString() }];
    setMessages(initial);
    setPending(true);
    callClaude(initial)
      .then(reply => {
        setMessages(m => [...m, { role: "assistant", content: reply, ts: new Date().toISOString() }]);
        setPending(false);
      })
      .catch(err => { setError(err?.message || "AI request failed"); setPending(false); });
  }, [seedPrompt, callClaude]);

  // Persist the conversation whenever it changes (debounced).
  // In production this hits POST /api/ask/{bidUuid}/{chatId} which
  // writes to D1 so the reviewer can see it.
  useEffect(() => {
    if (messages.length === 0) return;
    onPersist?.({
      id: chatId,
      sectionId,
      anchor,
      kind: "ai-chat",
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      askedAt: messages[0]?.ts || new Date().toISOString(),
      editedAt: new Date().toISOString(),
      text: messages[0]?.content || "",        // for fallback rendering in CommentsStack
      reply: null,
    });
  }, [messages, chatId, sectionId, anchor, onPersist]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Esc closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sendFollowup = async () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    const next = [...messages, { role: "user", content: text, ts: new Date().toISOString() }];
    setMessages(next);
    setPending(true);
    try {
      const reply = await callClaude(next);
      setMessages(m => [...m, { role: "assistant", content: reply, ts: new Date().toISOString() }]);
    } catch (err) {
      setError(err?.message || "AI request failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="bv-ai-overlay" role="dialog" aria-modal="true" aria-label="Ask the AI">
      <div className="bv-ai-scrim" onClick={onClose} />
      <div className="bv-ai-window">
        <header className="bv-ai-head">
          <div className="bv-ai-head-l">
            <div className="bv-ai-eye">
              <span className="dot" />
              <span className="lbl">Ask the AI · context shared</span>
            </div>
            <h2 className="bv-ai-title">{section?.title || "Brief"}</h2>
            <div className="bv-ai-context">
              <span className="ctx-lbl">Focused on</span>
              <span className="ctx-txt">"{anchor}"</span>
            </div>
          </div>
          <button className="bv-ai-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>

        <div className="bv-ai-notice">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 2L4 7v5c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-5z"/><path d="M9 12l2 2 4-4"/>
          </svg>
          This chat is recorded to bid <code>{link.uuid.slice(0,8)}</code> so the homeowner can see what needed follow-up.
        </div>

        <div className="bv-ai-thread" ref={scrollerRef}>
          {messages.map((m, i) => (
            <ChatTurn key={i} role={m.role} content={m.content} />
          ))}
          {pending && <ChatTurn role="assistant" content="" thinking />}
          {error && (
            <div className="bv-ai-error">
              <strong>Couldn't reach the assistant.</strong> {error}. <button onClick={() => { setError(null); sendFollowup(); }}>Try again</button>
            </div>
          )}
        </div>

        <footer className="bv-ai-foot">
          <div className="composer">
            <textarea
              rows={2}
              placeholder="Follow up… (Cmd/Ctrl+Enter to send)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) { e.preventDefault(); sendFollowup(); }
              }}
              disabled={pending}
            />
            <div className="composer-actions">
              <div className="ttl">
                <span className="k">Recorded to</span>
                <span className="v">{link.recipient.company}</span>
              </div>
              <button className="bv-btn" onClick={onClose}>Close chat</button>
              <button
                className="bv-btn is-primary"
                disabled={!draft.trim() || pending}
                onClick={sendFollowup}
              >
                {pending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ChatTurn({ role, content, thinking }) {
  return (
    <div className={`bv-ai-turn is-${role}`}>
      <div className="bv-ai-avatar">{role === "user" ? "You" : "AI"}</div>
      <div className="bv-ai-bubble">
        {thinking ? (
          <span className="bv-ai-think">
            <span className="d" /><span className="d" /><span className="d" />
          </span>
        ) : (
          content.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)
        )}
      </div>
    </div>
  );
}

Object.assign(window, { AskAiModal });
})();
