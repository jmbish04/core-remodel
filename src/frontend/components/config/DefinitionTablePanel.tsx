import * as React from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/components/products";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ComboboxWithOther, type ComboboxOption } from "@/components/ui/combobox-with-other";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** A column the panel can render. `name` is always present; the others opt-in. */
type Column = "name" | "description" | "hex";

/** Minimal shape every definition row shares. Extra keys (categoryId, …) pass through. */
interface DefRow {
  id: number | string;
  name: string;
  description?: string | null;
  hexCode?: string | null;
  isActive?: boolean;
  categoryId?: number | string | null;
  [k: string]: unknown;
}

export interface DefinitionTablePanelProps {
  title: string;
  description?: string;
  /** Definition-table base endpoint, e.g. "/api/config/colors". */
  endpoint: string;
  /** Which columns to render. `name` is implied; include "description"/"hex" as needed. */
  columns: Column[];
  /**
   * When true, renders a category selector: rows are loaded filtered by the
   * selected category (`?categoryId=`) and creates carry that categoryId.
   * Categories come from `/api/config/categories`.
   */
  withCategoryFilter?: boolean;
}

interface DraftState {
  name: string;
  description: string;
  hexCode: string;
}

const EMPTY_DRAFT: DraftState = { name: "", description: "", hexCode: "#888888" };

/**
 * Generic CRUD panel for a definition/vocabulary table: lists active rows, adds
 * (dialog), inline-edits, and soft-deactivates (PATCH isActive:false → drops from
 * the list). The reusable primitive every `/config/*` page mounts inside a
 * `<ConfigShell>`. Monolith dark, ring separators (no 1px borders), sonner toasts.
 */
export function DefinitionTablePanel({
  title,
  description,
  endpoint,
  columns,
  withCategoryFilter,
}: DefinitionTablePanelProps) {
  const hasHex = columns.includes("hex");
  const hasDescription = columns.includes("description");

  const [rows, setRows] = React.useState<DefRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Category filter (subcategories).
  const [categories, setCategories] = React.useState<ComboboxOption[]>([]);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);

  // Add / edit dialog.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DefRow | null>(null);
  const [draft, setDraft] = React.useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = React.useState(false);

  const listUrl = React.useCallback(() => {
    if (withCategoryFilter && categoryId) return `${endpoint}?categoryId=${encodeURIComponent(categoryId)}`;
    return endpoint;
  }, [endpoint, withCategoryFilter, categoryId]);

  const load = React.useCallback(async () => {
    // Subcategories need a category selected first.
    if (withCategoryFilter && !categoryId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api<DefRow[]>(listUrl());
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [listUrl, withCategoryFilter, categoryId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Load categories for the filter once.
  React.useEffect(() => {
    if (!withCategoryFilter) return;
    void (async () => {
      try {
        const cats = await api<DefRow[]>("/api/config/categories");
        setCategories(cats.map((c) => ({ value: String(c.id), label: c.name })));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load categories");
      }
    })();
  }, [withCategoryFilter]);

  function openAdd() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(row: DefRow) {
    setEditing(row);
    setDraft({
      name: row.name,
      description: row.description ?? "",
      hexCode: row.hexCode ?? EMPTY_DRAFT.hexCode,
    });
    setDialogOpen(true);
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name };
      if (hasDescription) body.description = draft.description.trim() || null;
      if (hasHex) body.hexCode = draft.hexCode;
      if (!editing && withCategoryFilter) body.categoryId = categoryId;

      if (editing) {
        const updated = await api<DefRow>(`${endpoint}/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setRows((prev) => prev.map((r) => (r.id === editing.id ? updated : r)));
        toast.success("Saved");
      } else {
        const created = await api<DefRow>(endpoint, {
          method: "POST",
          body: JSON.stringify(body),
        });
        setRows((prev) => [...prev, created]);
        toast.success("Added");
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(row: DefRow) {
    try {
      await api(`${endpoint}/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Deactivated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to deactivate");
    }
  }

  const colCount = 1 + (hasHex ? 1 : 0) + (hasDescription ? 1 : 0) + 1;
  const addDisabled = withCategoryFilter && !categoryId;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" onClick={openAdd} disabled={addDisabled}>
          <Plus className="mr-1.5 size-4" />
          Add
        </Button>
      </div>

      {withCategoryFilter && (
        <div className="max-w-xs">
          <Label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
            Category
          </Label>
          <ComboboxWithOther
            options={categories}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Select a category…"
            aria-label="Filter by category"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="divide-x divide-border/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              {hasHex && <th className="px-4 py-2.5 font-medium">Color</th>}
              {hasDescription && <th className="px-4 py-2.5 font-medium">Description</th>}
              <th className="w-px px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {loading && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && addDisabled && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Select a category to view its sub-categories.
                </td>
              </tr>
            )}
            {!loading && !addDisabled && error && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-destructive">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !addDisabled && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing here yet. Click “Add” to create the first entry.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((row) => (
                <tr key={String(row.id)} className="group">
                  <td className="px-4 py-2.5 font-medium text-foreground">{row.name}</td>
                  {hasHex && (
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="inline-block size-4 rounded ring-1 ring-border/60"
                          style={{ backgroundColor: row.hexCode ?? "transparent" }}
                        />
                        {row.hexCode ?? "—"}
                      </span>
                    </td>
                  )}
                  {hasDescription && (
                    <td className="px-4 py-2.5 text-muted-foreground">{row.description || "—"}</td>
                  )}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                        aria-label={`Edit ${row.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void deactivate(row)}
                      >
                        Deactivate
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : `Add to ${title}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="def-name" className="mb-1.5 block">
                Name
              </Label>
              <Input
                id="def-name"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name"
              />
            </div>
            {hasHex && (
              <div>
                <Label htmlFor="def-hex" className="mb-1.5 block">
                  Color
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="def-hex"
                    type="color"
                    value={draft.hexCode}
                    onChange={(e) => setDraft((d) => ({ ...d, hexCode: e.target.value }))}
                    className="size-9 shrink-0 cursor-pointer rounded bg-transparent ring-1 ring-border/40"
                    aria-label="Pick color"
                  />
                  <Input
                    value={draft.hexCode}
                    onChange={(e) => setDraft((d) => ({ ...d, hexCode: e.target.value }))}
                    placeholder="#888888"
                    className="font-mono"
                  />
                </div>
              </div>
            )}
            {hasDescription && (
              <div>
                <Label htmlFor="def-desc" className="mb-1.5 block">
                  Description
                  <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="def-desc"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Short description"
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
