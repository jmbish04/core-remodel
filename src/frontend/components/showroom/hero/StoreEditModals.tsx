/**
 * @fileoverview StoreEditModals — correction affordances for an existing store.
 *
 * Three dialogs opened from the store viewport hero when intake got a field
 * wrong, left it blank, or the store moved:
 *
 *   - EditHoursModal    reuses the intake HoursEditor over `hoursJson`;
 *                       PUT /api/showroom-stores/:id/hours.
 *   - EditAddressModal  the split + full address + maps link fields;
 *                       PUT /api/showroom-stores/:id/address (only sent fields update).
 *   - ManageLinksModal  CRUD list of the store's web/social links against
 *                       GET/POST/PUT/DELETE /api/showroom-stores/:id/links.
 *
 * Monolith-dark, shadcn Dialog (Base UI — dismissal is blocked while a mutation
 * is in flight via the controlled onOpenChange guard, not Radix props).
 */

import { useCallback, useEffect, useState } from "react";
import { Clock, Globe, Link2, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { HoursEditor } from "../intake/HoursEditor";
import type { HoursJson } from "../intake/hours-types";
import {
  LINK_TYPES,
  LINK_TYPE_LABELS,
  asLinkType,
  type LinkType,
} from "../intake/LinksField";

// ─── Edit hours ───────────────────────────────────────────────────────────────

export function EditHoursModal({
  storeId,
  hoursJson,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: number;
  hoursJson: HoursJson | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<HoursJson | null>(hoursJson);
  const [saving, setSaving] = useState(false);

  // Re-seed from the store whenever the modal (re)opens.
  useEffect(() => {
    if (open) setDraft(hoursJson);
  }, [open, hoursJson]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/hours`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursJson: draft }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to save hours (${res.status})`);
      }
      toast.success("Hours updated.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error("[EditHoursModal] save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to update hours");
    } finally {
      setSaving(false);
    }
  }, [storeId, draft, onSaved, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4" /> Edit hours
          </DialogTitle>
          <DialogDescription>
            Correct the weekly hours — toggle days off, or set custom times.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <HoursEditor value={draft} onChange={setDraft} />
        </div>
        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save hours
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit address ─────────────────────────────────────────────────────────────

export interface EditableAddress {
  locationStreetNumber: string | null;
  locationStreetName: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationZipCode: string | null;
  locationAddress: string | null;
  googleMapsLink: string | null;
}

const ADDRESS_FIELDS: {
  key: keyof EditableAddress;
  label: string;
  placeholder: string;
  wide?: boolean;
}[] = [
  { key: "locationStreetNumber", label: "Street number", placeholder: "123" },
  { key: "locationStreetName", label: "Street name", placeholder: "Design St" },
  { key: "locationCity", label: "City", placeholder: "San Francisco" },
  { key: "locationState", label: "State", placeholder: "CA" },
  { key: "locationZipCode", label: "ZIP code", placeholder: "94103" },
  { key: "locationAddress", label: "Full address", placeholder: "123 Design St, San Francisco, CA 94103", wide: true },
  { key: "googleMapsLink", label: "Google Maps link", placeholder: "https://maps.google.com/…", wide: true },
];

export function EditAddressModal({
  storeId,
  address,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: number;
  address: EditableAddress;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const seed: Record<string, string> = {};
    for (const f of ADDRESS_FIELDS) seed[f.key] = address[f.key] ?? "";
    setForm(seed);
  }, [open, address]);

  const set = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // Send every managed field; empty string → null. Unchanged fields simply
      // re-send their current value (the endpoint only updates sent fields).
      const body: Record<string, string | null> = {};
      for (const f of ADDRESS_FIELDS) {
        const val = (form[f.key] ?? "").trim();
        body[f.key] = val || null;
      }
      const res = await fetch(`/api/showroom-stores/${storeId}/address`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to save address (${res.status})`);
      }
      toast.success("Address updated.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error("[EditAddressModal] save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to update address");
    } finally {
      setSaving(false);
    }
  }, [storeId, form, onSaved, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-4" /> Edit address
          </DialogTitle>
          <DialogDescription>
            Fix the address if intake got it wrong or the store moved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {ADDRESS_FIELDS.map((f) => (
            <div key={f.key} className={`space-y-1.5 ${f.wide ? "col-span-2" : ""}`}>
              <Label htmlFor={`addr-${f.key}`} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              <Input
                id={`addr-${f.key}`}
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="text-sm"
              />
            </div>
          ))}
        </div>
        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage links ─────────────────────────────────────────────────────────────

interface StoreLink {
  id: number;
  url: string;
  type: string;
  urlNotes: string | null;
}

/** One existing link row: type + url draft with a Save (when dirty) + delete. */
function LinkRow({
  link,
  onSave,
  onDelete,
}: {
  link: StoreLink;
  onSave: (id: number, url: string, type: LinkType) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [url, setUrl] = useState(link.url);
  const [type, setType] = useState<LinkType>(asLinkType(link.type));
  const [busy, setBusy] = useState(false);

  // Re-seed if the list refreshes with new server values.
  useEffect(() => {
    setUrl(link.url);
    setType(asLinkType(link.type));
  }, [link.url, link.type]);

  const dirty = url.trim() !== link.url || type !== asLinkType(link.type);

  return (
    <div className="flex items-center gap-2">
      <Select value={type} onValueChange={(v) => setType(v as LinkType)}>
        <SelectTrigger className="w-32 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LINK_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {LINK_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        aria-label={`${LINK_TYPE_LABELS[type]} URL`}
        className="flex-1 text-sm"
      />
      {dirty && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !url.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(link.id, url.trim(), type);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-rose-300"
        disabled={busy}
        aria-label="Delete link"
        onClick={async () => {
          setBusy(true);
          try {
            await onDelete(link.id);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export function ManageLinksModal({
  storeId,
  open,
  onOpenChange,
  onChanged,
}: {
  storeId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful mutation so the parent can refresh the store. */
  onChanged: () => void;
}) {
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newType, setNewType] = useState<LinkType>("WEBSITE");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/links`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load links (${res.status})`);
      const data = (await res.json()) as { links?: StoreLink[] };
      setLinks(data.links ?? []);
    } catch (err) {
      console.error("[ManageLinksModal] load failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const refresh = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  const saveLink = useCallback(
    async (id: number, url: string, type: LinkType) => {
      try {
        const res = await fetch(`/api/showroom-stores/${storeId}/links/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, type }),
        });
        if (!res.ok) throw new Error(`Failed to save link (${res.status})`);
        toast.success("Link updated.");
        await refresh();
      } catch (err) {
        console.error("[ManageLinksModal] save failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to save link");
      }
    },
    [storeId, refresh],
  );

  const deleteLink = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/showroom-stores/${storeId}/links/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Failed to delete link (${res.status})`);
        toast.success("Link removed.");
        await refresh();
      } catch (err) {
        console.error("[ManageLinksModal] delete failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to delete link");
      }
    },
    [storeId, refresh],
  );

  const addLink = useCallback(async () => {
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/links`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, type: newType }),
      });
      if (!res.ok) throw new Error(`Failed to add link (${res.status})`);
      toast.success("Link added.");
      setNewUrl("");
      setNewType("WEBSITE");
      await refresh();
    } catch (err) {
      console.error("[ManageLinksModal] add failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setAdding(false);
    }
  }, [storeId, newUrl, newType, refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> Manage links
          </DialogTitle>
          <DialogDescription>
            Website, social profiles, and any other links for this showroom.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {/* Existing links */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading links…
              </div>
            ) : links.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No links yet.</p>
            ) : (
              links.map((l) => (
                <LinkRow key={l.id} link={l} onSave={saveLink} onDelete={deleteLink} />
              ))
            )}
          </div>

          {/* Add a new link */}
          <div className="rounded-lg bg-muted/40 p-3 ring-1 ring-border/40">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Globe className="size-3" /> Add link
            </p>
            <div className="flex items-center gap-2">
              <Select value={newType} onValueChange={(v) => setNewType(v as LinkType)}>
                <SelectTrigger className="w-32 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {LINK_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addLink();
                  }
                }}
                placeholder="https://…"
                aria-label="New link URL"
                className="flex-1 text-sm"
              />
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={adding || !newUrl.trim()}
                onClick={() => void addLink()}
              >
                {adding ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
