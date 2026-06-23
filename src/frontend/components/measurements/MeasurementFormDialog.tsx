/**
 * @fileoverview Add / edit dialog for a single master measurement (0006 Phase 1).
 *
 * Controlled shadcn `Dialog`.  Reuses the shared `RoomSelect` for the room picker,
 * base-ui `Select` for the element-type + source enums, and `Switch` for the
 * approximate flag.  Numeric fields are held as strings while editing and parsed to
 * number|null on submit (empty = null).  No window.confirm/alert anywhere.
 *
 * The parent owns persistence: `onSubmit(input)` performs the POST/PATCH and resolves
 * `true` on success (the dialog then closes) or `false` to keep the form open.
 */

import * as React from "react";
import { Loader2, Save } from "lucide-react";

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
import { RoomSelect } from "@/components/ui/room-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  ELEMENT_TYPE_OPTIONS,
  SOURCE_OPTIONS,
  toFloatOrNull,
  toIntOrNull,
  type ElementType,
  type Measurement,
  type MeasurementInput,
  type MeasurementSource,
} from "./measurement-types";

interface MeasurementFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing measurement when editing; null when creating. */
  measurement: Measurement | null;
  /** Persist handler. Resolve true on success (closes the dialog), false to stay open. */
  onSubmit: (input: MeasurementInput) => Promise<boolean>;
}

interface FormState {
  roomId: number | null;
  elementType: ElementType;
  label: string;
  lengthFeet: string;
  lengthInches: string;
  widthFeet: string;
  widthInches: string;
  heightFeet: string;
  heightInches: string;
  areaSqFt: string;
  quantity: string;
  source: MeasurementSource;
  isApproximate: boolean;
  accuracyNote: string;
  notes: string;
}

/** Defaults for a new measurement — biased to the owner's immediate workflow
 * (logging the approximate insurance/Matterport numbers first). */
const EMPTY_FORM: FormState = {
  roomId: null,
  elementType: "wall",
  label: "",
  lengthFeet: "",
  lengthInches: "",
  widthFeet: "",
  widthInches: "",
  heightFeet: "",
  heightInches: "",
  areaSqFt: "",
  quantity: "1",
  source: "insurance_matterport",
  isApproximate: true,
  accuracyNote: "",
  notes: "",
};

/** Stringify a nullable number for a controlled input ("" when null). */
const numToStr = (n: number | null): string => (n == null ? "" : String(n));

/** Build the form state from an existing measurement. */
function formFromMeasurement(m: Measurement): FormState {
  return {
    roomId: m.roomId,
    elementType: m.elementType,
    label: m.label ?? "",
    lengthFeet: numToStr(m.lengthFeet),
    lengthInches: numToStr(m.lengthInches),
    widthFeet: numToStr(m.widthFeet),
    widthInches: numToStr(m.widthInches),
    heightFeet: numToStr(m.heightFeet),
    heightInches: numToStr(m.heightInches),
    areaSqFt: numToStr(m.areaSqFt),
    quantity: String(m.quantity ?? 1),
    source: m.source,
    isApproximate: m.isApproximate,
    accuracyNote: m.accuracyNote ?? "",
    notes: m.notes ?? "",
  };
}

