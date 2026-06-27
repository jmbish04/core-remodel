/* eslint-disable */
// =============================================================
// Build-Vision Admin
// - List of issued vendor links
// - Create / edit / revoke
// - Stats + question responses + visitor flow
// =============================================================

(() => {
const { useState, useMemo, useCallback, useEffect } = React;

// -------------------------------------------------------------
// Top-level App
// -------------------------------------------------------------
function AdminApp() {
  const [links, setLinks] = useState(() => structuredClone(window.BV_MOCK_LINKS));
  const [activeUuid, setActiveUuid] = useState(links[0]?.uuid || null);
  const [tab, setTab] = useState("settings");  // settings | stats | flow | questions
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState(null);

  const link = links.find(l => l.uuid === activeUuid);

  const flashToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const updateLink = useCallback((uuid, patch) => {
    setLinks(ls => ls.map(l => l.uuid === uuid ? { ...l, ...patch, permissions: { ...l.permissions, ...(patch.permissions || {}) } } : l));
  }, []);

  const revokeLink = useCallback((uuid) => {
    if (!confirm("Revoke this link? The recipient will get a 'link revoked' page.")) return;
    updateLink(uuid, { revoked: true });
    flashToast("Link revoked");
  }, [updateLink, flashToast]);

  const replyToQuestion = useCallback((uuid, questionId, replyText) => {
    setLinks(ls => ls.map(l => {
      if (l.uuid !== uuid) return l;
      return {
        ...l,
        questions: l.questions.map(q => q.id === questionId
          ? { ...q, reply: { text: replyText, repliedAt: new Date().toISOString() } }
          : q),
      };
    }));
    flashToast("Reply sent");
  }, [flashToast]);

  const createLink = useCallback((draft) => {
    const uuid = draft.persona.slice(0,4) + "-" + Math.random().toString(36).slice(2,10);
    const persona = window.BV_PERSONAS[draft.persona];
    const newLink = {
      uuid,
      recipient: { name: draft.name, company: draft.company, role: persona.label },
      persona: draft.persona,
      welcome: draft.welcome || `${draft.name.split(" ")[0]} — full brief below. Drop questions inline; we'll respond in 24h.`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (draft.ttl || 30) * 86400000).toISOString(),
      revoked: false,
      permissions: {
        budgetMode: draft.budgetMode || "off",
        showInternal: false,
        showComparator: persona.showComparator !== false,
        showPhotos: true,
        hiddenSections: [],
        hiddenInternal: [],
      },
      stats: { opens: 0, lastOpen: null, timeSpent: "0s", sectionsViewed: 0 },
      flow: [],
      questions: [],
    };
    setLinks(ls => [newLink, ...ls]);
    setActiveUuid(uuid);
    setCreating(false);
    flashToast("Link created · copy URL to share");
  }, [flashToast]);

  return (
    <div className="bv-admin">
      <AdminSidebar
        links={links}
        activeUuid={activeUuid}
        onPick={setActiveUuid}
        onNew={() => setCreating(true)}
      />
      <main className="bv-admin-main">
        <div className="bv-admin-bar">
          <div className="crumb">
            <a href="index.html" style={{color:"var(--ink-muted)",textDecoration:"none"}}>build-vision admin</a>
            <span style={{color:"var(--ink-faint)"}}>/</span>
            <span style={{color:"var(--ink-strong)"}}>{link ? link.recipient.company : "—"}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <a className="bv-btn" href={`index.html#uuid=${link?.uuid || ""}`} target="_blank">
              Preview as recipient ↗
            </a>
            <button
              className="bv-btn"
              onClick={() => {
                navigator.clipboard?.writeText(`https://126colby.com/build-vision/${link?.uuid || ""}`);
                flashToast("Link copied to clipboard");
              }}
            >
              Copy share URL
            </button>
            {link && !link.revoked && (
              <button className="bv-btn is-danger" onClick={() => revokeLink(link.uuid)}>Revoke</button>
            )}
          </div>
        </div>

        {creating && (
          <CreateLinkPanel
            onCreate={createLink}
            onCancel={() => setCreating(false)}
          />
        )}

        {link && !creating && (
          <>
            <LinkHeader link={link} />

            <div className="bv-admin-tabs">
              {["settings","stats","flow","questions"].map(t => (
                <button
                  key={t}
                  className={`bv-admin-tab ${tab === t ? "is-active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t === "settings" && "Settings"}
                  {t === "stats" && "Stats"}
                  {t === "flow" && "Visitor flow"}
                  {t === "questions" && (
                    <>
                      Questions
                      {link.questions.filter(q => !q.reply).length > 0 && (
                        <span className="badge-pip">{link.questions.filter(q => !q.reply).length}</span>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>

            {tab === "settings" && <SettingsTab link={link} update={(patch) => updateLink(link.uuid, patch)} />}
            {tab === "stats"    && <StatsTab    link={link} />}
            {tab === "flow"     && <FlowTab     link={link} />}
            {tab === "questions"&& <QuestionsTab link={link} onReply={(qid, text) => replyToQuestion(link.uuid, qid, text)} />}
          </>
        )}

        {!link && !creating && (
          <div style={{padding:"60px 0",textAlign:"center",color:"var(--ink-muted)"}}>
            No link selected. Pick one from the sidebar or create a new one.
          </div>
        )}
      </main>

      {toast && (
        <div className="bv-toast">
          <span className="dot" />
          {toast}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Admin sidebar — list of links
// -------------------------------------------------------------
function AdminSidebar({ links, activeUuid, onPick, onNew }) {
  const [filter, setFilter] = useState("all");

  const filtered = links.filter(l => {
    if (filter === "all") return true;
    if (filter === "active") return !l.revoked && new Date(l.expiresAt) > new Date();
    if (filter === "expired") return new Date(l.expiresAt) <= new Date();
    if (filter === "revoked") return l.revoked;
    if (filter === "open-q") return l.questions.some(q => !q.reply);
    return true;
  });

  return (
    <aside className="bv-admin-sb">
      <div className="bv-admin-sb-head">
        <div className="mark">
          <span className="dot" />
          <span>Build vision · admin</span>
        </div>
        <button className="bv-btn is-primary" onClick={onNew} style={{marginTop:14, width:"100%"}}>
          + New link
        </button>
      </div>
      <div className="bv-admin-filter">
        {[
          {k:"all", l:"All"},
          {k:"active", l:"Active"},
          {k:"open-q", l:"Open Qs"},
          {k:"expired", l:"Expired"},
          {k:"revoked", l:"Revoked"},
        ].map(f => (
          <button
            key={f.k}
            className={`chip ${filter === f.k ? "is-active" : ""}`}
            onClick={() => setFilter(f.k)}
          >
            {f.l}
          </button>
        ))}
      </div>
      <div className="bv-admin-sb-list">
        {filtered.map(l => {
          const days = Math.round((new Date(l.expiresAt) - new Date()) / 86400000);
          const isActive = activeUuid === l.uuid;
          const openQs = l.questions.filter(q => !q.reply).length;
          const state = l.revoked ? "revoked" : days <= 0 ? "expired" : days <= 7 ? "warn" : "ok";
          return (
            <button
              key={l.uuid}
              className={`bv-link-card ${isActive ? "is-active" : ""}`}
              onClick={() => onPick(l.uuid)}
            >
              <div className="bv-link-card-h">
                <span className={`bv-link-state st-${state}`} />
                <span className="who">{l.recipient.company}</span>
                {openQs > 0 && <span className="badge-pip">{openQs} Q</span>}
              </div>
              <div className="bv-link-card-meta">
                {window.BV_PERSONAS[l.persona]?.label} · {l.recipient.name}
              </div>
              <div className="bv-link-card-foot">
                <span style={{fontFamily:"var(--font-mono)"}}>{l.uuid.slice(0,8)}</span>
                <span>
                  {l.revoked ? "Revoked" :
                    days <= 0 ? "Expired" :
                    `${days}d left`}
                </span>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{padding:"40px 16px",textAlign:"center",color:"var(--ink-faint)",fontSize:13}}>
            No links match.
          </div>
        )}
      </div>
    </aside>
  );
}

// -------------------------------------------------------------
// Link header — top-line summary card
// -------------------------------------------------------------
function LinkHeader({ link }) {
  const days = Math.round((new Date(link.expiresAt) - new Date()) / 86400000);
  return (
    <div className="bv-link-header">
      <div>
        <p className="bv-eyebrow" style={{margin: "0 0 6px"}}>
          <span className="num">UUID</span>
          <span className="sep">·</span>
          <span style={{fontFamily:"var(--font-mono)", letterSpacing: 0, color: "var(--ink-soft)", textTransform:"none"}}>{link.uuid}</span>
        </p>
        <h1 style={{fontFamily:"var(--font-heading)",fontSize:30,fontWeight:500,letterSpacing:"-0.02em",margin:"0 0 6px",color:"var(--ink-strong)"}}>
          {link.recipient.name}
        </h1>
        <div style={{fontSize:14, color:"var(--ink-soft)"}}>
          {link.recipient.company} · <span style={{color:"var(--ink-muted)"}}>{window.BV_PERSONAS[link.persona]?.label}</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,minWidth:540}}>
        <KPI k="Opens" v={link.stats.opens} sub={link.stats.lastOpen ? "Last " + new Date(link.stats.lastOpen).toLocaleDateString() : "Never opened"} />
        <KPI k="Time on page" v={link.stats.timeSpent} sub={link.stats.sectionsViewed + " sections viewed"} />
        <KPI k="Open questions" v={link.questions.filter(q => !q.reply).length} sub={link.questions.length + " total"} kind={link.questions.filter(q => !q.reply).length > 0 ? "warn" : "ok"} />
        <KPI k="Days left" v={link.revoked ? "—" : days} sub={link.revoked ? "Revoked" : "Expires " + new Date(link.expiresAt).toLocaleDateString()} kind={link.revoked ? "bad" : days <= 7 ? "warn" : "ok"} />
      </div>
    </div>
  );
}

function KPI({ k, v, sub, kind = "" }) {
  return (
    <div className={`bv-admin-kpi ${kind ? "is-" + kind : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

// -------------------------------------------------------------
// Settings tab
// -------------------------------------------------------------
function SettingsTab({ link, update }) {
  const persona = window.BV_PERSONAS[link.persona];
  const sections = window.BV_SECTIONS;
  const allowedSections = sections.filter(s => persona.sections.includes(s.id) || s.kind === "internal");
  const internalSections = sections.filter(s => s.kind === "internal");

  return (
    <div className="bv-admin-grid">
      {/* Welcome message */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Welcome message</h3>
        <p className="bv-admin-help">Shown above the fold on the cover page. Speak directly to the recipient.</p>
        <textarea
          className="bv-admin-textarea"
          value={link.welcome}
          onChange={(e) => update({ welcome: e.target.value })}
          rows={4}
        />
      </div>

      {/* Recipient */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Recipient</h3>
        <div className="bv-form-row">
          <label>Name</label>
          <input
            className="bv-input"
            value={link.recipient.name}
            onChange={(e) => update({ recipient: { ...link.recipient, name: e.target.value } })}
          />
        </div>
        <div className="bv-form-row">
          <label>Company</label>
          <input
            className="bv-input"
            value={link.recipient.company}
            onChange={(e) => update({ recipient: { ...link.recipient, company: e.target.value } })}
          />
        </div>
        <div className="bv-form-row">
          <label>Role</label>
          <select
            className="bv-input"
            value={link.persona}
            onChange={(e) => update({ persona: e.target.value, recipient: { ...link.recipient, role: window.BV_PERSONAS[e.target.value].label } })}
          >
            {Object.entries(window.BV_PERSONAS).map(([k, p]) => (
              <option key={k} value={k}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Budget visibility */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Budget detail</h3>
        <p className="bv-admin-help">Controls how much $ context this recipient sees. Per-section overrides available below.</p>
        <div className="bv-radio-row">
          {[
            {v:"off", l:"Hidden", h:"No $ anywhere"},
            {v:"rounded", l:"Rounded", h:"$57k not $57,250"},
            {v:"detailed", l:"Detailed", h:"Full numbers + variance"},
          ].map(o => (
            <label key={o.v} className={`bv-radio ${link.permissions.budgetMode === o.v ? "is-on" : ""}`}>
              <input
                type="radio"
                name="budget"
                value={o.v}
                checked={link.permissions.budgetMode === o.v}
                onChange={() => update({ permissions: { budgetMode: o.v } })}
              />
              <div>
                <div className="l">{o.l}</div>
                <div className="h">{o.h}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Internal sections opt-in */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Internal sections</h3>
        <p className="bv-admin-help">Hidden by default. Opt in per-section to share internal-only content (e.g. the $300k cap triage).</p>
        {internalSections.map(s => (
          <label key={s.id} className="bv-check-row">
            <input
              type="checkbox"
              checked={link.permissions.hiddenInternal?.includes(s.id) || false}
              onChange={(e) => {
                const cur = link.permissions.hiddenInternal || [];
                const next = e.target.checked
                  ? [...cur, s.id]
                  : cur.filter(x => x !== s.id);
                update({ permissions: { hiddenInternal: next } });
              }}
            />
            <span>
              <span style={{color: "var(--ink-strong)"}}>{s.title}</span>
              <span style={{color: "var(--ink-muted)", fontSize: 12, display: "block"}}>{s.summary}</span>
            </span>
          </label>
        ))}
      </div>

      {/* Section visibility */}
      <div className="bv-admin-card" style={{gridColumn: "1 / -1"}}>
        <h3 className="bv-admin-h">Sections this recipient sees</h3>
        <p className="bv-admin-help">Defaults come from the persona. Toggle off to hide any section. Hidden sections also hide their photos.</p>
        <div className="bv-section-grid">
          {allowedSections.filter(s => s.kind !== "internal").map(s => {
            const hidden = link.permissions.hiddenSections?.includes(s.id);
            return (
              <label key={s.id} className={`bv-section-toggle ${hidden ? "is-off" : ""}`}>
                <div className="meta">
                  <span className="g">{s.group}</span>
                  <span className="t">{s.title}</span>
                </div>
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={(e) => {
                    const cur = link.permissions.hiddenSections || [];
                    const next = e.target.checked
                      ? cur.filter(x => x !== s.id)
                      : [...cur, s.id];
                    update({ permissions: { hiddenSections: next } });
                  }}
                />
                <span className={`bv-switch ${!hidden ? "is-on" : ""}`} />
              </label>
            );
          })}
        </div>
      </div>

      {/* Other toggles */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Other</h3>
        <div className="bv-check-list">
          <ToggleRow
            label="Show photos"
            help="If off, the brief is text-only."
            on={link.permissions.showPhotos !== false}
            onChange={(v) => update({ permissions: { showPhotos: v } })}
          />
          <ToggleRow
            label="Kitchen scenario comparator"
            help="The A/B/C/D variance table."
            on={link.permissions.showComparator !== false}
            onChange={(v) => update({ permissions: { showComparator: v } })}
          />
        </div>
      </div>

      {/* Expiry */}
      <div className="bv-admin-card">
        <h3 className="bv-admin-h">Expiry</h3>
        <p className="bv-admin-help">Default 30d TTL. After expiry the recipient sees a "link expired" page.</p>
        <div className="bv-form-row">
          <label>Expires on</label>
          <input
            type="date"
            className="bv-input"
            value={link.expiresAt.slice(0,10)}
            onChange={(e) => update({ expiresAt: new Date(e.target.value).toISOString() })}
          />
        </div>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          {[7, 14, 30, 60].map(d => (
            <button
              key={d}
              className="bv-btn"
              onClick={() => update({ expiresAt: new Date(Date.now() + d * 86400000).toISOString() })}
              style={{flex: 1}}
            >+{d}d</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, help, on, onChange }) {
  return (
    <label className="bv-toggle-row">
      <span>
        <span style={{color: "var(--ink-strong)", fontWeight: 500}}>{label}</span>
        <span style={{color: "var(--ink-muted)", fontSize: 12, display: "block"}}>{help}</span>
      </span>
      <span className={`bv-switch ${on ? "is-on" : ""}`} onClick={() => onChange(!on)} />
    </label>
  );
}

// -------------------------------------------------------------
// Stats tab
// -------------------------------------------------------------
function StatsTab({ link }) {
  const sectionViewCounts = (link.flow || []).filter(e => e.event.startsWith("Viewed")).reduce((acc, e) => {
    const sec = e.event.replace("Viewed ", "");
    acc[sec] = (acc[sec] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bv-admin-grid">
      <div className="bv-admin-card" style={{gridColumn: "1 / -1"}}>
        <h3 className="bv-admin-h">Engagement summary</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <KPI k="Total opens" v={link.stats.opens} sub={link.stats.lastOpen ? "Last " + new Date(link.stats.lastOpen).toLocaleString() : "Never"} />
          <KPI k="Time on page" v={link.stats.timeSpent} sub="Aggregate across sessions" />
          <KPI k="Sections viewed" v={link.stats.sectionsViewed} sub="Unique" />
          <KPI k="Questions" v={link.questions.length} sub={link.questions.filter(q => q.reply).length + " answered"} kind={link.questions.filter(q => !q.reply).length > 0 ? "warn" : ""} />
        </div>
      </div>

      <div className="bv-admin-card" style={{gridColumn: "1 / -1"}}>
        <h3 className="bv-admin-h">Section drill-down</h3>
        {Object.entries(sectionViewCounts).length === 0 ? (
          <div style={{padding:"20px 0",color:"var(--ink-muted)",fontSize:14}}>No section views recorded yet.</div>
        ) : (
          <table className="bv-admin-table">
            <thead><tr><th>Section</th><th style={{textAlign:"right"}}>Views</th></tr></thead>
            <tbody>
              {Object.entries(sectionViewCounts).sort((a,b) => b[1] - a[1]).map(([sec, n]) => (
                <tr key={sec}><td>{sec}</td><td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Flow tab — chronological event log
// -------------------------------------------------------------
function FlowTab({ link }) {
  return (
    <div className="bv-admin-card" style={{maxWidth: 720}}>
      <h3 className="bv-admin-h">Visitor flow</h3>
      <p className="bv-admin-help">Every event recorded for this link, oldest first.</p>
      {(!link.flow || link.flow.length === 0) ? (
        <div style={{padding:"24px 0",color:"var(--ink-muted)",fontSize:14}}>
          No activity yet — the recipient hasn't opened this link.
        </div>
      ) : (
        <ol className="bv-flow">
          {link.flow.map((e, i) => (
            <li key={i}>
              <span className="dot" />
              <div>
                <div className="ev">{e.event}</div>
                <div className="ts">{new Date(e.ts).toLocaleString()}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Questions tab — answer recipient questions
// -------------------------------------------------------------
function QuestionsTab({ link, onReply }) {
  return (
    <div style={{maxWidth: 880}}>
      {link.questions.length === 0 && (
        <div className="bv-admin-card">
          <p style={{margin: 0, color:"var(--ink-muted)"}}>No questions from this recipient yet.</p>
        </div>
      )}
      {link.questions.map(q => (
        <QuestionRow key={q.id} q={q} sections={window.BV_SECTIONS} onReply={(text) => onReply(q.id, text)} />
      ))}
    </div>
  );
}

function QuestionRow({ q, sections, onReply }) {
  const [reply, setReply] = useState("");
  const sec = sections.find(s => s.id === q.sectionId);
  return (
    <div className="bv-admin-card" style={{marginBottom: 14}}>
      <div className="bv-q-head">
        <div>
          <div style={{fontFamily:"var(--font-mono)",fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-muted)"}}>
            {sec ? `${sec.group} · ${sec.title}` : "Unknown section"}
          </div>
          <div style={{fontSize:13,color:"var(--bv-accent)",fontFamily:"var(--font-mono)",marginTop:2}}>
            "{q.anchor}"
          </div>
        </div>
        <div style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-faint)"}}>
          {new Date(q.askedAt).toLocaleDateString()} · {q.reply ? "answered" : "open"}
        </div>
      </div>
      <p style={{margin: "12px 0 0", color: "var(--ink-soft)", lineHeight: 1.55, fontSize: 14}}>
        {q.text}
      </p>
      {q.reply ? (
        <div style={{
          marginTop: 14, padding: "10px 14px",
          background: "oklch(0.72 0.16 155 / 0.08)",
          borderLeft: "2px solid var(--bv-emerald)",
          borderRadius: "var(--radius-md)",
          fontSize: 13.5, color: "var(--ink-soft)",
        }}>
          <div style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--bv-emerald)",marginBottom:4}}>
            Replied · {new Date(q.reply.repliedAt).toLocaleString()}
          </div>
          {q.reply.text}
        </div>
      ) : (
        <div style={{marginTop:14, paddingTop:14, borderTop: "1px solid var(--rule)"}}>
          <textarea
            className="bv-admin-textarea"
            placeholder="Type your reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
          />
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
            <button
              className="bv-btn is-primary"
              disabled={!reply.trim()}
              onClick={() => { onReply(reply.trim()); setReply(""); }}
            >
              Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Create link panel
// -------------------------------------------------------------
function CreateLinkPanel({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [personaKey, setPersonaKey] = useState("gc");
  const [budgetMode, setBudgetMode] = useState("off");
  const [welcome, setWelcome] = useState("");
  const [ttl, setTtl] = useState(30);

  return (
    <div className="bv-admin-card" style={{maxWidth: 880, margin: "0 auto"}}>
      <h2 style={{fontFamily:"var(--font-heading)",fontSize:26,fontWeight:500,letterSpacing:"-0.02em",margin:"0 0 6px",color:"var(--ink-strong)"}}>
        Create a new build-vision link
      </h2>
      <p style={{margin:"0 0 22px",color:"var(--ink-muted)",fontSize:14}}>
        Each recipient gets a unique URL. You can change everything later — including sections, budget visibility, and expiry.
      </p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div className="bv-form-row"><label>Recipient name</label><input className="bv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Cohen" /></div>
        <div className="bv-form-row"><label>Company</label><input className="bv-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Cohen Construction" /></div>
        <div className="bv-form-row">
          <label>Role / persona</label>
          <select className="bv-input" value={personaKey} onChange={(e) => setPersonaKey(e.target.value)}>
            {Object.entries(window.BV_PERSONAS).map(([k, p]) => (
              <option key={k} value={k}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="bv-form-row">
          <label>Link TTL</label>
          <div style={{display:"flex",gap:6}}>
            {[7,14,30,60].map(d => (
              <button key={d} className={`bv-btn ${ttl === d ? "is-primary" : ""}`} onClick={() => setTtl(d)} style={{flex:1}}>{d}d</button>
            ))}
          </div>
        </div>
        <div className="bv-form-row" style={{gridColumn:"1/-1"}}>
          <label>Budget detail</label>
          <div className="bv-radio-row">
            {[
              {v:"off", l:"Hidden"},
              {v:"rounded", l:"Rounded"},
              {v:"detailed", l:"Detailed"},
            ].map(o => (
              <label key={o.v} className={`bv-radio ${budgetMode === o.v ? "is-on" : ""}`}>
                <input type="radio" name="bm" checked={budgetMode === o.v} onChange={() => setBudgetMode(o.v)} />
                <div><div className="l">{o.l}</div></div>
              </label>
            ))}
          </div>
        </div>
        <div className="bv-form-row" style={{gridColumn:"1/-1"}}>
          <label>Welcome message <span style={{color:"var(--ink-faint)"}}>(optional)</span></label>
          <textarea className="bv-admin-textarea" rows={3} value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder="Short note that appears on the cover page…" />
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}}>
        <button className="bv-btn" onClick={onCancel}>Cancel</button>
        <button
          className="bv-btn is-primary"
          disabled={!name.trim() || !company.trim()}
          onClick={() => onCreate({ name: name.trim(), company: company.trim(), persona: personaKey, budgetMode, welcome: welcome.trim(), ttl })}
        >
          Create link
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<AdminApp />);
})();
