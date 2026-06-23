import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Camera, Wifi, WifiOff, UploadCloud, Loader2, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CardStatus = "draft" | "synced" | "error";

interface ScanCard {
  id: string;
  label: string;
  barcode: string;
  notes: string;
  storeId: string;
  photos: string[]; // base64 data URLs
  status: CardStatus;
}

// ── Minimal IndexedDB store (photos can be large; localStorage is too small) ──
const DB_NAME = "showroom-field-scan";
const STORE = "cards";

// Cache the connection promise so the DB is opened once and reused across all
// operations (upsert fires on every keystroke — a fresh connection per call leaks).
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idbAll(): Promise<ScanCard[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as ScanCard[]);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(card: ScanCard): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(card);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function uid(): string {
  return `card_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function ScanCardView({ card, onChange, onDelete }: { card: ScanCard; onChange: (c: ScanCard) => void; onDelete: () => void }) {
  const set = (patch: Partial<ScanCard>) => onChange({ ...card, ...patch, status: "draft" });

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const urls = await Promise.all([...files].map(fileToDataUrl));
    set({ photos: [...card.photos, ...urls] });
  };

  return (
    <Card className={card.status === "synced" ? "opacity-60" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <Input
            placeholder="Product label (e.g. Brizo faucet)"
            value={card.label}
            onChange={(e) => set({ label: e.target.value })}
            className="h-9 font-medium"
          />
          <div className="flex shrink-0 items-center gap-2">
            {card.status === "synced" ? (
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400"><CheckCircle2 className="mr-1 h-3 w-3" /> Synced</Badge>
            ) : card.status === "error" ? (
              <Badge variant="secondary" className="bg-rose-500/10 text-rose-400">Error</Badge>
            ) : null}
            <button onClick={onDelete} className="text-muted-foreground hover:text-destructive" aria-label="Delete card">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Store ID" value={card.storeId} onChange={(e) => set({ storeId: e.target.value })} className="h-8 text-sm" />
          <Input placeholder="Barcode / SKU" value={card.barcode} onChange={(e) => set({ barcode: e.target.value })} className="h-8 text-sm" />
          <Input placeholder="Notes" value={card.notes} onChange={(e) => set({ notes: e.target.value })} className="h-8 text-sm" />
        </div>

        <div className="flex flex-wrap gap-2">
          {card.photos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p} alt={`photo ${i + 1}`} className="h-16 w-16 rounded-md object-cover" />
              <button
                onClick={() => set({ photos: card.photos.filter((_, j) => j !== i) })}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-muted-foreground shadow hover:text-destructive"
                aria-label="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md bg-muted/40 text-muted-foreground hover:bg-muted/70">
            <Camera className="h-5 w-5" />
            <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

export function FieldScanApp() {
  const [cards, setCards] = useState<ScanCard[]>([]);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    idbAll().then((c) => setCards(c.sort((a, b) => a.id.localeCompare(b.id)))).catch(() => {});
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const upsert = useCallback(async (card: ScanCard) => {
    await idbPut(card);
    setCards((cs) => {
      const exists = cs.some((c) => c.id === card.id);
      return exists ? cs.map((c) => (c.id === card.id ? card : c)) : [...cs, card];
    });
  }, []);

  const addCard = () =>
    upsert({ id: uid(), label: "", barcode: "", notes: "", storeId: "", photos: [], status: "draft" });

  const deleteCard = async (id: string) => {
    await idbDelete(id);
    setCards((cs) => cs.filter((c) => c.id !== id));
  };

  const pending = cards.filter((c) => c.status !== "synced");

  const syncAll = async () => {
    const toSync = cards.filter((c) => c.status !== "synced");
    if (toSync.length === 0) return;
    if (
      toSync.some((c) => {
        const id = Number.parseInt(c.storeId, 10);
        return !Number.isFinite(id) || id <= 0;
      })
    ) {
      toast.error("Every card needs a valid positive integer Store ID before syncing");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/showroom-stores/scan/batch-sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runResearch: true,
          cards: toSync.map((c) => ({
            label: c.label || null,
            barcode: c.barcode || null,
            notes: c.notes || null,
            storeId: Number.parseInt(c.storeId, 10),
            photos: c.photos,
          })),
        }),
      });
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(p.error ?? `Sync failed (${res.status})`);
      }
      for (const c of toSync) await idbPut({ ...c, status: "synced" });
      setCards((cs) => cs.map((c) => (c.status !== "synced" ? { ...c, status: "synced" } : c)));
      toast.success(`Synced ${toSync.length} product${toSync.length === 1 ? "" : "s"} — research queued`);
    } catch (e) {
      for (const c of toSync) {
        await idbPut({ ...c, status: "error" }).catch(() => {});
      }
      setCards((cs) => cs.map((c) => (c.status !== "synced" ? { ...c, status: "error" } : c)));
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Field Scan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture products at the showroom — one card per product. Works offline; sync from the store or later at home.
          </p>
        </div>
        <Badge variant="outline" className={online ? "text-emerald-400" : "text-amber-400"}>
          {online ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
          {online ? "Online" : "Offline — queued locally"}
        </Badge>
      </div>

      <div className="mb-5 flex items-center gap-2">
        <Button size="sm" onClick={addCard}>
          <Plus className="h-4 w-4" /> Add product card
        </Button>
        <Button size="sm" variant="outline" onClick={syncAll} disabled={syncing || !online || pending.length === 0}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />} Sync {pending.length > 0 ? `(${pending.length})` : ""}
        </Button>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No captures yet. Add a product card and snap its photos.</p>
            <Button size="sm" onClick={addCard}><Plus className="h-4 w-4" /> Add product card</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => (
            <ScanCardView key={c.id} card={c} onChange={upsert} onDelete={() => deleteCard(c.id)} />
          ))}
        </div>
      )}
    </main>
  );
}
