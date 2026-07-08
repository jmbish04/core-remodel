/**
 * @fileoverview ManagePocsSection — list, add, edit, and delete POCs for a showroom.
 *
 * Displays existing contacts in a compact card layout with edit/delete actions.
 * "Add Contact" opens an inline form with the same fields as the visit-capture
 * POC form but decoupled from the visit flow.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Mail,
  Phone,
  Plus,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Poc {
  id: number;
  showroomId: number;
  fullName: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  businessCardFrontUrl: string | null;
  businessCardBackUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ManagePocsSectionProps {
  storeId: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  fullName: "",
  title: "",
  company: "",
  phone: "",
  email: "",
  website: "",
  address: "",
};

export function ManagePocsSection({ storeId }: ManagePocsSectionProps) {
  const [pocs, setPocs] = useState<Poc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadPocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/pocs`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { pocs: Poc[] };
      setPocs(data.pocs);
    } catch (err) {
      console.error("[ManagePocsSection] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void loadPocs(); }, [loadPocs]);

  const set = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openAddForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (poc: Poc) => {
    setEditingId(poc.id);
    setForm({
      fullName: poc.fullName ?? "",
      title: poc.title ?? "",
      company: poc.company ?? "",
      phone: poc.phone ?? "",
      email: poc.email ?? "",
      website: poc.website ?? "",
      address: poc.address ?? "",
    });
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!form.fullName.trim() && !form.email.trim() && !form.phone.trim()) {
      toast.error("At least a name, email, or phone is required.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(form)) {
        body[k] = v.trim() || null;
      }

      const url = editingId
        ? `/api/showroom-stores/${storeId}/pocs/${editingId}`
        : `/api/showroom-stores/${storeId}/pocs`;

      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);

      toast.success(editingId ? "Contact updated." : "Contact added.");
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      void loadPocs();
    } catch (err) {
      console.error("[ManagePocsSection] save error:", err);
      toast.error("Failed to save contact.");
    } finally {
      setSaving(false);
    }
  }, [form, editingId, storeId, loadPocs]);

  const handleDelete = useCallback(async (pocId: number) => {
    setDeletingId(pocId);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/pocs/${pocId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Contact removed.");
      void loadPocs();
    } catch (err) {
      console.error("[ManagePocsSection] delete error:", err);
      toast.error("Failed to remove contact.");
    } finally {
      setDeletingId(null);
    }
  }, [storeId, loadPocs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Points of Contact</h3>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={openAddForm}>
          <Plus className="mr-1 size-3" /> Add Contact
        </Button>
      </div>

      {/* Existing POCs */}
      {pocs.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground/70 italic">No contacts recorded yet.</p>
      )}

      {pocs.map((poc) => (
        <div
          key={poc.id}
          className="group flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-medium">
              {poc.fullName || <span className="italic text-muted-foreground">Unknown</span>}
              {poc.title && (
                <span className="ml-1.5 text-xs text-muted-foreground">· {poc.title}</span>
              )}
            </p>
            {poc.company && (
              <p className="text-xs text-muted-foreground">{poc.company}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
              {poc.phone && (
                <a href={`tel:${poc.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Phone className="size-3" /> {poc.phone}
                </a>
              )}
              {poc.email && (
                <a href={`mailto:${poc.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Mail className="size-3" /> {poc.email}
                </a>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => openEditForm(poc)}
              title="Edit contact"
            >
              <User className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-destructive hover:text-destructive"
              onClick={() => void handleDelete(poc.id)}
              disabled={deletingId === poc.id}
              title="Remove contact"
            >
              {deletingId === poc.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </Button>
          </div>
        </div>
      ))}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {editingId ? "Edit Contact" : "New Contact"}
            </h4>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(EMPTY_FORM) as (keyof typeof EMPTY_FORM)[]).map((key) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs text-muted-foreground capitalize">
                  {key.replace(/([A-Z])/g, " $1").trim()}
                </Label>
                <Input
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={key === "fullName" ? "Jane Smith" : undefined}
                  className="text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
              {editingId ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
