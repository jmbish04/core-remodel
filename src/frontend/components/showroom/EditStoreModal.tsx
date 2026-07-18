/**
 * @fileoverview EditStoreModal — full-field editor for a showroom store.
 *
 * Dialog-based form grouped into tabs, pre-populated from the current store and
 * submitted via `PUT /api/showroom-stores/:id`.
 *
 * The field set MIRRORS the intake form (`ShowroomIntakeApp`) — both write the
 * same `createStoreSchema` contract, so anything intake can set must be
 * editable here. To keep the two from drifting again this reuses intake's own
 * editors rather than reimplementing them:
 *
 *   - `LinksField`  → `links[]`      (website + socials + sale pages)
 *   - `HoursEditor` → `hoursJson`    (structured weekly hours)
 *   - `FlagsEditor` → the five trait booleans
 *
 * Fields the server does NOT accept are deliberately absent. Editing them used
 * to LOOK like it worked: the old modal posted flat `websiteUrl` /
 * `instagramUrl` / `facebookUrl` / `pinterestUrl` columns that migration 0109
 * dropped, and `createStoreSchema.partial().parse()` silently strips unknown
 * keys — so the request 200'd, the toast said "Showroom updated", and the edit
 * was thrown away. Those URLs now go through `links[]`, the same as intake.
 *
 * `links` and `hoursJson` are REPLACE-ALL on the server, so they're only sent
 * when actually edited; every other field is sent only when changed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { FlagsEditor, type ShowroomFlags } from "./intake/FlagsEditor";
import { HoursEditor } from "./intake/HoursEditor";
import { LinksField, asLinkType, type IntakeLink } from "./intake/LinksField";
import type { HoursJson } from "./intake/hours-types";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A link row as served by GET /api/showroom-stores/:id. */
export interface EditableStoreLink {
  id: number;
  url: string;
  type: string;
  urlNotes: string | null;
}

/** Minimal store shape — we accept any keys from the API response. */
export interface EditableStore {
  id: number;
  name: string;
  description?: string | null;
  pricePoint?: string | null;
  phoneNumber?: string | null;
  emailAddress?: string | null;
  iconCfImagesUrl?: string | null;
  heroImageCfImagesUrl?: string | null;
  locationAddress?: string | null;
  locationStreetNumber?: string | null;
  locationStreetName?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationZipCode?: string | null;
  googleMapsLink?: string | null;
  hoursJson?: HoursJson | null;
  links?: EditableStoreLink[];
  isAppointmentOnly?: boolean;
  isFlagshipLocation?: boolean;
  isLargeSelection?: boolean;
  isBespoke?: boolean;
  isTradeRepRequired?: boolean;
  scale?: string | null;
  inventoryFocus?: string | null;
  targetDemographic?: string | null;
  mainPocFullname?: string | null;
  mainPocPhoneNumber?: string | null;
  mainPocEmailAddress?: string | null;
  distanceFromSfTime?: string | null;
  distanceFromSfMiles?: string | null;
  locationNotes?: string | null;
  reviewSummary?: string | null;
  [key: string]: unknown;
}

interface EditStoreModalProps {
  store: EditableStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Called after a successful soft delete; the viewport navigates away. */
  onDeleted?: () => void;
}

// ─── Field definitions ──────────────────────────────────────────────────────

interface TextField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "url";
  placeholder?: string;
}

const BASIC_FIELDS: TextField[] = [
  { key: "name", label: "Name", placeholder: "Showroom name" },
  { key: "description", label: "Description", type: "textarea", placeholder: "Brief description…" },
  { key: "scale", label: "Scale", placeholder: "e.g. boutique, mid-size, warehouse" },
  { key: "inventoryFocus", label: "Inventory Focus", placeholder: "e.g. tile, stone, fixtures" },
  { key: "targetDemographic", label: "Target Demographic", placeholder: "e.g. designers, homeowners" },
];

/**
 * Contact fields that ARE columns on `showroom_stores`. The website + social
 * URLs are NOT here — they live in `showroom_store_links` and are edited via
 * LinksField on this same tab.
 */
const CONTACT_FIELDS: TextField[] = [
  { key: "phoneNumber", label: "Phone", placeholder: "+1 (xxx) xxx-xxxx" },
  { key: "emailAddress", label: "Email", placeholder: "contact@showroom.com" },
];

/**
 * `locationZipCode` (not the legacy `zipCode` the old modal wrote) plus the
 * granular parts the place-import backfill populates, so a hand correction can
 * reach the same columns Google's import does.
 */
