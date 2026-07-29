import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Search, Loader2, FlaskConical, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GapPanel } from "@/components/showroom/GapPanel";
import { RoomSelect } from "@/components/ui/room-select";

interface Material {
  id: number;
  title: string;
  roomId: number;
  roomName: string | null;
  notes: string | null;
  isPurchased: boolean | null;
  isReturned: boolean | null;
  isActive: boolean | null;
  productId: number | null;
}

interface RequiredSpec {
  id: number;
  materialId: number;
  key: string;
  value: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  return payload as T;
}

function RoomBadge({ room }: { room: string | null }) {
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {room?.trim() || "Unassigned"}
    </Badge>
  );
}

function SpecsEditor({ materialId }: { materialId: number }) {
  const [specs, setSpecs] = useState<RequiredSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ specs: RequiredSpec[] }>(`/api/materials/${materialId}/specs`);
      setSpecs(data.specs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load specs");
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    load();
  }, [load]);

  const addSpec = async () => {
    if (!key.trim() || !value.trim()) return;
    try {
      const data = await api<{ spec: RequiredSpec }>(`/api/materials/${materialId}/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value: value.trim() }),
      });
      setSpecs((s) => [...s, data.spec]);
      setKey("");
      setValue("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add spec");
    }
  };

  const deleteSpec = async (sid: number) => {
    try {
      await api(`/api/materials/${materialId}/specs/${sid}`, { method: "DELETE" });
      setSpecs((s) => s.filter((x) => x.id !== sid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete spec");
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Required specs</h4>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading specs…</p>
      ) : specs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No required specs yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {specs.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                <span className="text-muted-foreground">{s.key}:</span> <span className="font-medium">{s.value}</span>
              </span>
              <button
                onClick={() => deleteSpec(s.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete spec"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input placeholder="Spec (e.g. Burner Zones)" value={key} onChange={(e) => setKey(e.target.value)} className="h-8 text-sm" />
        <Input placeholder="Value (e.g. 4)" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-sm" />
        <Button size="sm" variant="outline" onClick={addSpec} className="h-8 shrink-0">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

function MaterialCard({ material, onChange, onDelete }: { material: Material; onChange: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);

  const togglePurchased = async () => {
    try {
      await api(`/api/materials/${material.id}/purchased`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPurchased: !material.isPurchased, productId: material.productId }),
      });
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const remove = async () => {
    try {
      await api(`/api/materials/${material.id}`, { method: "DELETE" });
      toast.success("Material deleted");
      onDelete();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button onClick={() => setOpen((o) => !o)} className="flex items-start gap-2 text-left">
            {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
            <span>
              <span className="font-medium">{material.title}</span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            {material.isPurchased ? (
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 font-mono text-[10px] uppercase tracking-widest">
                <ShoppingBag className="mr-1 h-3 w-3" /> Purchased
              </Badge>
            ) : null}
            <RoomBadge room={material.roomName} />
          </div>
        </div>

        {open ? (
          <div className="mt-4 space-y-4 pl-6">
            {material.notes ? <p className="text-sm text-muted-foreground">{material.notes}</p> : null}
            <SpecsEditor materialId={material.id} />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.info("Gap-research hand-off arrives in Phase 2")}
              >
                <FlaskConical className="h-3.5 w-3.5" /> Research this
              </Button>
              <Button size="sm" variant="outline" onClick={togglePurchased}>
                <ShoppingBag className="h-3.5 w-3.5" /> {material.isPurchased ? "Mark unpurchased" : "Mark purchased"}
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} className="text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddMaterialDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    roomId: number | null;
    notes: string;
  }>({ title: "", roomId: null, notes: "" });

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (form.roomId == null) {
      toast.error("Room is required");
      return;
    }
    setSaving(true);
    try {
      await api("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          roomId: form.roomId,
          notes: form.notes.trim() || null,
        }),
      });
      toast.success("Material added");
      setForm({ title: "", roomId: null, notes: "" });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add material");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="h-4 w-4" /> Add material
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add material</DialogTitle>
          <DialogDescription>A line item to source for the renovation (e.g. "Induction cooktop").</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Title</Label>
            <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Induction cooktop" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-room">Room</Label>
              <RoomSelect value={form.roomId} onChange={(roomId) => setForm({ ...form, roomId })} placeholder="Select a room" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-notes">Notes</Label>
            <Input id="m-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="(optional)" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterialsScheduleApp() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [purchasedFilter, setPurchasedFilter] = useState<"all" | "open" | "purchased">("all");

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (purchasedFilter === "purchased") params.set("purchased", "true");
      if (purchasedFilter === "open") params.set("purchased", "false");
      const data = await api<{ materials: Material[] }>(`/api/materials?${params.toString()}`);
      setMaterials(data.materials);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      setLoading(false);
    }
  }, [search, purchasedFilter]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const grouped = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of materials) {
      const room = m.roomName?.trim() || "Unassigned";
      map.set(room, [...(map.get(room) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  const purchasedCount = materials.filter((m) => m.isPurchased).length;
  const roomCount = new Set(materials.map((m) => m.roomName?.trim() || "Unassigned")).size;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Materials Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The master list of materials to source. Seeds showroom discovery, sourcing, and deep research.
          </p>
        </div>
        <AddMaterialDialog onCreated={fetchMaterials} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: "Materials", value: materials.length },
          { label: "Purchased", value: purchasedCount },
          { label: "Rooms", value: roomCount },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-md bg-muted/40 p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{kpi.label}</div>
            <div className="mt-1 font-mono text-2xl tabular-nums">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search materials…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "open", "purchased"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={purchasedFilter === f ? "default" : "outline"}
              onClick={() => setPurchasedFilter(f)}
              className="capitalize"
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : materials.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No materials yet. Add your first line item to start sourcing.</p>
            <AddMaterialDialog onCreated={fetchMaterials} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([room, items]) => (
            <div key={room} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{room}</h2>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((m) => (
                  <MaterialCard key={m.id} material={m} onChange={fetchMaterials} onDelete={fetchMaterials} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <GapPanel context="material" onChanged={fetchMaterials} />
      </div>
    </main>
  );
}
