/**
 * @fileoverview ContactsPhonebookApp — the showroom-reps phonebook.
 *
 * A touch-first, alphabetically grouped directory of every showroom contact,
 * with a scrubbable A–Z rail (pointer + touch), a name/email search, a type
 * filter, and a business-card bulk-import flow (upload → OCR queue → status
 * tray → manual fallback). Every phone number is a one-tap `tel:` link so it
 * dials straight from a phone or the Tesla browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, ScanLine, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  CONTACT_TYPES,
  ContactCard,
  contactPersonName,
  type ContactRow,
  type ContactType,
} from "./ContactCard";

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ─── Alphabet + grouping ──────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

/** The letter a contact files under: store name for general, last name for people. */
function groupLetter(c: ContactRow): string {
  const key =
    c.type === "GENERAL_CONTACT"
      ? c.storeName ?? ""
      : c.lastName || c.firstName || c.storeName || "";
  const first = key.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

/** The within-group sort key (last-name-first for people). */
function sortKey(c: ContactRow): string {
  if (c.type === "GENERAL_CONTACT") return (c.storeName ?? "").toLowerCase();
  return `${c.lastName ?? ""} ${c.firstName ?? ""}`.trim().toLowerCase() || (c.storeName ?? "").toLowerCase();
}

interface Group {
  letter: string;
  contacts: ContactRow[];
}

const TYPE_LABEL: Record<ContactType, string> = {
  GENERAL_CONTACT: "General",
  SALES: "Sales",
  ESTIMATOR: "Estimator",
  MANAGER: "Manager",
  CUSTOMER_SERVICE: "Customer service",
  OTHER: "Other",
};

// ─── A–Z rail ─────────────────────────────────────────────────────────────────

/**
 * Sticky vertical A–Z index. Letters with no contacts are dimmed. Supports
 * pointer/touch scrubbing: press and drag over the rail to fling the matching
 * section into view (elementFromPoint keeps it accurate across DPRs/zoom).
 */
function AzRail({
  present,
  onPick,
}: {
  present: Set<string>;
  onPick: (letter: string) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const lastLetter = useRef<string | null>(null);

  const pickFromPoint = useCallback(
    (clientY: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      const ratio = (clientY - rect.top) / rect.height;
      const idx = Math.max(0, Math.min(ALPHABET.length - 1, Math.floor(ratio * ALPHABET.length)));
      const letter = ALPHABET[idx];
      if (letter === lastLetter.current) return;
      lastLetter.current = letter;
      if (present.has(letter)) onPick(letter);
    },
    [present, onPick],
  );

  return (
    <div
      ref={railRef}
      className="sticky top-24 hidden max-h-[70vh] select-none flex-col items-center justify-center gap-0.5 py-2 md:flex"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        lastLetter.current = null;
        pickFromPoint(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        pickFromPoint(e.clientY);
      }}
      aria-label="Jump to letter"
    >
      {ALPHABET.map((letter) => {
        const active = present.has(letter);
        return (
          <button
            key={letter}
            type="button"
            tabIndex={active ? 0 : -1}
            disabled={!active}
            onClick={() => active && onPick(letter)}
            className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-medium leading-none transition-colors ${
              active
                ? "text-muted-foreground hover:bg-primary/20 hover:text-foreground"
                : "cursor-default text-muted-foreground/25"
            }`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

// ─── Business-card import ─────────────────────────────────────────────────────

interface CardRow {
  id: number;
  status: string;
  isDraft: boolean;
  draftNotes: string | null;
  cfImageUrl: string | null;
  contactId: number | null;
  storeId: number | null;
  timestamp: string | null;
}

const CARD_STATUSES = ["processing", "pending", "done", "failed"] as const;
const CARD_POLL_MS = 4000;
const CARD_POLL_MAX_TICKS = 45; // ~3 min ceiling before we stop polling

function isTerminalCard(s: string): boolean {
  return s === "done" || s === "failed";
}

function CardImportModal({
  open,
  onOpenChange,
  onManual,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onManual: (card: CardRow) => void;
  onImported: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [batchIds, setBatchIds] = useState<Set<number> | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticksRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup on unmount / close.
  useEffect(() => stopPoll, [stopPoll]);
  useEffect(() => {
    if (!open) {
      stopPoll();
      setFiles([]);
      setBatchIds(null);
      setCards([]);
      ticksRef.current = 0;
    }
  }, [open, stopPoll]);

  const poll = useCallback(async (ids: Set<number>) => {
    try {
      // The list endpoint is status-scoped; fan out across all statuses and
      // keep only the cards from this batch.
      const results = await Promise.all(
        CARD_STATUSES.map((status) =>
          api<{ cards: CardRow[] }>(`/api/showroom-contacts/business-cards?status=${status}`)
            .then((d) => d.cards)
            .catch(() => [] as CardRow[]),
        ),
      );
      const mine = results.flat().filter((c) => ids.has(c.id));
      // Dedupe by id (a card could momentarily appear under two statuses).
      const byId = new Map<number, CardRow>();
      for (const c of mine) byId.set(c.id, c);
      const list = [...byId.values()];
      setCards(list);
      ticksRef.current += 1;
      const allDone = list.length >= ids.size && list.every((c) => isTerminalCard(c.status));
      if (allDone || ticksRef.current >= CARD_POLL_MAX_TICKS) {
        stopPoll();
        if (list.some((c) => c.status === "done")) onImported();
      }
    } catch (e) {
      console.error("[contacts/card-poll]", e);
    }
  }, [stopPoll, onImported]);

  const submit = useCallback(async () => {
    if (files.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const images = await Promise.all(files.map(fileToDataUrl));
      const data = await api<{ cardIds: number[]; status: string }>(
        "/api/showroom-contacts/business-cards",
        { method: "POST", body: JSON.stringify({ images }) },
      );
      const ids = new Set(data.cardIds ?? []);
      setBatchIds(ids);
      setCards((data.cardIds ?? []).map((id) => ({
        id,
        status: "processing",
        isDraft: true,
        draftNotes: null,
        cfImageUrl: null,
        contactId: null,
        storeId: null,
        timestamp: null,
      })));
      toast.success(`Uploaded ${ids.size} card${ids.size === 1 ? "" : "s"} — reading…`);
      ticksRef.current = 0;
      stopPoll();
      pollRef.current = setInterval(() => void poll(ids), CARD_POLL_MS);
      void poll(ids);
    } catch (e) {
      console.error("[contacts/card-submit]", e);
      toast.error(e instanceof Error ? e.message : "Failed to upload cards");
    } finally {
      setSubmitting(false);
    }
  }, [files, submitting, poll, stopPoll]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import business cards</DialogTitle>
          <DialogDescription>
            Snap or upload one or more cards. We read each one and add the contact
            automatically; anything we can’t parse drops into a manual tray below.
          </DialogDescription>
        </DialogHeader>

        {!batchIds ? (
          <div className="space-y-3">
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {files.length} image{files.length === 1 ? "" : "s"} selected.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => void submit()} disabled={files.length === 0 || submitting}>
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                Upload {files.length || ""}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {cards.filter((c) => isTerminalCard(c.status)).length} of {batchIds.size} processed.
            </p>
            <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
              {cards.map((card) => (
                <li
                  key={card.id}
                  className="flex items-center gap-3 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/40"
                >
                  {card.cfImageUrl ? (
                    <img
                      src={card.cfImageUrl}
                      alt="Business card"
                      className="size-12 shrink-0 rounded object-cover ring-1 ring-border/40"
                    />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                      <ScanLine className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">Card #{card.id}</p>
                    <CardStatusChip status={card.status} />
                  </div>
                  {card.status === "failed" ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onManual(card)}>
                      Enter manually
                    </Button>
                  ) : card.status === "processing" || card.status === "pending" ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    processing: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    pending: "bg-muted/60 text-muted-foreground ring-border/40",
  };
  const cls = map[status] ?? "bg-muted/60 text-muted-foreground ring-border/40";
  return (
    <span className={`mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ring-1 ${cls}`}>
      {status}
    </span>
  );
}

// ─── Manual create form ───────────────────────────────────────────────────────

interface StoreHit {
  id: number;
  name: string;
  cityName?: string | null;
  city?: string | null;
}

const EMPTY_PERSON = {
  firstName: "",
  lastName: "",
  title: "",
  type: "SALES" as ContactType,
  officePhoneNumber: "",
  mobilePhoneNumber: "",
  faxPhoneNumber: "",
  emailAddress: "",
};

function ManualContactModal({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(EMPTY_PERSON);
  const [saving, setSaving] = useState(false);

  // Store search.
  const [storeQuery, setStoreQuery] = useState("");
  const [storeHits, setStoreHits] = useState<StoreHit[]>([]);
  const [store, setStore] = useState<StoreHit | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PERSON);
      setStoreQuery("");
      setStoreHits([]);
      setStore(null);
    }
  }, [open]);

  useEffect(() => {
    if (store || storeQuery.trim().length < 2) {
      setStoreHits([]);
      return;
    }
    const t = setTimeout(() => {
      void api<{ stores: StoreHit[] }>(
        `/api/showroom-stores?search=${encodeURIComponent(storeQuery.trim())}`,
      )
        .then((d) => setStoreHits(d.stores ?? []))
        .catch(() => setStoreHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [storeQuery, store]);

  const set = (k: keyof typeof EMPTY_PERSON, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const save = useCallback(async () => {
    if (!form.firstName.trim() && !form.lastName.trim() && !form.emailAddress.trim() && !form.officePhoneNumber.trim() && !form.mobilePhoneNumber.trim()) {
      toast.error("Add at least a name, phone, or email.");
      return;
    }
    setSaving(true);
    try {
      const trimmed = (s: string) => (s.trim() ? s.trim() : undefined);
      await api<{ contactIds: number[] }>("/api/showroom-contacts", {
        method: "POST",
        body: JSON.stringify({
          storeId: store?.id,
          people: [
            {
              firstName: trimmed(form.firstName),
              lastName: trimmed(form.lastName),
              title: trimmed(form.title),
              type: form.type,
              officePhoneNumber: trimmed(form.officePhoneNumber),
              mobilePhoneNumber: trimmed(form.mobilePhoneNumber),
              faxPhoneNumber: trimmed(form.faxPhoneNumber),
              emailAddress: trimmed(form.emailAddress),
            },
          ],
        }),
      });
      toast.success("Contact added.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      console.error("[contacts/manual-save]", e);
      toast.error(e instanceof Error ? e.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }, [form, store, onSaved, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>Add a showroom rep by hand.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Jane" />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Smith" />
            </Field>
          </div>

          <Field label="Type">
            <div className="flex flex-wrap gap-1.5">
              {CONTACT_TYPES.filter((t) => t !== "GENERAL_CONTACT").map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("type", t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors ${
                    form.type === t
                      ? "bg-primary/20 text-foreground ring-primary/40"
                      : "bg-muted/40 text-muted-foreground ring-border/40 hover:text-foreground"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Office phone">
              <Input value={form.officePhoneNumber} onChange={(e) => set("officePhoneNumber", e.target.value)} placeholder="(415) 555 - 0100" />
            </Field>
            <Field label="Mobile phone">
              <Input value={form.mobilePhoneNumber} onChange={(e) => set("mobilePhoneNumber", e.target.value)} />
            </Field>
            <Field label="Fax">
              <Input value={form.faxPhoneNumber} onChange={(e) => set("faxPhoneNumber", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.emailAddress} onChange={(e) => set("emailAddress", e.target.value)} placeholder="jane@store.com" />
            </Field>
          </div>

          {/* Store search */}
          <Field label="Showroom (optional)">
            {store ? (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-border/40">
                <span className="text-sm">{store.name}</span>
                <button type="button" onClick={() => setStore(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)} placeholder="Search showrooms…" />
                {storeHits.length > 0 ? (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg bg-popover p-1 ring-1 ring-border/40 shadow-lg">
                    {storeHits.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => { setStore(s); setStoreQuery(""); setStoreHits([]); }}
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                        >
                          <span className="truncate">{s.name}</span>
                          {(s.cityName ?? s.city) ? (
                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">{s.cityName ?? s.city}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />} Save contact
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ContactsPhonebookApp() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<ContactType | "ALL">("ALL");

  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ includeDrafts: "true" });
      if (q.trim()) params.set("q", q.trim());
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      const data = await api<{ contacts: ContactRow[] }>(`/api/showroom-contacts?${params}`);
      setContacts(data.contacts ?? []);
    } catch (e) {
      console.error("[contacts/load]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [q, typeFilter]);

  // Debounced refetch on search/filter change.
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const groups: Group[] = useMemo(() => {
    const byLetter = new Map<string, ContactRow[]>();
    for (const c of contacts) {
      const letter = groupLetter(c);
      const arr = byLetter.get(letter) ?? [];
      arr.push(c);
      byLetter.set(letter, arr);
    }
    return [...byLetter.entries()]
      .map(([letter, list]) => ({
        letter,
        contacts: list.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
  }, [contacts]);

  const present = useMemo(() => new Set(groups.map((g) => g.letter)), [groups]);

  const scrollToLetter = useCallback((letter: string) => {
    sectionRefs.current.get(letter)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Phonebook of showroom reps — call or email in one tap.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
          <ScanLine className="size-3.5" /> Import business cards
        </Button>
      </div>

      {/* Top bar: search + type filter */}
      <div className="mt-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={typeFilter === "ALL"} onClick={() => setTypeFilter("ALL")}>
            All
          </FilterChip>
          {CONTACT_TYPES.map((t) => (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {TYPE_LABEL[t]}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Body + rail */}
      <div className="mt-6 flex gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl bg-card p-10 text-center ring-1 ring-border/40">
              <Phone className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">No contacts yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {q || typeFilter !== "ALL"
                  ? "No contacts match your search."
                  : "Import business cards or add a rep by hand to get started."}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setManualOpen(true)}>
                  Add manually
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
                  <ScanLine className="size-3.5" /> Import cards
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section
                  key={g.letter}
                  ref={(el) => {
                    if (el) sectionRefs.current.set(g.letter, el);
                    else sectionRefs.current.delete(g.letter);
                  }}
                  className="scroll-mt-24"
                >
                  <h2 className="sticky top-16 z-10 -mx-1 mb-2 bg-background/80 px-1 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground backdrop-blur">
                    {g.letter}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {g.contacts.map((c) => (
                      <ContactCard key={c.id} contact={c} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <AzRail present={present} onPick={scrollToLetter} />
      </div>

      <CardImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void load()}
        onManual={() => {
          setImportOpen(false);
          setManualOpen(true);
        }}
      />
      <ManualContactModal open={manualOpen} onOpenChange={setManualOpen} onSaved={() => void load()} />
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
        active
          ? "bg-primary/20 text-foreground ring-primary/40"
          : "bg-muted/40 text-muted-foreground ring-border/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
