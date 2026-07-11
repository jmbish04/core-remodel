/**
 * @fileoverview BucketReviewForm — Phase-3 review for ONE photo bucket
 * (= one product in D1). Photo collage LEFT (click → zoom lightbox), a single
 * column of vocab-backed fields RIGHT, seeded from the AI extraction.
 *
 * Reuses the shared building blocks (never hand-rolled):
 *   • MultipleSelector  → category / subcategory / colors (colors carry hex)
 *   • ComboboxWithOther → brand (category-filtered) / style (autocomplete)
 *   • CurrencyInput     → price / sale price (stores text + integer cents)
 *   • Base-UI Dialog    → photo zoom, brand-create, color-create, reject modal
 *
 * Approve → POST /api/intake/buckets/:id/review {action:'approve', …ids+text+cents}
 * Reject  → red button → modal (common-reason toggles + conditional reason) →
 *           POST {action:'reject', rejectReasonCodes, reason}
 *
 * Monolith dark: no 1px borders (ring-1 ring-border/40 / bg-card); every
 * failure routed through a sonner toast; nothing dismisses mid-submit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import { ComboboxWithOther, type ComboboxOption } from "@/components/ui/combobox-with-other";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/components/products";

import type { CategoryRow, ColorRow, ReviewBucket } from "./review-types";

// ─── Static reject reasons ───────────────────────────────────────────────────
const REJECT_REASONS = [
  "Blurry / unreadable",
  "Wrong product",
  "Duplicate",
  "Price unclear",
  "Not a product",
  "Display sample only",
] as const;

interface Money {
  text: string;
  cents: number | null;
}

const emptyMoney: Money = { text: "", cents: null };

function moneyFrom(v: string | number | null | undefined): Money {
  if (v == null) return emptyMoney;
  const text = String(v).trim();
  const cleaned = text.replace(/[^0-9.]/g, "");
  const dollars = cleaned === "" || cleaned === "." ? NaN : Number.parseFloat(cleaned);
  return { text, cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null };
}

/** Pending create-modal handle: the promise the picker awaits + prefilled label. */
type PendingCreate<T> = { label: string; resolve: (opt: T | null) => void };

