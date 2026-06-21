"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────
type Prospect = {
  id: string;
  rank: number;
  fullName: string;
  firstName: string;
  lastName: string;
  firm: string | null;
  roles: string;
  permitCount: number;
  avgCost: number | null;
  medianCost: number | null;
  scopeKeywords: string | null;
  isUnbundledCandidate: boolean;
  collisionRisk: boolean;
  licenseNo: string | null;
  agentAddress: string | null;
  agentCity: string | null;
  agentState: string | null;
  agentZip: string | null;
  phone: string | null;
  phoneSource: string | null;
  email: string | null;
  emailSource: string | null;
  website: string | null;
  contactStatus: string;
  licenseNote: string | null;
  callScript: string;
  disposition: string;
  rating: number | null;
  favorite: boolean;
  leftVoicemail: boolean;
  availableToHire: boolean | null;
  goodFeeling: boolean | null;
  notes: string | null;
  callCount: number;
  emailedAt: string | null;
  lastContactedAt: string | null;
};

type StatusFilter = "all" | "not_called" | "called" | "favorites";

// ─── Helpers ────────────────────────────────────────────────────────────
const money = (v: number | null) => (v == null ? "—" : `$${Number(v).toLocaleString()}`);

const API_BASE = "/api/admin/dialer";

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json() as Promise<T>;
}

function gmailUrl(p: Prospect): string {
  const subject = "Permit-only drawings — SF kitchen + structural wall + plumbing fix";
  const keywords = p.scopeKeywords ? `(${p.scopeKeywords.split(",").slice(0, 3).join(", ").trim()}) ` : "";
  const body = `Hi ${p.firstName},

I'm a homeowner in San Francisco planning a kitchen remodel that involves opening a structural wall and correcting a plumbing defect in the main waste stack.

I came across your work going through SF DBI permit records — you've filed a number of single-family ${keywords}permits recently, which lines up closely with my project.

I already have a general contractor and a structural engineer lined up; what I'm missing is a permit-ready drawing set. Do you take permit-only / unbundled work, and would you have capacity in the next few weeks? Happy to send the scope and the engineer's prelim.

Thanks,
Justin`;
  return (
    "https://mail.google.com/mail/?view=cm&fs=1" +
    (p.email ? `&to=${encodeURIComponent(p.email)}` : "") +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}



// ─── StatusDot ──────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const cls =
    status === "verified"
      ? "bg-emerald-500"
      : status === "partial"
        ? "bg-amber-500"
        : "bg-muted-foreground/50";
  return (
    <span
      className={`inline-block size-[7px] shrink-0 rounded-full ${cls}`}
      title={`contact: ${status}`}
    />
  );
}