/** A labelled feet + inches pair. */
function DimensionRow({
  label,
  feet,
  inches,
  onFeet,
  onInches,
}: {
  label: string;
  feet: string;
  inches: string;
  onFeet: (v: string) => void;
  onInches: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={feet}
          onChange={(e) => onFeet(e.target.value)}
          placeholder="0"
          aria-label={`${label} feet`}
        />
        <span className="text-xs text-muted-foreground">ft</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.25"
          value={inches}
          onChange={(e) => onInches(e.target.value)}
          placeholder="0"
          aria-label={`${label} inches`}
        />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

export function MeasurementFormDialog({
  open,
  onOpenChange,
  measurement,
  onSubmit,
}: MeasurementFormDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);

  const isEdit = measurement !== null;

  // Repopulate the form whenever the dialog opens (for a new or existing row).
  React.useEffect(() => {
    if (!open) return;
    setForm(measurement ? formFromMeasurement(measurement) : EMPTY_FORM);
  }, [open, measurement]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const input: MeasurementInput = {
        roomId: form.roomId,
        elementType: form.elementType,
        label: form.label.trim() || null,
        lengthFeet: toIntOrNull(form.lengthFeet),
        lengthInches: toFloatOrNull(form.lengthInches),
        widthFeet: toIntOrNull(form.widthFeet),
        widthInches: toFloatOrNull(form.widthInches),
        heightFeet: toIntOrNull(form.heightFeet),
        heightInches: toFloatOrNull(form.heightInches),
        areaSqFt: toFloatOrNull(form.areaSqFt),
        quantity: toIntOrNull(form.quantity) ?? 1,
        source: form.source,
        isApproximate: form.isApproximate,
        accuracyNote: form.accuracyNote.trim() || null,
        notes: form.notes.trim() || null,
      };
      const ok = await onSubmit(input);
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit measurement" : "Add measurement"}</DialogTitle>
          <DialogDescription>
            Master, as-is dimensions. Leave fields blank when not applicable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Room */}
          <div className="space-y-1.5">
            <Label htmlFor="measurement-room">Room</Label>
            <RoomSelect
              id="measurement-room"
              value={form.roomId}
              onChange={(roomId) => set("roomId", roomId)}
              placeholder="House-wide (no room)"
            />
          </div>

          {/* Element type */}
          <div className="space-y-1.5">
            <Label>Element type</Label>
            <Select
              value={form.elementType}
              onValueChange={(v) => set("elementType", v as ElementType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue items={ELEMENT_TYPE_OPTIONS} placeholder="Element type" />
              </SelectTrigger>
              <SelectContent>
                {ELEMENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Label */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="measurement-label">Label</Label>
            <Input
              id="measurement-label"
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder='e.g. "Living-room fireplace footprint"'
            />
          </div>

          {/* Dimensions */}
          <DimensionRow
            label="Length"
            feet={form.lengthFeet}
            inches={form.lengthInches}
            onFeet={(v) => set("lengthFeet", v)}
            onInches={(v) => set("lengthInches", v)}
          />
          <DimensionRow
            label="Width"
            feet={form.widthFeet}
            inches={form.widthInches}
            onFeet={(v) => set("widthFeet", v)}
            onInches={(v) => set("widthInches", v)}
          />
          <DimensionRow
            label="Height"
            feet={form.heightFeet}
            inches={form.heightInches}
            onFeet={(v) => set("heightFeet", v)}
            onInches={(v) => set("heightInches", v)}
          />

          {/* Area + quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="measurement-area">Area (sq ft)</Label>
              <Input
                id="measurement-area"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={form.areaSqFt}
                onChange={(e) => set("areaSqFt", e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="measurement-qty">Quantity</Label>
              <Input
                id="measurement-qty"
                type="number"
                inputMode="numeric"
                min={1}
                value={form.quantity}
                onChange={(e) => set("quantity", e.target.value)}
                placeholder="1"
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select
              value={form.source}
              onValueChange={(v) => set("source", v as MeasurementSource)}
            >
              <SelectTrigger className="w-full">
                <SelectValue items={SOURCE_OPTIONS} placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Approximate */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2 ring-1 ring-border/40 sm:mt-6">
            <div>
              <Label htmlFor="measurement-approx">Approximate</Label>
              <p className="text-xs text-muted-foreground">Flag when the value isn't exact.</p>
            </div>
            <Switch
              id="measurement-approx"
              checked={form.isApproximate}
              onCheckedChange={(checked) => set("isApproximate", checked)}
            />
          </div>

          {/* Accuracy note */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="measurement-accuracy">Accuracy note</Label>
            <Input
              id="measurement-accuracy"
              value={form.accuracyNote}
              onChange={(e) => set("accuracyNote", e.target.value)}
              placeholder='e.g. "Matterport, ±3in"'
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="measurement-notes">Notes</Label>
            <Textarea
              id="measurement-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Anything else worth recording."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            {isEdit ? "Save changes" : "Add measurement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