export function BucketReviewForm({
  bucket,
  categories,
  colors,
  onResolved,
  onCategoryCreated,
  onColorCreated,
}: {
  bucket: ReviewBucket;
  categories: CategoryRow[];
  colors: ColorRow[];
  onResolved: (bucketId: number) => void;
  onCategoryCreated: (row: CategoryRow) => void;
  onColorCreated: (row: ColorRow) => void;
}) {
  const attrs = bucket.attributes ?? {};

  // ── field state (text seeded directly; id-backed fields seeded by name) ──
  const [itemName, setItemName] = useState(attrs.itemName ?? "");
  const [modelNumber, setModelNumber] = useState(attrs.modelNumber ?? "");
  const [naModel, setNaModel] = useState((attrs.modelNumber ?? "").trim().toUpperCase() === "N/A");
  const [style, setStyle] = useState<string | null>(attrs.style ?? null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [subcategoryIds, setSubcategoryIds] = useState<string[]>([]);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [price, setPrice] = useState<Money>(() => moneyFrom(attrs.price));
  const [hasDiscount, setHasDiscount] = useState(
    Boolean(attrs.salePrice != null || attrs.discountInfo),
  );
  const [discountInfo, setDiscountInfo] = useState(attrs.discountInfo ?? "");
  const [salePrice, setSalePrice] = useState<Money>(() => moneyFrom(attrs.salePrice));

  // ── per-category vocab (brands/subcategories/styles filter by 1st category) ──
  const firstCategoryId = categoryIds[0] ? Number(categoryIds[0]) : null;
  const [brandOptions, setBrandOptions] = useState<ComboboxOption[]>([]);
  const [subcatOptions, setSubcatOptions] = useState<{ value: string; label: string }[]>([]);
  const [styleOptions, setStyleOptions] = useState<ComboboxOption[]>([]);

  const isStone = categoryIds.some((id) =>
    /stone/i.test(categories.find((c) => String(c.id) === id)?.name ?? ""),
  );

  // ── async create modals (brand + color) ──
  const [brandCreate, setBrandCreate] = useState<PendingCreate<ComboboxOption> | null>(null);
  const [colorCreate, setColorCreate] = useState<PendingCreate<{
    value: string;
    label: string;
    hexCode: string;
  }> | null>(null);

  // ── zoom + reject + submit ──
  const [zoom, setZoom] = useState<ReviewBucket["photos"][number] | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCodes, setRejectCodes] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const confidence =
    typeof attrs.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(attrs.confidence)))
      : null;

  // ── seed category / colors by name once the vocab is present ──────────────
  const seededCat = useRef(false);
  useEffect(() => {
    if (seededCat.current || !attrs.category) return;
    const match = categories.find(
      (c) => c.name.toLowerCase() === String(attrs.category).toLowerCase(),
    );
    if (match) {
      setCategoryIds([String(match.id)]);
      seededCat.current = true;
    }
  }, [categories, attrs.category]);

  const seededColors = useRef(false);
  useEffect(() => {
    if (seededColors.current || !attrs.colors?.length || colors.length === 0) return;
    const ids = attrs.colors
      .map((c) => colors.find((row) => row.name.toLowerCase() === c.name.toLowerCase())?.id)
      .filter((id): id is number => id != null)
      .map(String);
    if (ids.length) setColorIds(ids);
    seededColors.current = true;
  }, [colors, attrs.colors]);

  // ── load per-category vocab when the first category changes ───────────────
  const seededBrand = useRef(false);
  useEffect(() => {
    if (firstCategoryId == null) {
      setBrandOptions([]);
      setSubcatOptions([]);
      setStyleOptions([]);
      return;
    }
    const qs = `?categoryId=${firstCategoryId}`;
    void api<{ brands: { id: number; name: string }[] }>(`/api/config/brands${qs}`)
      .then((r) => {
        setBrandOptions(r.brands.map((b) => ({ value: String(b.id), label: b.name })));
        if (!seededBrand.current && attrs.brand) {
          const m = r.brands.find((b) => b.name.toLowerCase() === String(attrs.brand).toLowerCase());
          if (m) setBrandId(String(m.id));
          seededBrand.current = true;
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load brands"));
    void api<{ id: number; name: string }[]>(`/api/config/subcategories${qs}`)
      .then((rows) => setSubcatOptions(rows.map((s) => ({ value: String(s.id), label: s.name }))))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load subcategories"));
    void api<{ styles: string[] }>(`/api/config/styles${qs}`)
      .then((r) => setStyleOptions(r.styles.map((s) => ({ value: s, label: s }))))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load styles"));
  }, [firstCategoryId, attrs.brand]);

  // ── vocab option lists ────────────────────────────────────────────────────
  const categoryOptions = categories.map((c) => ({ value: String(c.id), label: c.name }));
  const colorOptions = colors.map((c) => ({
    value: String(c.id),
    label: c.name,
    hexCode: c.hexCode,
  }));

  // ── create-Other handlers ────────────────────────────────────────────────
  const createCategory = useCallback(
    async (name: string) => {
      try {
        const row = await api<CategoryRow>("/api/config/categories", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        onCategoryCreated(row);
        return { value: String(row.id), label: row.name };
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create category");
        return null;
      }
    },
    [onCategoryCreated],
  );

  const createColor = useCallback(
    (label: string) =>
      new Promise<{ value: string; label: string; hexCode: string } | null>((resolve) =>
        setColorCreate({ label, resolve }),
      ),
    [],
  );

  const createBrand = useCallback(
    (label: string) =>
      new Promise<ComboboxOption | null>((resolve) => setBrandCreate({ label, resolve })),
    [],
  );

  const toggleNa = () => {
    setNaModel((prev) => {
      const next = !prev;
      setModelNumber(next ? "N/A" : "");
      return next;
    });
  };

  const discountPct =
    hasDiscount && price.cents && salePrice.cents && price.cents > 0
      ? Math.round((1 - salePrice.cents / price.cents) * 100)
      : null;

  // ── submit ────────────────────────────────────────────────────────────────
  const approve = async () => {
    if (!itemName.trim()) {
      toast.error("Item name is required");
      return;
    }
    setBusy("approve");
    try {
      await api(`/api/intake/buckets/${bucket.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action: "approve",
          itemName: itemName.trim(),
          modelNumber: modelNumber.trim() || null,
          style: style || null,
          brandId: brandId ? Number(brandId) : null,
          categoryIds: categoryIds.map(Number),
          subcategoryIds: subcategoryIds.map(Number),
          colorIds: colorIds.map(Number),
          price: price.text || null,
          priceCents: price.cents,
          salePrice: hasDiscount ? salePrice.text || null : null,
          salePriceCents: hasDiscount ? salePrice.cents : null,
          discountInfo: hasDiscount ? discountInfo.trim() || null : null,
          discountPct,
        }),
      });
      toast.success("Approved");
      onResolved(bucket.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
      setBusy(null);
    }
  };

  const reject = async () => {
    if (rejectCodes.length === 0 && !rejectReason.trim()) {
      toast.error("Pick a reason or write one");
      return;
    }
    setBusy("reject");
    try {
      await api(`/api/intake/buckets/${bucket.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action: "reject",
          rejectReasonCodes: rejectCodes,
          reason: rejectReason.trim() || null,
        }),
      });
      toast.success("Rejected");
      onResolved(bucket.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 rounded-2xl bg-card p-5 ring-1 ring-border/40 md:grid-cols-[minmax(0,300px)_1fr]">
      {/* ── LEFT: photo collage + confidence ─────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full text-[10px] capitalize">
            {bucket.kind.replace("_", " ")}
          </Badge>
          {confidence !== null && (
            <Badge
              variant={confidence >= 70 ? "default" : "outline"}
              className="rounded-full text-[10px]"
            >
              {confidence}% confident
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {bucket.photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setZoom(p)}
              className="group flex flex-col gap-1 text-left"
              title={p.fileName ?? undefined}
            >
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.fileName ?? "Bucket photo"}
                  className="aspect-square w-full rounded-xl object-cover ring-1 ring-border/40 transition group-hover:ring-2 group-hover:ring-ring"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted/30 text-[10px] text-muted-foreground ring-1 ring-border/40">
                  No image
                </div>
              )}
              {p.fileName && (
                <span className="truncate text-[10px] text-muted-foreground">{p.fileName}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: single-column form ────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <Field label="Category">
          <MultipleSelector
            options={categoryOptions}
            value={categoryIds}
            onValueChange={setCategoryIds}
            placeholder="Select category"
            title="Category"
            enableCreate
            createLabel="Create category"
            onCreateOption={createCategory}
          />
        </Field>

        <Field label="Subcategory">
          <MultipleSelector
            options={subcatOptions}
            value={subcategoryIds}
            onValueChange={setSubcategoryIds}
            placeholder={firstCategoryId ? "Select subcategory" : "Pick a category first"}
            title="Subcategory"
            disabled={firstCategoryId == null}
          />
        </Field>

        <Field
          label={isStone ? "Brand (optional for stone)" : "Brand"}
          className={isStone ? "opacity-60" : undefined}
        >
          <ComboboxWithOther
            options={brandOptions}
            value={brandId}
            onChange={setBrandId}
            onCreateOther={createBrand}
            placeholder={firstCategoryId ? "Select brand" : "Pick a category first"}
            disabled={firstCategoryId == null}
          />
        </Field>

        <Field label="Item name *">
          <Input
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. Calacatta Viola Slab"
            className="bg-muted/20"
          />
        </Field>

        <Field label="Model #">
          <div className="flex">
            <Input
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
              disabled={naModel}
              placeholder="Model number"
              className="rounded-r-none bg-muted/20"
            />
            <Button
              type="button"
              variant={naModel ? "default" : "outline"}
              onClick={toggleNa}
              className="rounded-l-none border-l-0"
            >
              N/A
            </Button>
          </div>
        </Field>

        <Field label="Style">
          <ComboboxWithOther
            options={styleOptions}
            value={style}
            onChange={setStyle}
            onCreateOther={(label) => ({ value: label, label })}
            placeholder={firstCategoryId ? "Select or type a style" : "Pick a category first"}
            disabled={firstCategoryId == null}
          />
        </Field>

        <Field label="Colors">
          <MultipleSelector
            options={colorOptions}
            value={colorIds}
            onValueChange={setColorIds}
            placeholder="Select colors"
            title="Colors"
            enableCreate
            createLabel="New color"
            onCreateOption={createColor}
          />
        </Field>

        <Field label="Price">
          <CurrencyInput
            value={price.text}
            onValueChange={(text, cents) => setPrice({ text, cents })}
            aria-label="Price"
          />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-muted/20 px-3 py-2 ring-1 ring-border/40">
          <Label htmlFor={`discount-${bucket.id}`} className="text-sm">
            Has discount
          </Label>
          <Switch
            id={`discount-${bucket.id}`}
            checked={hasDiscount}
            onCheckedChange={setHasDiscount}
          />
        </div>

        {hasDiscount && (
          <div className="grid gap-4 rounded-xl bg-muted/10 p-3 ring-1 ring-border/40">
            <Field label="Discount info">
              <Input
                value={discountInfo}
                onChange={(e) => setDiscountInfo(e.target.value)}
                placeholder="e.g. Floor model — 20% off"
                className="bg-muted/20"
              />
            </Field>
            <Field label={discountPct != null ? `Sale price (${discountPct}% off)` : "Sale price"}>
              <CurrencyInput
                value={salePrice.text}
                onValueChange={(text, cents) => setSalePrice({ text, cents })}
                aria-label="Sale price"
              />
            </Field>
          </div>
        )}

        {/* actions */}
        <div className="mt-1 flex flex-wrap gap-2">
          <Button disabled={busy !== null || !itemName.trim()} onClick={() => void approve()}>
            {busy === "approve" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 size-4" />
            )}
            Approve
          </Button>
          <Button
            variant="destructive"
            disabled={busy !== null}
            onClick={() => setRejectOpen(true)}
          >
            <X className="mr-1.5 size-4" />
            Reject
          </Button>
        </div>
      </div>

      {/* ── zoom lightbox ─────────────────────────────────────────────────── */}
      <Dialog open={zoom !== null} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate text-sm">{zoom?.fileName ?? "Photo"}</DialogTitle>
          </DialogHeader>
          {zoom?.imageUrl && (
            <img
              src={zoom.imageUrl}
              alt={zoom.fileName ?? "Photo"}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── reject modal ──────────────────────────────────────────────────── */}
      <Dialog
        open={rejectOpen}
        onOpenChange={(o) => busy !== "reject" && setRejectOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this product</DialogTitle>
            <DialogDescription>
              Pick a common reason, or write one if none fit.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((r) => {
              const on = rejectCodes.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() =>
                    setRejectCodes((prev) =>
                      on ? prev.filter((x) => x !== r) : [...prev, r],
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs ring-1 transition",
                    on
                      ? "bg-primary text-primary-foreground ring-primary"
                      : "bg-muted/30 text-muted-foreground ring-border/40 hover:bg-muted",
                  )}
                >
                  {r}
                </button>
              );
            })}
          </div>

          <Field
            label={
              rejectCodes.length === 0 ? "Reason (required)" : "Reason (optional)"
            }
          >
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="What's wrong with it?"
              className="bg-muted/20"
              rows={3}
            />
          </Field>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy === "reject"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void reject()}
              disabled={
                busy === "reject" ||
                (rejectCodes.length === 0 && !rejectReason.trim())
              }
            >
              {busy === "reject" && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Reject product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── brand-create modal (also asks for category) ───────────────────── */}
      <BrandCreateModal
        pending={brandCreate}
        categories={categories}
        defaultCategoryId={firstCategoryId}
        onClose={() => setBrandCreate(null)}
      />

      {/* ── color-create modal (name + <input type=color>) ────────────────── */}
      <ColorCreateModal
        pending={colorCreate}
        onCreated={onColorCreated}
        onClose={() => setColorCreate(null)}
      />
    </div>
  );
}

