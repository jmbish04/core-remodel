/* eslint-disable */
// =============================================================
// Build-Vision Photo Lightbox + Annotations
// ---------------------------------------------------------------
// Clicking any .bv-photo opens this overlay. The user can:
//  · navigate between photos in the same section (← / →)
//  · drop a comment on the WHOLE photo
//  · drag a rectangle on the photo to drop a comment on a region
//  · open / edit / delete any annotation already on the photo
// The reviewer/admin side reads `c.photoSrc` + `c.annotations`
// and renders the same overlaid boxes on the photo.
// =============================================================

(() => {
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function PhotoLightbox({ state, comments, onChangeIndex, onClose, onAddComment, onEditComment, onDeleteComment }) {
  const { photos, sectionId } = state;
  const [index, setIndex] = useState(state.index || 0);
  const [mode, setMode] = useState("view");       // view | drawing
  const [draft, setDraft] = useState(null);       // {x,y,w,h,startX,startY} normalized 0..1
  const [openComment, setOpenComment] = useState(null);   // existing comment being viewed
  const [composeFor, setComposeFor] = useState(null);     // {kind:"overall"|"area", annotation?}
  const stageRef = useRef(null);

  const photo = photos[index];

  useEffect(() => { setIndex(state.index || 0); }, [state.index]);
  useEffect(() => { setMode("view"); setDraft(null); setOpenComment(null); setComposeFor(null); }, [index, photo?.src]);

  useEffect(() => {
    const onKey = (e) => {
      if (composeFor || openComment) {
        if (e.key === "Escape") { setComposeFor(null); setOpenComment(null); }
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) { setIndex(i => i - 1); onChangeIndex?.(index - 1); }
      if (e.key === "ArrowRight" && index < photos.length - 1) { setIndex(i => i + 1); onChangeIndex?.(index + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, composeFor, openComment, onClose, onChangeIndex]);

  const photoComments = useMemo(
    () => (comments || []).filter(c => c.photoSrc === photo?.src),
    [comments, photo?.src]
  );
  const overallComments = photoComments.filter(c => !c.annotations || c.annotations.length === 0);
  const annotations = useMemo(() => {
    const all = [];
    for (const c of photoComments) {
      if (!c.annotations) continue;
      c.annotations.forEach((a, ai) => all.push({ ...a, commentId: c.id, comment: c, ai }));
    }
    return all;
  }, [photoComments]);

  // ---- Drawing rectangle (mouse coords normalized to 0..1) ----
  const stagePoint = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top)  / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const onStageDown = (e) => {
    if (mode !== "drawing") return;
    e.preventDefault();
    const p = stagePoint(e);
    setDraft({ startX: p.x, startY: p.y, x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onStageMove = (e) => {
    if (mode !== "drawing" || !draft) return;
    const p = stagePoint(e);
    const x = Math.min(draft.startX, p.x);
    const y = Math.min(draft.startY, p.y);
    const w = Math.abs(p.x - draft.startX);
    const h = Math.abs(p.y - draft.startY);
    setDraft({ ...draft, x, y, w, h });
  };
  const onStageUp = () => {
    if (mode !== "drawing" || !draft) return;
    if (draft.w < 0.015 || draft.h < 0.015) { setDraft(null); return; }   // too small → ignore
    setComposeFor({
      kind: "area",
      annotation: { x: +draft.x.toFixed(4), y: +draft.y.toFixed(4), w: +draft.w.toFixed(4), h: +draft.h.toFixed(4) },
    });
  };

  const startDraw = () => { setMode("drawing"); setDraft(null); setOpenComment(null); };
  const cancelDraw = () => { setMode("view"); setDraft(null); };

  const onSubmitDraft = (text) => {
    if (composeFor?.editing) {
      onEditComment?.({ ...composeFor.editing, text });
    } else {
      onAddComment?.({
        sectionId,
        photoSrc: photo.src,
        anchor: composeFor.kind === "area"
          ? `Photo region · ${photo.caption || photo.src.split("/").pop()}`
          : `Photo · ${photo.caption || photo.src.split("/").pop()}`,
        text,
        annotations: composeFor.kind === "area" ? [composeFor.annotation] : [],
      });
    }
    setComposeFor(null);
    setDraft(null);
    setMode("view");
  };

  if (!photo) return null;

  return (
    <div className="bv-lb-overlay" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="bv-lb-scrim" onClick={onClose} />

      {/* Top bar */}
      <div className="bv-lb-top">
        <div className="bv-lb-counter">
          <span className="num">{(index + 1).toString().padStart(2, "0")}</span>
          <span className="sep">/</span>
          <span className="of">{photos.length.toString().padStart(2, "0")}</span>
          <span className="sep">·</span>
          <span className="title">{photo.caption || photo.src.split("/").pop()}</span>
        </div>
        <div className="bv-lb-top-right">
          <button
            className={`bv-lb-tool ${mode === "drawing" ? "is-active" : ""}`}
            onClick={mode === "drawing" ? cancelDraw : startDraw}
            title={mode === "drawing" ? "Cancel area selection" : "Highlight a region to comment on"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3"/>
              <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>
            </svg>
            {mode === "drawing" ? "Cancel highlight" : "Highlight area"}
          </button>
          <button
            className="bv-lb-tool"
            onClick={() => { setMode("view"); setComposeFor({ kind: "overall" }); }}
            title="Comment on the whole photo"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
            Comment on photo
          </button>
          <button className="bv-lb-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="bv-lb-stage-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div
          className={`bv-lb-stage ${mode === "drawing" ? "is-drawing" : ""}`}
          ref={stageRef}
          onMouseDown={onStageDown}
          onMouseMove={onStageMove}
          onMouseUp={onStageUp}
          onMouseLeave={() => { if (draft) onStageUp(); }}
        >
          <img src={photo.src} alt={photo.caption} draggable={false} />

          {/* Existing annotations */}
          {annotations.map((a, i) => (
            <button
              key={a.commentId + ":" + a.ai}
              type="button"
              className="bv-lb-annot"
              style={{ left: `${a.x*100}%`, top: `${a.y*100}%`, width: `${a.w*100}%`, height: `${a.h*100}%` }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setOpenComment(a.comment); }}
              title="View this annotation"
            >
              <span className="num">{i + 1}</span>
            </button>
          ))}

          {/* Live draft */}
          {draft && (
            <div
              className="bv-lb-draft"
              style={{ left: `${draft.x*100}%`, top: `${draft.y*100}%`, width: `${draft.w*100}%`, height: `${draft.h*100}%` }}
            />
          )}

          {mode === "drawing" && !draft && (
            <div className="bv-lb-hint">Drag to draw a rectangle on the part of the photo you want to comment on</div>
          )}
        </div>

        {/* Nav arrows */}
        {index > 0 && (
          <button
            className="bv-lb-nav prev"
            onClick={(e) => { e.stopPropagation(); setIndex(i => i - 1); onChangeIndex?.(index - 1); }}
            aria-label="Previous photo"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            className="bv-lb-nav next"
            onClick={(e) => { e.stopPropagation(); setIndex(i => i + 1); onChangeIndex?.(index + 1); }}
            aria-label="Next photo"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M9 6l6 6-6 6"/>
            </svg>
          </button>
        )}
      </div>

      {/* Caption bar — same light grey as thumbnail; always visible */}
      <div className="bv-lb-caption">
        <div className="cap">
          <span className="label">Caption</span>
          <span className="txt">{photo.caption || photo.src.split("/").pop()}</span>
        </div>
        <div className="meta">
          {photoComments.length > 0 && (
            <span>{photoComments.length} comment{photoComments.length === 1 ? "" : "s"} on this photo</span>
          )}
          {photoComments.length === 0 && (
            <span style={{color:"oklch(0.55 0 0)"}}>No comments yet · click <b>Highlight area</b> or <b>Comment on photo</b></span>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div className="bv-lb-strip">
          {photos.map((p, i) => (
            <button
              key={p.src + i}
              className={`bv-lb-thumb ${i === index ? "is-active" : ""}`}
              onClick={() => { setIndex(i); onChangeIndex?.(i); }}
              aria-label={p.caption || p.src.split("/").pop()}
              title={p.caption}
            >
              <img src={p.src} alt="" />
            </button>
          ))}
        </div>
      )}

      {/* Comment composer */}
      {composeFor && (
        <CommentComposer
          kind={composeFor.kind}
          annotation={composeFor.annotation}
          editingText={composeFor.editing?.text || ""}
          onSubmit={onSubmitDraft}
          onCancel={() => { setComposeFor(null); setDraft(null); setMode("view"); }}
        />
      )}

      {/* Existing comment viewer */}
      {openComment && (
        <CommentViewer
          comment={openComment}
          onEdit={() => { setComposeFor({ kind: openComment.annotations?.length ? "area" : "overall", editing: openComment, annotation: openComment.annotations?.[0] }); setOpenComment(null); }}
          onDelete={() => { onDeleteComment?.(openComment.id); setOpenComment(null); }}
          onClose={() => setOpenComment(null)}
        />
      )}

      {/* "Overall" comments — shown as a stack below the strip when nothing else is open */}
      {!composeFor && !openComment && overallComments.length > 0 && (
        <div className="bv-lb-thread">
          <div className="h">On this photo</div>
          {overallComments.map(c => (
            <button
              key={c.id}
              type="button"
              className="bv-lb-thread-item"
              onClick={() => setOpenComment(c)}
            >
              <span className="ic">💬</span>
              <span className="body">{c.text}</span>
              <span className="ts">{new Date(c.editedAt || c.askedAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Inline composer used inside the lightbox
// -----------------------------------------------------------------
function CommentComposer({ kind, annotation, editingText, onSubmit, onCancel }) {
  const [text, setText] = useState(editingText || "");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text.trim());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, onSubmit, onCancel]);

  return (
    <div className="bv-lb-composer" onClick={(e) => e.stopPropagation()}>
      <div className="anchor">
        {kind === "area"
          ? <>Commenting on a <b>highlighted region</b> · {annotation && <span style={{color:"oklch(0.55 0 0)"}}>{Math.round(annotation.w*100)}×{Math.round(annotation.h*100)}%</span>}</>
          : <>Commenting on the <b>whole photo</b></>}
      </div>
      <textarea
        ref={ref}
        placeholder="What's your question or comment about this photo?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <div className="actions">
        <button className="bv-btn" onClick={onCancel}>Cancel</button>
        <button className="bv-btn is-primary" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
          {editingText ? "Save" : "Send"}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Read-only view of an existing comment (with edit/delete affordances)
// -----------------------------------------------------------------
function CommentViewer({ comment, onEdit, onDelete, onClose }) {
  return (
    <div className="bv-lb-composer is-viewer" onClick={(e) => e.stopPropagation()}>
      <div className="anchor">
        {comment.annotations?.length ? "On a highlighted region" : "On this photo"}
        <span style={{color:"oklch(0.55 0 0)", marginLeft: 8}}>
          {new Date(comment.editedAt || comment.askedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
        </span>
      </div>
      <div className="body">{comment.text}</div>
      {comment.reply && (
        <div className="reply">
          <div className="from">Reply from 126 Colby team</div>
          {comment.reply.text}
        </div>
      )}
      <div className="actions">
        <button className="bv-btn is-danger" onClick={onDelete}>Delete</button>
        <button className="bv-btn" onClick={onClose}>Close</button>
        <button className="bv-btn is-primary" onClick={onEdit}>Edit</button>
      </div>
    </div>
  );
}

Object.assign(window, { PhotoLightbox });
})();
