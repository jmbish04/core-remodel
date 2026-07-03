/**
 * @fileoverview BrandTypesAdminApp — CRUD management for brand_types_def.
 *
 * A management table over `/api/brands/types`:
 *   - list all brand types (name, description, active state, created date)
 *   - create (dialog)
 *   - edit (dialog)
 *   - toggle isActive inline (PUT)
 *   - delete (AlertDialog confirm — never window.confirm)
 *
 * Monolith dark: no 1px borders (ring-1 ring-border/40, bg-card,
 * divide-y divide-border/40), sort + search, loading/empty/error states,
 * sonner toasts, no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandType {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string | null;
}

type SortKey = "name" | "createdAt";
type SortDir = "asc" | "desc";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ─── Type Editor Dialog (create + edit) ──────────────────────────────────────

interface EditorState {
  name: string;
  description: string;
  isActive: boolean;
}

const EMPTY_EDITOR: EditorState = { name: "", description: "", isActive: true };

function TypeEditorDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: BrandType | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditorState>({ ...EMPTY_EDITOR });
  const [submitting, setSubmitting] = useState(false);

  // Sync form when the dialog opens for a new target.
  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name,
              description: editing.description ?? "",
              isActive: editing.isActive,
            }
          : { ...EMPTY_EDITOR },
      );
    }
  }, [open, editing]);

  const update = (patch: Partial<EditorState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Type name is required");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiJson<{ type: BrandType }>(`/api/brands/types/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            isActive: form.isActive,
          }),
        });
        toast.success(`"${form.name.trim()}" updated`);
      } else {
        await apiJson<{ type: BrandType }>("/api/brands/types", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            isActive: form.isActive,
          }),
        });
        toast.success(`"${form.name.trim()}" created`);
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save type");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Brand Type" : "New Brand Type"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this brand type definition."
              : "Define a brand type (e.g. plumbing, lighting, tile)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="bt-name">Name *</Label>
            <Input
              id="bt-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Plumbing"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="bt-desc">Description</Label>
            <Textarea
              id="bt-desc"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Optional — what brands of this type supply."
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2 ring-1 ring-border/40">
            <div>
              <Label htmlFor="bt-active" className="cursor-pointer">
                Active
              </Label>
              <p className="text-xs text-muted-foreground">
                Inactive types are hidden from brand type pickers.
              </p>
            </div>
            <Switch
              id="bt-active"
              checked={form.isActive}
              onCheckedChange={(v) => update({ isActive: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
            {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {editing ? "Save Changes" : "Create Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteTypeDialog({
  target,
  onOpenChange,
  onDeleted,
}: {
  target: BrandType | null;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await apiJson<{ success: true }>(`/api/brands/types/${target.id}`, { method: "DELETE" });
      toast.success(`"${target.name}" deleted`);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete type");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{target?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the brand type definition. Brands mapped to it will lose this type badge.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function BrandTypesAdminApp() {
  const [types, setTypes] = useState<BrandType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeOnly, setActiveOnly] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BrandType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandType | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<{ types: BrandType[] }>("/api/brands/types");
      setTypes(data.types ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load brand types";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTypes();
  }, [fetchTypes]);

  const toggleActive = async (t: BrandType) => {
    setTogglingId(t.id);
    // Optimistic update.
    setTypes((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, isActive: !x.isActive } : x)),
    );
    try {
      await apiJson<{ type: BrandType }>(`/api/brands/types/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      toast.success(`"${t.name}" ${!t.isActive ? "activated" : "deactivated"}`);
    } catch (e) {
      // Roll back.
      setTypes((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, isActive: t.isActive } : x)),
      );
      toast.error(e instanceof Error ? e.message : "Failed to toggle active state");
    } finally {
      setTogglingId(null);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = types.filter((t) => {
      if (activeOnly && !t.isActive) return false;
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !(t.description ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [types, search, activeOnly, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (t: BrandType) => {
    setEditing(t);
    setEditorOpen(true);
  };

  const activeCount = useMemo(() => types.filter((t) => t.isActive).length, [types]);

  const SortHeader = ({ label, keyName }: { label: string; keyName: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(keyName)}
      className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition hover:text-foreground"
    >
      {label}
      {sortKey === keyName &&
        (sortDir === "asc" ? (
          <ArrowUpAZ className="size-3" />
        ) : (
          <ArrowDownAZ className="size-3" />
        ))}
    </button>
  );

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tag className="size-5 text-muted-foreground" />
            Brand Types
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define brand type categories (plumbing, lighting, tile, …) used to tag brands.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-3.5" />
          New Type
        </Button>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div className="mb-4 flex flex-wrap gap-4 rounded-lg bg-card p-3 text-xs ring-1 ring-border/40">
          <div>
            <span className="text-muted-foreground">Total</span>
            <span className="ml-1.5 font-semibold text-foreground">{types.length}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Active</span>
            <span className="ml-1.5 font-semibold text-emerald-400">{activeCount}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Inactive</span>
            <span className="ml-1.5 font-semibold text-foreground">
              {types.length - activeCount}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search brand types…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          size="sm"
          variant={activeOnly ? "default" : "outline"}
          onClick={() => setActiveOnly((v) => !v)}
          className="h-9 shrink-0 text-xs"
        >
          Active only
        </Button>
        {(search || activeOnly) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setActiveOnly(false);
            }}
            className="h-9 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void fetchTypes()}>
            <RotateCcw className="mr-1.5 size-3.5" />
            Retry
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">
            {types.length === 0
              ? "No brand types yet. Create your first one."
              : "No brand types match your filters."}
          </p>
          {types.length === 0 && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 size-3.5" />
              New Type
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
          {/* Table header (hidden on mobile — cards stack) */}
          <div className="hidden grid-cols-[1.5fr_2fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 sm:grid">
            <SortHeader label="Name" keyName="name" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Description
            </span>
            <SortHeader label="Created" keyName="createdAt" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active
            </span>
            <span className="sr-only">Actions</span>
          </div>

          <div className="divide-y divide-border/40">
            {visible.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-1 items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[1.5fr_2fr_auto_auto_auto] sm:gap-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  {!t.isActive && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[9px] font-normal text-muted-foreground"
                    >
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="line-clamp-2 text-sm text-muted-foreground">
                  {t.description || <span className="text-muted-foreground/50">—</span>}
                </div>
                <div className="text-xs text-muted-foreground sm:text-right">
                  <span className="sm:hidden">Created: </span>
                  {fmtDate(t.createdAt)}
                </div>
                <div className="flex items-center gap-2 sm:justify-center">
                  <Switch
                    checked={t.isActive}
                    disabled={togglingId === t.id}
                    onCheckedChange={() => void toggleActive(t)}
                    aria-label={`Toggle ${t.name} active`}
                  />
                  {togglingId === t.id && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center gap-1 sm:justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(t)}
                    aria-label={`Edit ${t.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-rose-400"
                    onClick={() => setDeleteTarget(t)}
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TypeEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        onSaved={fetchTypes}
      />
      <DeleteTypeDialog
        target={deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        onDeleted={fetchTypes}
      />
    </main>
  );
}