// ─── Small field wrapper ─────────────────────────────────────────────────────
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ─── Brand-create modal ──────────────────────────────────────────────────────
function BrandCreateModal({
  pending,
  categories,
  defaultCategoryId,
  onClose,
}: {
  pending: PendingCreate<ComboboxOption> | null;
  categories: CategoryRow[];
  defaultCategoryId: number | null;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pending) {
      setName(pending.label);
      setCategoryId(defaultCategoryId != null ? String(defaultCategoryId) : null);
    }
  }, [pending, defaultCategoryId]);

  const cancel = () => {
    pending?.resolve(null);
    onClose();
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Brand name required");
      return;
    }
    setSaving(true);
    try {
      const row = await api<{ id: number; name: string }>("/api/config/brands", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          categoryId: categoryId ? Number(categoryId) : null,
        }),
      });
      pending?.resolve({ value: String(row.id), label: row.name });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create brand");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && !saving && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>Confirm the name and pick its category.</DialogDescription>
        </DialogHeader>
        <Field label="Brand name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted/20" />
        </Field>
        <Field label="Category">
          <ComboboxWithOther
            options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Select category"
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create brand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Color-create modal ──────────────────────────────────────────────────────
function ColorCreateModal({
  pending,
  onCreated,
  onClose,
}: {
  pending: PendingCreate<{ value: string; label: string; hexCode: string }> | null;
  onCreated: (row: ColorRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#888888");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pending) {
      setName(pending.label);
      setHex("#888888");
    }
  }, [pending]);

  const cancel = () => {
    pending?.resolve(null);
    onClose();
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Color name required");
      return;
    }
    setSaving(true);
    try {
      const row = await api<ColorRow>("/api/config/colors", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), hexCode: hex }),
      });
      onCreated(row);
      pending?.resolve({ value: String(row.id), label: row.name, hexCode: row.hexCode ?? hex });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create color");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && !saving && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New color</DialogTitle>
          <DialogDescription>Name the color and pick its swatch.</DialogDescription>
        </DialogHeader>
        <Field label="Color name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted/20" />
        </Field>
        <Field label="Swatch">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="size-10 cursor-pointer rounded-md bg-transparent ring-1 ring-border/40"
              aria-label="Pick color"
            />
            <Input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="w-32 bg-muted/20 font-mono"
            />
          </div>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create color
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