// ─── Stars ──────────────────────────────────────────────────────────────
function Stars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState<number>(0);
  return (
    <div className="flex gap-1 text-2xl" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = hovered ? n <= hovered : (value ?? 0) >= n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            className={`leading-none transition-colors ${
              filled ? "text-amber-400" : "text-muted-foreground/30 hover:text-amber-400/60"
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

// ─── SegmentedControl ───────────────────────────────────────────────────
function SegmentedControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const options: { v: boolean | null; label: string; cls: string }[] = [
    { v: true, label: "Yes", cls: "bg-emerald-500/20 text-emerald-400 ring-emerald-500/40" },
    { v: false, label: "No", cls: "bg-destructive/20 text-destructive ring-destructive/40" },
    { v: null, label: "Unknown", cls: "bg-sky-500/20 text-sky-400 ring-sky-500/40" },
  ];
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </label>
      <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-border/40">
        {options.map((opt) => {
          const active = value === opt.v;
          return (
            <button
              key={String(opt.v)}
              type="button"
              onClick={() => onChange(opt.v)}
              className={`border-r border-border/40 px-3 py-1.5 text-xs font-medium last:border-r-0 transition-colors ${
                active ? `${opt.cls} font-semibold` : "bg-card/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ProspectRow ────────────────────────────────────────────────────────
function ProspectRow({
  prospect: p,
  isActive,
  onSelect,
}: {
  prospect: Prospect;
  isActive: boolean;
  onSelect: () => void;
}) {
  const called = p.callCount > 0;
  const isFavorite = Boolean(p.favorite);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex w-full items-start gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition-colors hover:bg-card/60 ${
        isActive ? "bg-card/60 shadow-[inset_3px_0_0_hsl(var(--chart-1))]" : ""
      } ${called ? "opacity-50" : ""}`}
    >
      {/* Favorite star — top-right corner of the card */}
      {isFavorite && (
        <span className="absolute right-2 top-2 text-xs text-amber-500" title="Saved">
          ⭐️
        </span>
      )}
      <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground/60">{p.rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          {called && <span className="text-emerald-500 text-xs">✓</span>}
          {p.fullName}
          <StatusDot status={p.contactStatus} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {p.firm || "— no firm on record —"}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground/60">
          <span>{p.permitCount} permits</span>
          <span>{money(p.avgCost)} avg</span>
          {p.isUnbundledCandidate && (
            <span className="rounded-full ring-1 ring-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-500">
              unbundled
            </span>
          )}
          {p.collisionRisk && (
            <span className="rounded-full ring-1 ring-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-500">
              verify identity
            </span>
          )}
          {p.rating ? <span>{"★".repeat(p.rating)}</span> : null}
        </div>
      </div>
    </button>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────
function DetailPanel({
  prospect: p,
  onUpdate,
}: {
  prospect: Prospect;
  onUpdate: () => void;
}) {
  const [notes, setNotes] = useState(p.notes || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setNotes(p.notes || ""), [p.notes]);

  /** Saves a field with a spinner toast → success/error confirmation. */
  const patch = async (body: Record<string, unknown>, label = "Saving…") => {
    setSaving(true);
    try {
      await toast.promise(
        api(`/prospects/${p.id}/state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { loading: label, success: "Saved", error: "Save failed" },
      );
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  const logCall = async (outcome: string) => {
    const label = outcome === "connected" ? "Logging connected call…" : "Logging call…";
    const success = outcome === "connected" ? "Connected — logged" : "Call logged";
    await toast.promise(
      api(`/prospects/${p.id}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      }),
      { loading: label, success, error: "Failed to log call" },
    );
    onUpdate();
  };

  const markEmailed = async () => {
    await api(`/prospects/${p.id}/emailed`, { method: "POST" });
    setTimeout(onUpdate, 400);
  };

  const copyScript = () => {
    navigator.clipboard.writeText(p.callScript).then(() => toast.success("Script copied"));
  };

  const contactCaveat = [
    p.phone && p.phoneSource ? `Phone source: ${p.phoneSource}` : "",
    p.email && p.emailSource ? `Email source: ${p.emailSource}` : "",
    p.contactStatus === "needs_research"
      ? "No verified contact info yet — use the DBI permit record or CA Architects Board to confirm before reaching out."
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{p.fullName}</h2>
          <p className="text-sm text-muted-foreground">
            {p.firm || "— no firm on record —"} · {p.roles}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.isUnbundledCandidate && (
              <span className="rounded-full ring-1 ring-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-500">
                unbundled candidate
              </span>
            )}
            {p.collisionRisk && (
              <span className="rounded-full ring-1 ring-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">
                ⚠ common name — verify identity
              </span>
            )}
            <span className="rounded-full ring-1 ring-border/40 px-2 py-0.5 text-[10px] text-muted-foreground">
              contact: {p.contactStatus}
            </span>
            <span className="rounded-full ring-1 ring-border/40 px-2 py-0.5 text-[10px] text-muted-foreground">
              rank #{p.rank}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => patch({ favorite: !p.favorite })}
          className={`rounded-lg ring-1 px-3 py-1.5 text-sm font-semibold transition-colors ${
            p.favorite
              ? "ring-amber-500/40 bg-amber-500/10 text-amber-400"
              : "ring-border/40 bg-card/60 text-muted-foreground hover:ring-muted-foreground/40"
          }`}
        >
          {p.favorite ? "★ Saved" : "☆ Save"}
        </button>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2.5">
        {[
          { k: "Matching permits", v: p.permitCount },
          { k: "Avg cost", v: money(p.avgCost) },
          { k: "Median cost", v: money(p.medianCost) },
          { k: "Calls logged", v: p.callCount || 0 },
        ].map((s) => (
          <div key={s.k} className="min-w-[108px] rounded-xl ring-1 ring-border/40 bg-card/60 px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground/60">{s.k}</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums">{s.v}</div>
          </div>
        ))}
      </div>

      {/* License # */}
      {p.licenseNo && (
        <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            License #
          </h3>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-foreground">{p.licenseNo}</span>
            <a
              href="https://www.cab.ca.gov/consumers/license_verification.shtml"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md ring-1 ring-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-500/20"
            >
              Verify on CA Architects Board →
            </a>
          </div>
        </div>
      )}

      {/* Mailing address */}
      {p.agentAddress && (
        <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Mailing address
          </h3>
          <p className="text-sm text-foreground">
            {p.agentAddress}
            {p.agentCity || p.agentState || p.agentZip ? (
              <span className="block text-muted-foreground">
                {[p.agentCity, p.agentState].filter(Boolean).join(", ")}
                {p.agentZip ? ` ${p.agentZip}` : ""}
              </span>
            ) : null}
          </p>
        </div>
      )}

      {/* License note */}
      {p.licenseNote && (
        <div
          className={`rounded-xl ring-1 p-4 ${
            p.collisionRisk
              ? "ring-amber-500/30 bg-amber-500/5"
              : "ring-border/40 bg-card/60"
          }`}
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Notes & verification
          </h3>
          <p className={`text-sm leading-relaxed ${p.collisionRisk ? "text-amber-300" : "text-muted-foreground"}`}>
            {p.licenseNote}
          </p>
        </div>
      )}

      {/* Reach out */}
      <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Reach out
        </h3>
        <div className="flex flex-wrap gap-2.5">
          {p.phone ? (
            <a
              href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-primary/90"
            >
              📞 Call {p.phone}
            </a>
          ) : (
            <a
              href="https://dbiweb02.sfgov.org/dbipts/default.aspx?page=ApplicantSearch"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg ring-1 ring-border/40 bg-card/60 px-3.5 py-2.5 text-sm font-semibold opacity-40"
            >
              📞 No verified number — look up on DBI
            </a>
          )}
          <a
            href={gmailUrl(p)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={markEmailed}
            className={`inline-flex items-center gap-2 rounded-lg ring-1 ring-border/40 bg-card/60 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:ring-muted-foreground/40 ${
              !p.email ? "opacity-40" : ""
            }`}
          >
            ✉️ {p.email ? "Email via Gmail" : "Draft email (add address)"}
          </a>
          {p.website && (
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg ring-1 ring-border/40 bg-card/60 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:ring-muted-foreground/40"
            >
              🌐 Website
            </a>
          )}
        </div>
        {contactCaveat && (
          <p className="mt-2 text-[11.5px] text-muted-foreground/60">{contactCaveat}</p>
        )}
        {p.emailedAt && (
          <p className="mt-1 text-[11.5px] text-muted-foreground/60">
            ✉️ Marked emailed: {p.emailedAt}
          </p>
        )}
      </div>

      {/* Call script */}
      <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Call script (tailored)
        </h3>
        <pre className="whitespace-pre-wrap rounded-lg ring-1 ring-border/40 bg-background/60 p-3.5 font-mono text-sm leading-relaxed text-foreground/80">
          {p.callScript}
        </pre>
        <button
          type="button"
          onClick={copyScript}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold transition-colors hover:bg-primary/90"
        >
          📋 Copy script
        </button>
      </div>

      {/* Log the call */}
      <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Log the call
        </h3>
        <div className="flex flex-wrap gap-2.5">
          {(["no_answer", "voicemail", "connected", "callback"] as const).map((outcome) => {
            const isActive = p.disposition === outcome;
            const activeStyles =
              outcome === "connected"
                ? "ring-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                : outcome === "voicemail"
                  ? "ring-amber-500/40 bg-amber-500/20 text-amber-400"
                  : outcome === "no_answer"
                    ? "ring-rose-500/40 bg-rose-500/20 text-rose-400"
                    : "ring-sky-500/40 bg-sky-500/20 text-sky-400";
            return (
              <button
                key={outcome}
                type="button"
                onClick={() => logCall(outcome)}
                className={`rounded-lg ring-1 px-3 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? activeStyles
                    : "ring-border/40 bg-card/60 text-muted-foreground hover:ring-muted-foreground/40"
                }`}
              >
                {isActive && "✓ "}
                {outcome.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground/60">
          Current status: <strong>{p.disposition}</strong>
          {p.lastContactedAt ? ` · last contacted ${p.lastContactedAt}` : ""}
        </p>
      </div>

      {/* Rate & qualify */}
      <div className="rounded-xl ring-1 ring-border/40 bg-card/60 p-4">
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Rate & qualify
        </h3>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-[0.04em] text-muted-foreground">
              Rating
            </label>
            <Stars value={p.rating} onChange={(n) => patch({ rating: n })} />
          </div>
          <div />
          <SegmentedControl
            label="Available to hire"
            value={p.availableToHire}
            onChange={(v) => patch({ availableToHire: v })}
          />
          <SegmentedControl
            label="Good feeling"
            value={p.goodFeeling}
            onChange={(v) => patch({ goodFeeling: v })}
          />
        </div>
        <div className="mt-3.5">
          <label className="mb-1.5 block text-xs uppercase tracking-[0.04em] text-muted-foreground">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What they said, rate quoted, availability, vibe…"
            className="min-h-[80px] w-full resize-y rounded-lg ring-1 ring-border/40 bg-background/60 p-2.5 text-sm text-foreground outline-none focus:ring-ring"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => patch({ notes }, "Saving notes…")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && (
                <svg className="size-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Save notes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────
export function DialerApp() {
  const [items, setItems] = useState<Prospect[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Prospect | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [hideUnavail, setHideUnavail] = useState(false);
  const [onlyUnbundled, setOnlyUnbundled] = useState(false);
  const [onlyLicensed, setOnlyLicensed] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (query) params.set("q", query);
    if (hideUnavail) params.set("hideUnavailable", "true");
    const data = await api<{ prospects: Prospect[] }>(`/prospects?${params}`);
    let result = data.prospects || [];
    if (onlyUnbundled) result = result.filter((p) => p.isUnbundledCandidate);
    if (onlyLicensed) result = result.filter((p) => !!p.licenseNo);
    setItems(result);
  }, [statusFilter, query, hideUnavail, onlyUnbundled, onlyLicensed]);

  const runEnrich = async () => {
    setEnriching(true);
    try {
      const res = await api<{ ok: boolean; message: string }>("/prospects/enrich", { method: "POST" });
      toast.success(res.message || "Enrichment complete");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const select = async (id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
    const p = await api<Prospect>(`/prospects/${id}`);
    setDetail(p);
  };

  const refresh = async () => {
    if (selectedId) {
      const p = await api<Prospect>(`/prospects/${selectedId}`);
      setDetail(p);
    }
    await load();
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 180);
  };

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "not_called", label: "Not called" },
    { key: "called", label: "Called" },
    { key: "favorites", label: "★ Saved" },
  ];

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[500px] overflow-hidden rounded-xl ring-1 ring-border/40">
      {/* Sidebar / List */}
      <aside
        className={`flex w-full shrink-0 flex-col border-r border-border/40 bg-card/40 md:w-[380px] ${
          mobileDetail ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="space-y-2.5 border-b border-border/40 p-3">
          <input
            type="text"
            placeholder="Search name, firm, role…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg ring-1 ring-border/40 bg-background/60 px-3 py-2 text-sm outline-none focus:ring-ring"
          />
          <div className="flex gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatusFilter(t.key)}
                className={`flex-1 rounded-lg ring-1 px-2 py-1.5 text-center text-xs transition-colors ${
                  statusFilter === t.key
                    ? "ring-primary bg-primary text-primary-foreground"
                    : "ring-border/40 bg-card/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideUnavail}
              onChange={(e) => setHideUnavail(e.target.checked)}
              className="accent-indigo-500"
            />
            Hide "not available to hire"
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyUnbundled}
              onChange={(e) => setOnlyUnbundled(e.target.checked)}
              className="accent-emerald-500"
            />
            Unbundled candidates only
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyLicensed}
              onChange={(e) => setOnlyLicensed(e.target.checked)}
              className="accent-sky-500"
            />
            Has license # on record
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground/60">
              No prospects match.
            </div>
          ) : (
            items.map((p) => (
              <ProspectRow
                key={p.id}
                prospect={p}
                isActive={selectedId === p.id}
                onSelect={() => select(p.id)}
              />
            ))
          )}
        </div>
        <div className="border-t border-border/40 p-2.5">
          <button
            type="button"
            onClick={runEnrich}
            disabled={enriching}
            className="w-full rounded-lg ring-1 ring-sky-500/30 bg-sky-500/10 py-2 text-xs font-semibold text-sky-400 transition-colors hover:bg-sky-500/20 disabled:opacity-40"
          >
            {enriching ? "Enriching…" : "Enrich from DBI (3pee-9qhc)"}
          </button>
        </div>
      </aside>

      {/* Detail panel */}
      <main
        className={`flex-1 overflow-y-auto p-5 ${
          mobileDetail ? "block" : "hidden md:block"
        }`}
      >
        {mobileDetail && (
          <button
            type="button"
            onClick={() => setMobileDetail(false)}
            className="mb-3 rounded-lg ring-1 ring-border/40 bg-card/60 px-3 py-1.5 text-xs font-semibold md:hidden"
          >
            ← Back
          </button>
        )}
        {detail ? (
          <DetailPanel prospect={detail} onUpdate={refresh} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
            Select a prospect to see their script, contact options, and call notes.
          </div>
        )}
      </main>


    </div>
  );
}
