/**
 * @fileoverview EditStoreModal — full-field editor for a showroom store.
 *
 * Dialog-based form grouped into tabbed sections (Basic, Contact, Location,
 * Operational, Media, POC). Pre-populates from the current store data,
 * submits via `PUT /api/showroom-stores/:id`.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal store shape — we accept any keys from the API response. */
export interface EditableStore {
  id: number;
  name: string;
  description?: string | null;
  pricePoint?: string | null;
  phoneNumber?: string | null;
  emailAddress?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  pinterestUrl?: string | null;
  iconCfImagesUrl?: string | null;
  heroImageCfImagesUrl?: string | null;
  locationAddress?: string | null;
  zipCode?: string | null;
  googleMapsLink?: string | null;
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
  [key: string]: unknown;
}

interface EditStoreModalProps {
  store: EditableStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

// ─── Field definitions ──────────────────────────────────────────────────────

interface TextField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "url";
  placeholder?: string;
}

interface BoolField {
  key: string;
  label: string;
  description?: string;
}

const BASIC_FIELDS: TextField[] = [
  { key: "name", label: "Name", placeholder: "Showroom name" },
  { key: "description", label: "Description", type: "textarea", placeholder: "Brief description…" },
  { key: "scale", label: "Scale", placeholder: "e.g. boutique, mid-size, warehouse" },
  { key: "inventoryFocus", label: "Inventory Focus", placeholder: "e.g. tile, stone, fixtures" },
  { key: "targetDemographic", label: "Target Demographic", placeholder: "e.g. designers, homeowners" },
];

const CONTACT_FIELDS: TextField[] = [
  { key: "phoneNumber", label: "Phone", placeholder: "+1 (xxx) xxx-xxxx" },
  { key: "emailAddress", label: "Email", placeholder: "contact@showroom.com" },
  { key: "websiteUrl", label: "Website", type: "url", placeholder: "https://…" },
  { key: "instagramUrl", label: "Instagram", type: "url", placeholder: "https://instagram.com/…" },
  { key: "facebookUrl", label: "Facebook", type: "url", placeholder: "https://facebook.com/…" },
  { key: "pinterestUrl", label: "Pinterest", type: "url", placeholder: "https://pinterest.com/…" },
];

const LOCATION_FIELDS: TextField[] = [
  { key: "locationAddress", label: "Address", placeholder: "Full street address" },
  { key: "zipCode", label: "Zip Code", placeholder: "94102" },
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

const OPERATIONAL_BOOLS: BoolField[] = [
  { key: "isAppointmentOnly", label: "Appointment Only", description: "Requires scheduling a visit" },
  { key: "isFlagshipLocation", label: "Flagship Location", description: "Primary/flagship showroom" },
  { key: "isLargeSelection", label: "Large Selection", description: "Warehouse-scale inventory" },
  { key: "isBespoke", label: "Bespoke", description: "Hand-selected or made-to-order" },
  { key: "isTradeRepRequired", label: "Trade Rep Required", description: "Requires trade introduction" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function EditStoreModal({ store, open, onOpenChange, onSaved }: EditStoreModalProps) {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Populate form from store when modal opens.
  useEffect(() => {
    if (open) {
      const initial: Record<string, unknown> = {};
      const allFields = [...BASIC_FIELDS, ...CONTACT_FIELDS, ...LOCATION_FIELDS, ...MEDIA_FIELDS, ...POC_FIELDS];
      for (const f of allFields) {
        initial[f.key] = store[f.key] ?? "";
      }
      for (const f of OPERATIONAL_BOOLS) {
        initial[f.key] = store[f.key] ?? false;
      }
      // Price point is a select, handle separately.
      initial.pricePoint = store.pricePoint ?? "";
      setForm(initial);
    }
  }, [open, store]);

  const set = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      // Only include fields that changed.
      const allTextFields = [...BASIC_FIELDS, ...CONTACT_FIELDS, ...LOCATION_FIELDS, ...MEDIA_FIELDS, ...POC_FIELDS];
      for (const f of allTextFields) {
        const val = form[f.key] as string;
        const original = (store[f.key] as string) ?? "";
        if (val !== original) {
          body[f.key] = val || null; // empty string → null
        }
      }
      for (const f of OPERATIONAL_BOOLS) {
        const val = form[f.key] as boolean;
        const original = (store[f.key] as boolean) ?? false;
        if (val !== original) body[f.key] = val;
      }
      if ((form.pricePoint || "") !== (store.pricePoint || "")) {
        body.pricePoint = (form.pricePoint as string) || null;
      }

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
  }, [form, store, onSaved, onOpenChange]);

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
            </TabsContent>

            <TabsContent value="contact" className="space-y-3 px-5 pb-2 pt-3">
              {CONTACT_FIELDS.map(renderTextField)}
            </TabsContent>

            <TabsContent value="location" className="space-y-3 px-5 pb-2 pt-3">
              {LOCATION_FIELDS.map(renderTextField)}
            </TabsContent>

            <TabsContent value="ops" className="space-y-3 px-5 pb-2 pt-3">
              {OPERATIONAL_BOOLS.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/30 p-3">
                  <div>
                    <p className="text-sm font-medium">{field.label}</p>
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={(form[field.key] as boolean) ?? false}
                    onCheckedChange={(v) => set(field.key, v)}
                  />
                </div>
              ))}
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

        <DialogFooter className="border-t border-border/40 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