const LOCATION_FIELDS: TextField[] = [
  { key: "locationAddress", label: "Address", placeholder: "Full street address" },
  { key: "locationStreetNumber", label: "Street Number", placeholder: "126" },
  { key: "locationStreetName", label: "Street Name", placeholder: "Colby St" },
  { key: "locationCity", label: "City", placeholder: "San Francisco" },
  { key: "locationState", label: "State", placeholder: "CA" },
  { key: "locationZipCode", label: "Zip Code", placeholder: "94102" },
  { key: "googleMapsLink", label: "Google Maps Link", type: "url", placeholder: "https://maps.google.com/…" },
  { key: "distanceFromSfTime", label: "Drive Time from SF", placeholder: "e.g. 45 min" },
  { key: "distanceFromSfMiles", label: "Distance from SF", placeholder: "e.g. 30 miles" },
  { key: "locationNotes", label: "Location Notes", type: "textarea", placeholder: "Parking, access notes…" },
];

const MEDIA_FIELDS: TextField[] = [
  { key: "iconCfImagesUrl", label: "Icon URL", type: "url", placeholder: "https://imagedelivery.net/…" },
  { key: "heroImageCfImagesUrl", label: "Hero Image URL", type: "url", placeholder: "https://imagedelivery.net/…" },
];

const POC_FIELDS: TextField[] = [
  { key: "mainPocFullname", label: "Full Name", placeholder: "Jane Smith" },
  { key: "mainPocPhoneNumber", label: "Phone", placeholder: "+1 (xxx) xxx-xxxx" },
  { key: "mainPocEmailAddress", label: "Email", placeholder: "jane@showroom.com" },
];

const REVIEW_FIELDS: TextField[] = [
  {
    key: "reviewSummary",
    label: "AI Review Summary",
    type: "textarea",
    placeholder: "Summary of what reviewers say…",
  },
];

const ALL_TEXT_FIELDS = [
  ...BASIC_FIELDS,
  ...CONTACT_FIELDS,
  ...LOCATION_FIELDS,
  ...MEDIA_FIELDS,
  ...POC_FIELDS,
  ...REVIEW_FIELDS,
];

