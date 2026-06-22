/**
 * @fileoverview MeasurementsApp — admin data-entry surface for the master
 * measurements database (0006 Phase 1).
 *
 * Renders every `measurements` row grouped by room, then by element type, with
 * source / approximate badges, a search + room/element/source filter bar, and
 * add / edit / delete via shadcn dialogs (no window.confirm/alert).  Room labels
 * and grouping order come from the `/api/rooms/catalog` endpoint (the canonical
 * room source, active rooms only); measurement CRUD goes through `/api/measurements`.
 *
 * Filtering is applied server-side (the API accepts roomId / elementType / source /
 * q), debounced so typing in the search box doesn't fire a request per keystroke.
 */

import * as React from "react";
import { Loader2, Plus, Ruler, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoomSelect } from "@/components/ui/room-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnitToggle } from "@/components/ui/unit-toggle";

import { MeasurementFormDialog } from "./measurements/MeasurementFormDialog";
import { MeasurementTable, type RoomGroup } from "./measurements/MeasurementTable";
import {
  ELEMENT_TYPE_OPTIONS,
  SOURCE_OPTIONS,
  elementTypeLabel,
  type Measurement,
  type MeasurementInput,
} from "./measurements/measurement-types";

// ── Catalog shapes (subset of /api/rooms/catalog) ──────────────────────────
interface CatalogRoom {
  id: number;
  roomName?: string | null;
  displayName?: string | null;
}
interface CatalogFloor {
  id: number;
  name: string;
  levelOrder?: number | null;
  rooms?: CatalogRoom[] | null;
}

const FILTER_ALL = "all";

