/* eslint-disable */
// =============================================================
// Build-Vision Comments
// - Annotated text spans the user can highlight & comment on
// - Floating popover to compose/edit
// - Stacked list grouped by section at end of brief
// =============================================================

(() => {
const { useState, useEffect, useRef } = React;

// -------------------------------------------------------------
// Annotated text — wrap any phrase that should be commentable.
// The phrase is read from data attrs in production; for the
// prototype we use a CommentAnchor component you wrap by hand.
// -------------------------------------------------------------
function CommentAnchor({ sectionId, anchorText, comments, openPopover, children }) {
  // existing comment for this anchor?
  const existing = comments.find(c => c.sectionId === sectionId && c.anchor === anchorText);

  return (
    <span
      className="bv-annot"
      data-section={sectionId}
      data-anchor={anchorText}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openPopover({
          sectionId, anchor: anchorText,
          rect,
          comment: existing || null,
        });
      }}
      title={existing ? "Edit your comment" : "Ask a question or leave a comment"}
    >
      {children || anchorText}
    </span>
  );
}

// -------------------------------------------------------------
// Floating popover
// -------------------------------------------------------------
function CommentPopover({ state, onSave, onDelete, onClose }) {
  const [text, setText] = useState(state.comment?.text || "");
  const taRef = useRef(null);

  useEffect(() => { setText(state.comment?.text || ""); }, [state]);
  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Anchor below the highlighted span, but keep on screen
  const top = Math.min(state.rect.bottom + 6, window.innerHeight - 240);
  const left = Math.min(Math.max(state.rect.left - 8, 12), window.innerWidth - 340);

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 90 }}
        onClick={onClose}
      />
      <div className="bv-comment-pop" style={{ top, left }}>
        <div className="anchor">
          On: <span style={{color: "var(--bv-accent)"}}>"{state.anchor}"</span>
        </div>
        <textarea
          ref={taRef}
          placeholder="What's your question or comment?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="actions">
          {state.comment && (
            <button className="bv-btn is-danger" onClick={() => { onDelete(state.comment.id); onClose(); }}>
              Delete
            </button>
          )}
          <button className="bv-btn" onClick={onClose}>Cancel</button>
          <button
            className="bv-btn is-primary"
            disabled={!text.trim()}
            onClick={() => { onSave({ ...state, text: text.trim() }); onClose(); }}
          >
            {state.comment ? "Save" : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------
// Stacked review (end of brief)
// -------------------------------------------------------------
function CommentsStack({ comments, sectionsById, onEdit, onDelete }) {
  if (comments.length === 0) {
    return (
      <div style={{
        padding: "24px 0",
        color: "var(--ink-muted)",
        fontSize: 14,
        borderTop: "1px solid var(--rule)",
        marginTop: 24,
      }}>
        No questions or comments yet. Highlight any line item, paragraph, or scope text to ask a question — we'll respond inline.
      </div>
    );
  }

  // group by sectionId, preserve section order
  const order = Object.keys(sectionsById);
  const grouped = order
    .map(id => ({
      section: sectionsById[id],
      comments: comments.filter(c => c.sectionId === id),
    }))
    .filter(g => g.comments.length > 0);

  return (
    <div className="bv-comments-stack">
      {grouped.map(g => (
        <div className="bv-comment-group" key={g.section.id}>
          <div className="bv-comment-group-h">
            <span style={{color: "var(--ink-strong)", fontWeight: 600}}>{g.section.group}</span>
            <span>·</span>
            <span>{g.section.title}</span>
            <span style={{marginLeft: "auto", color: "var(--ink-faint)"}}>
              {g.comments.length} {g.comments.length === 1 ? "question" : "questions"}
            </span>
          </div>
          {g.comments.map(c => {
            const isAi    = c.kind === "ai-chat";
            const isAnnot = c.photoSrc && c.annotations && c.annotations.length > 0;
            const isPhoto = c.photoSrc && !isAnnot;
            return (
            <div className={`bv-comment ${isAi ? "is-ai" : ""}`} key={c.id}>
              <span className="anchor">
                {isAi    && <span className="bv-comment-kind is-ai">AI chat</span>}
                {isAnnot && <span className="bv-comment-kind is-annot">Annotation</span>}
                {isPhoto && <span className="bv-comment-kind is-photo">Photo</span>}
                {(isAi || isPhoto || isAnnot) ? c.anchor : <>"{c.anchor}"</>}
              </span>
              {c.photoSrc && (
                <div className="bv-comment-photo">
                  <div className="thumb">
                    <img src={c.photoSrc} alt="" />
                    {c.annotations && c.annotations.map((a, i) => (
                      <div
                        key={i}
                        className="annot"
                        style={{ left: `${a.x*100}%`, top: `${a.y*100}%`, width: `${a.w*100}%`, height: `${a.h*100}%` }}
                      >
                        <span className="num">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!isAi && <div className="body">{c.text}</div>}
              {isAi && c.messages && (
                <div className="bv-comment-chat">
                  {c.messages.map((m, i) => (
                    <div key={i} className={`turn is-${m.role}`}>
                      <span className="role">{m.role === "assistant" ? "AI" : "You"}</span>
                      <span className="msg">{m.content}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.reply && (
                <div className="reply">
                  <div className="from">Reply from 126 Colby team</div>
                  {c.reply.text}
                </div>
              )}
              <div className="foot">
                <span>
                  {c.reply ? "Answered" : "Awaiting response"} ·
                  {" "}{c.editedAt ? "edited" : "posted"} {new Date(c.editedAt || c.askedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="actions">
                  <button className="bv-btn" onClick={() => onEdit(c)}>Edit</button>
                  <button className="bv-btn is-danger" onClick={() => onDelete(c.id)}>Delete</button>
                </span>
              </div>
            </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { CommentAnchor, CommentPopover, CommentsStack });
})();
