/**
 * @fileoverview Services catalog admin page (`/admin/services`).
 *
 * A service is a reusable, named unit of contractor work (e.g. "Demo & haul",
 * "Rough plumbing") with an optional category and default unit cost. Services
 * are the shared vocabulary that invoice line items, contracts, and estimate
 * line items get tied to via the `ServicePicker`, so this page is the source of
 * truth for that vocabulary.
 *
 * CRUD surface (all credentialed, admin-gated):
 *   - GET   /api/services?search=&includeArchived=   → list
 *   - POST  /api/services                            → create
 *   - PATCH /api/services/:id                        → edit (partial)
 *   - POST  /api/services/:id/archive                → soft-archive
 *
 * There is no hard delete: archiving keeps historical ties intact. Archived
 * rows are hidden unless the "Show archived" toggle is on.
 *
 * Filtering: search is server-side (debounced). Sorting is client-side over the
 * fetched page (name / category / cost) — cheap and avoids a round trip.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Loader2, PlusCircle, Pencil, RefreshCw, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ServiceRecord {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  defaultUnitCost: number | null;
  isArchived: boolean;
}

type SortKey = "name" | "category" | "cost";

/** Editable form fields shared by the add + edit dialog. */
interface ServiceForm {
  name: string;
  description: string;
  category: string;
  defaultUnitCost: string;
}

const EMPTY_FORM: ServiceForm = { name: "", description: "", category: "", defaultUnitCost: "" };

function formatCost(value: number | null): string {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function ServicesApp() {
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dialog state — a single dialog handles both create (editing === null) and
  // edit (editing === the record being changed).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Archive confirmation target (AlertDialog — never window.confirm).
  const [archiveTarget, setArchiveTarget] = useState<ServiceRecord | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (includeArchived) params.set("includeArchived", "true");
      try {
        const res = await fetch(`/api/services?${params.toString()}`, { credentials: "include" });
        const json = (await res.json()) as { services?: ServiceRecord[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Failed to load services (${res.status})`);
        setServices(json.services ?? []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load services");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, includeArchived],
  );

  // Debounced reload whenever the search or archived filter changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load({ silent: true }), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...services];
    copy.sort((a, b) => {
      if (sortKey === "cost") {
        // Nulls always sort to the bottom (a -1 fallback would misorder discounts).
        if (a.defaultUnitCost == null && b.defaultUnitCost == null) return a.name.localeCompare(b.name);
        if (a.defaultUnitCost == null) return 1;
        if (b.defaultUnitCost == null) return -1;
        return b.defaultUnitCost - a.defaultUnitCost;
      }
      if (sortKey === "category") {
        return (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [services, sortKey]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(service: ServiceRecord) {
    setEditing(service);
    setForm({
      name: service.name,
      description: service.description ?? "",
      category: service.category ?? "",
      defaultUnitCost: service.defaultUnitCost != null ? String(service.defaultUnitCost) : "",
    });
    setDialogOpen(true);
  }

  const saveForm = useCallback(async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Service name is required");
      return;
    }
    const cost = form.defaultUnitCost.trim() ? Number(form.defaultUnitCost) : null;
    if (cost != null && !Number.isFinite(cost)) {
      toast.error("Default unit cost must be a number");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        defaultUnitCost: cost,
      };
      const res = await fetch(
        editing ? `/api/services/${editing.id}` : "/api/services",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      toast.success(editing ? "Service updated" : "Service created");
      setDialogOpen(false);
      await load({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save service");
    } finally {
      setSaving(false);
    }
  }, [editing, form, load]);

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/services/${archiveTarget.id}/archive`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Archive failed (${res.status})`);
      toast.success("Service archived");
      setArchiveTarget(null);
      await load({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive service");
    } finally {
      setArchiving(false);
    }
  }, [archiveTarget, load]);

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-2xl">Services Catalog</CardTitle>
            <CardDescription>
              The shared list of contractor services. Tie invoice, contract, and estimate line items
              to these entries for consistent cost tracking.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ silent: true })}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <PlusCircle className="mr-2 size-4" />
              Add Service
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services…"
                className="pl-9"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Show archived
            </label>
            <select
              className="rounded-md bg-background px-3 py-2 text-sm ring-1 ring-border/40"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort services"
            >
              <option value="name">Sort: Name</option>
              <option value="category">Sort: Category</option>
              <option value="cost">Sort: Cost (high→low)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading services…
            </div>
          ) : sorted.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {search.trim() ? "No services match your search." : "No services yet."}
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={openCreate}>
                  <PlusCircle className="mr-2 size-4" />
                  Add your first service
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              <div className="grid grid-cols-12 gap-2 bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
                <div className="col-span-5">Name</div>
                <div className="col-span-3">Category</div>
                <div className="col-span-2 text-right">Default cost</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              {sorted.map((service) => (
                <div
                  key={service.id}
                  className="grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm"
                >
                  <div className="col-span-5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{service.name}</span>
                      {service.isArchived && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Archived
                        </Badge>
                      )}
                    </div>
                    {service.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {service.description}
                      </p>
                    )}
                  </div>
                  <div className="col-span-3 truncate text-muted-foreground">
                    {service.category || "—"}
                  </div>
                  <div className="col-span-2 text-right tabular-nums">
                    {formatCost(service.defaultUnitCost)}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5"
                      onClick={() => openEdit(service)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    {!service.isArchived && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setArchiveTarget(service)}
                      >
                        <Archive className="size-3.5" />
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Service" : "Add Service"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the catalog entry. Existing ties keep pointing at this service."
                : "Create a reusable service to tie line items and contracts to."}
            </DialogDescription>
          </DialogHeader>
          {/* Native form → Enter submits (name is required). */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveForm();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="service-name">Name *</Label>
              <Input
                id="service-name"
                autoFocus
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Rough plumbing"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="service-category">Category</Label>
                <Input
                  id="service-category"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Plumbing"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="service-cost">Default unit cost ($)</Label>
                <Input
                  id="service-cost"
                  type="number"
                  step="0.01"
                  value={form.defaultUnitCost}
                  onChange={(e) => setForm((f) => ({ ...f, defaultUnitCost: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="service-description">Description</Label>
              <Textarea
                id="service-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this service…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editing ? "Save changes" : "Create service"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Archive confirmation ──────────────────────────────────────────── */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{archiveTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be hidden from the catalog and pickers. Existing ties are kept. You can show
              archived services with the toggle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={archiving}
              onClick={(e) => {
                e.preventDefault();
                void confirmArchive();
              }}
            >
              {archiving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