export function MeasurementsApp() {
  const [measurements, setMeasurements] = React.useState<Measurement[]>([]);
  const [catalog, setCatalog] = React.useState<CatalogFloor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [search, setSearch] = React.useState("");
  const [roomFilter, setRoomFilter] = React.useState<number | null>(null);
  const [elementTypeFilter, setElementTypeFilter] = React.useState<string>(FILTER_ALL);
  const [sourceFilter, setSourceFilter] = React.useState<string>(FILTER_ALL);

  // Add / edit dialog
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Measurement | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = React.useState<Measurement | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────
  const fetchMeasurements = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (roomFilter != null) params.set("roomId", String(roomFilter));
      if (elementTypeFilter !== FILTER_ALL) params.set("elementType", elementTypeFilter);
      if (sourceFilter !== FILTER_ALL) params.set("source", sourceFilter);
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", "1000");
      const res = await fetch(`/api/measurements?${params.toString()}`);
      const data = (await res.json()) as { measurements?: Measurement[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMeasurements(data.measurements ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load measurements");
    } finally {
      setLoading(false);
    }
  }, [roomFilter, elementTypeFilter, sourceFilter, search]);

  // Debounce all filter changes (notably search keystrokes).
  React.useEffect(() => {
    const t = setTimeout(() => {
      void fetchMeasurements();
    }, 200);
    return () => clearTimeout(t);
  }, [fetchMeasurements]);

  const loadCatalog = React.useCallback(async () => {
    try {
      const res = await fetch("/api/rooms/catalog", { credentials: "include" });
      const data = (await res.json()) as { floors?: CatalogFloor[] };
      if (res.ok && Array.isArray(data.floors)) setCatalog(data.floors);
    } catch {
      // Non-critical: grouping falls back to "Room <id>" labels.
    }
  }, []);

  React.useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // ── Derived: room metadata + grouped rows ──────────────────────────────────
  const roomMeta = React.useMemo(() => {
    const map = new Map<number, { name: string; floorName: string; floorOrder: number }>();
    for (const floor of catalog) {
      for (const room of floor.rooms ?? []) {
        map.set(room.id, {
          name: room.displayName?.trim() || room.roomName?.trim() || `Room ${room.id}`,
          floorName: floor.name,
          floorOrder: floor.levelOrder ?? 0,
        });
      }
    }
    return map;
  }, [catalog]);

  const groups = React.useMemo<RoomGroup[]>(() => {
    const byRoom = new Map<string, RoomGroup>();
    for (const m of measurements) {
      const key = m.roomId == null ? "house" : `room-${m.roomId}`;
      let group = byRoom.get(key);
      if (!group) {
        if (m.roomId == null) {
          group = {
            key,
            title: "House-wide / Unassigned",
            subtitle: "Not tied to a single room",
            // Sort last.
            sortKey: "zzzz",
            items: [],
          };
        } else {
          const meta = roomMeta.get(m.roomId);
          const floorOrder = String(meta?.floorOrder ?? 99).padStart(2, "0");
          group = {
            key,
            title: meta?.name ?? `Room ${m.roomId}`,
            subtitle: meta?.floorName ?? "",
            sortKey: `${floorOrder}-${meta?.name ?? `Room ${m.roomId}`}`,
            items: [],
          };
        }
        byRoom.set(key, group);
      }
      group.items.push(m);
    }
    return Array.from(byRoom.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [measurements, roomMeta]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleSubmit = React.useCallback(
    async (input: MeasurementInput): Promise<boolean> => {
      try {
        const url = editing ? `/api/measurements/${editing.id}` : "/api/measurements";
        const res = await fetch(url, {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        toast.success(editing ? "Measurement updated" : "Measurement added");
        await fetchMeasurements();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
        return false;
      }
    },
    [editing, fetchMeasurements],
  );

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/measurements/${deleteTarget.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Measurement deleted");
      setDeleteTarget(null);
      await fetchMeasurements();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchMeasurements]);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (m: Measurement) => {
    setEditing(m);
    setFormOpen(true);
  };

  const isEmpty = !loading && !error && measurements.length === 0;
  const hasFilters =
    search.trim() !== "" ||
    roomFilter != null ||
    elementTypeFilter !== FILTER_ALL ||
    sourceFilter !== FILTER_ALL;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Measurements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Exact, as-is dimensions for the whole house — measure twice, order once; ready for material takeoffs, quotes &amp; designers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UnitToggle />
          <Button onClick={openAdd}>
            <Plus className="mr-2 size-4" />
            Add measurement
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="ring-1 ring-border/40">
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search label, notes, type…"
              className="pl-8"
              aria-label="Search measurements"
            />
          </div>

          <div className="w-44">
            <RoomSelect
              value={roomFilter}
              onChange={setRoomFilter}
              includeAllOption
              allOptionLabel="All rooms"
              placeholder="All rooms"
              aria-label="Filter by room"
            />
          </div>

          <Select
            value={elementTypeFilter}
            onValueChange={(v) => setElementTypeFilter(v ?? FILTER_ALL)}
          >
            <SelectTrigger className="w-44" aria-label="Filter by element type">
              <SelectValue
                items={[{ value: FILTER_ALL, label: "All elements" }, ...ELEMENT_TYPE_OPTIONS]}
                placeholder="Element type"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>All elements</SelectItem>
              {ELEMENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v ?? FILTER_ALL)}>
            <SelectTrigger className="w-44" aria-label="Filter by source">
              <SelectValue
                items={[{ value: FILTER_ALL, label: "All sources" }, ...SOURCE_OPTIONS]}
                placeholder="Source"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>All sources</SelectItem>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="ml-auto text-xs text-muted-foreground">{measurements.length} measurement{measurements.length === 1 ? "" : "s"}</span>
        </CardContent>
      </Card>

      {/* Body */}
      {error ? (
        <Card className="ring-1 ring-destructive/30">
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchMeasurements()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex min-h-[30svh] items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Loading measurements…
        </div>
      ) : isEmpty ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Ruler className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {hasFilters ? "No measurements match these filters" : "No measurements yet"}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasFilters
                  ? "Try clearing the search or filters."
                  : "Add the first measurement to start building the master record."}
              </p>
            </div>
            {!hasFilters && (
              <Button onClick={openAdd}>
                <Plus className="mr-2 size-4" />
                Add measurement
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <MeasurementTable groups={groups} onEdit={openEdit} onDelete={setDeleteTarget} />
      )}

      {/* Add / edit dialog */}
      <MeasurementFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        measurement={editing}
        onSubmit={handleSubmit}
      />

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete measurement?</DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.label || (deleteTarget ? elementTypeLabel(deleteTarget.elementType) : "")}
              </span>
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