const FLAG_KEYS: (keyof ShowroomFlags)[] = [
  "isAppointmentOnly",
  "isFlagshipLocation",
  "isLargeSelection",
  "isBespoke",
  "isTradeRepRequired",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The store's links mapped into the LinksField row shape. */
function toIntakeLinks(store: EditableStore): IntakeLink[] {
  return (store.links ?? []).map((l) => ({ url: l.url, type: asLinkType(l.type) }));
}

/** Compare two link sets by url+type, order-sensitive (the editor preserves order). */
function linksEqual(a: IntakeLink[], b: IntakeLink[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.url === b[i].url && l.type === b[i].type);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditStoreModal({
  store,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: EditStoreModalProps) {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [hours, setHours] = useState<HoursJson | null>(null);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const originalLinks = useMemo(() => toIntakeLinks(store), [store]);

  // Populate every editor from the store when the modal opens.
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, unknown> = {};
    for (const f of ALL_TEXT_FIELDS) initial[f.key] = store[f.key] ?? "";
    for (const k of FLAG_KEYS) initial[k] = store[k] ?? false;
    initial.pricePoint = store.pricePoint ?? "";
    setForm(initial);
    setLinks(toIntakeLinks(store));
    setHours(store.hoursJson ?? null);
    setHoursTouched(false);
  }, [open, store, originalLinks]);

  const set = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const flags = useMemo<ShowroomFlags>(
    () => ({
      isAppointmentOnly: (form.isAppointmentOnly as boolean) ?? false,
      isFlagshipLocation: (form.isFlagshipLocation as boolean) ?? false,
      isLargeSelection: (form.isLargeSelection as boolean) ?? false,
      isBespoke: (form.isBespoke as boolean) ?? false,
      isTradeRepRequired: (form.isTradeRepRequired as boolean) ?? false,
    }),
    [form],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};

      for (const f of ALL_TEXT_FIELDS) {
        const val = ((form[f.key] as string) ?? "").trim();
        const original = ((store[f.key] as string) ?? "").trim();
        if (val !== original) body[f.key] = val || null; // empty string → null
      }
      for (const k of FLAG_KEYS) {
        const val = (form[k] as boolean) ?? false;
        if (val !== ((store[k] as boolean) ?? false)) body[k] = val;
      }
      if ((form.pricePoint || "") !== (store.pricePoint || "")) {
        body.pricePoint = (form.pricePoint as string) || null;
      }

      // links + hoursJson are REPLACE-ALL server-side — only send them when
      // actually edited, so an unrelated save can't wipe either.
      const cleanLinks = links
        .map((l) => ({ url: l.url.trim(), type: l.type }))
        .filter((l) => l.url);
      if (!linksEqual(cleanLinks, originalLinks)) body.links = cleanLinks;
      if (hoursTouched && hours) body.hoursJson = hours;

      if (Object.keys(body).length === 0) {
        toast.info("No changes to save.");
        onOpenChange(false);
        return;
      }

      const res = await fetch(`/api/showroom-stores/${store.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Failed to save (${res.status})`);
      }

      toast.success("Showroom updated.");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("[EditStoreModal] save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to update showroom");
    } finally {
      setSaving(false);
    }
  }, [form, links, hours, hoursTouched, originalLinks, store, onSaved, onOpenChange]);

  /**
   * Soft delete — `DELETE /api/showroom-stores/:id` flips `is_active` to 0. The
   * row and every child (notes, photos, ratings, price history) survive, so the
   * toast says "removed", not "deleted", and the store can be restored.
   */
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/showroom-stores/${store.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Failed to delete (${res.status})`);
      }
      toast.success(`${store.name} removed from the directory.`);
      setConfirmDelete(false);
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      console.error("[EditStoreModal] delete failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete showroom");
    } finally {
      setDeleting(false);
    }
  }, [store, onOpenChange, onDeleted]);

  const renderTextField = (field: TextField) => {
    const value = (form[field.key] as string) ?? "";
    return (
      <div key={field.key} className="space-y-1.5">
        <Label htmlFor={`edit-${field.key}`} className="text-xs text-muted-foreground">
          {field.label}
        </Label>
        {field.type === "textarea" ? (
          <Textarea
            id={`edit-${field.key}`}
            value={value}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="min-h-[70px] text-sm"
          />
        ) : (
          <Input
            id={`edit-${field.key}`}
            type={field.type === "url" ? "url" : "text"}
            value={value}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="text-sm"
          />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" /> Edit Showroom
          </DialogTitle>
          <DialogDescription>
            Update any showroom field. Changes save immediately.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="mx-5 w-auto">
            <TabsTrigger value="basic" className="text-xs">Basic</TabsTrigger>
            <TabsTrigger value="contact" className="text-xs">Contact</TabsTrigger>
            <TabsTrigger value="location" className="text-xs">Location</TabsTrigger>
            <TabsTrigger value="hours" className="text-xs">Hours</TabsTrigger>
            <TabsTrigger value="ops" className="text-xs">Ops</TabsTrigger>
            <TabsTrigger value="media" className="text-xs">Media</TabsTrigger>
            <TabsTrigger value="poc" className="text-xs">POC</TabsTrigger>
          </TabsList>

          <ScrollArea className="max-h-[55vh]">
            <TabsContent value="basic" className="space-y-3 px-5 pb-2 pt-3">
              {BASIC_FIELDS.map(renderTextField)}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Price Point</Label>
                <Select
                  value={(form.pricePoint as string) || ""}
                  onValueChange={(v) => set("pricePoint", v || null)}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    <SelectItem value="$">$</SelectItem>
                    <SelectItem value="$$">$$</SelectItem>
                    <SelectItem value="$$$">$$$</SelectItem>
                    <SelectItem value="$$$$">$$$$</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {REVIEW_FIELDS.map(renderTextField)}
            </TabsContent>

            <TabsContent value="contact" className="space-y-3 px-5 pb-2 pt-3">
              {CONTACT_FIELDS.map(renderTextField)}
              <div className="space-y-1.5 border-t border-border/40 pt-3">
                <Label className="text-xs text-muted-foreground">Links</Label>
                <p className="text-[11px] text-muted-foreground/70">
                  Website + social profiles. The hero builds its icon row from these.
                </p>
                <LinksField value={links} onChange={setLinks} />
              </div>
            </TabsContent>

            <TabsContent value="location" className="space-y-3 px-5 pb-2 pt-3">
              {LOCATION_FIELDS.map(renderTextField)}
            </TabsContent>

            <TabsContent value="hours" className="space-y-3 px-5 pb-2 pt-3">
              <HoursEditor
                value={hours}
                onChange={(h) => {
                  setHours(h);
                  setHoursTouched(true);
                }}
              />
            </TabsContent>

            <TabsContent value="ops" className="space-y-3 px-5 pb-2 pt-3">
              <FlagsEditor
                value={flags}
                onChange={(v) => setForm((prev) => ({ ...prev, ...v }))}
              />
            </TabsContent>

            <TabsContent value="media" className="space-y-3 px-5 pb-2 pt-3">
              {MEDIA_FIELDS.map(renderTextField)}
              {/* Preview the icon if set */}
              {(form.iconCfImagesUrl as string) && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Preview:</span>
                  <img
                    src={form.iconCfImagesUrl as string}
                    alt="Icon preview"
                    className="size-10 rounded-full object-contain ring-1 ring-border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="poc" className="space-y-3 px-5 pb-2 pt-3">
              <p className="text-xs text-muted-foreground">
                Primary point of contact for this showroom.
              </p>
              {POC_FIELDS.map(renderTextField)}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="border-t border-border/40 px-5 py-3 sm:justify-between">
          {/* Soft delete — sits apart from Cancel/Save so it can't be hit by
              accident, and behind a confirm because it removes the showroom
              from every list at once. */}
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
          >
            <Trash2 className="size-3.5" /> Delete showroom
          </Button>
          <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || deleting}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save Changes
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (deleting) return;
          setConfirmDelete(next);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {store.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the directory, map, drives and search. Nothing is
              erased — notes, photos, ratings and price history are kept, and the
              showroom can be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              {deleting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
