/**
 * @fileoverview RecordVisitModal — a multi-step "record a showroom visit" flow.
 *
 * Opened from the store viewport, this modal captures two independent things in a
 * single guided flow:
 *
 *   1. A personal visit rating (1–5 stars) + a rich-text context note.
 *   2. An optional point-of-contact (POC) — either typed by hand or extracted from
 *      a photographed business card via the AI extract endpoint.
 *
 * Flow (shadcn Dialog + a stepper header):
 *   Step 1 · Rating   — star selector + <OverviewNoteEditor> for the context note.
 *   Step 2 · Contact  — "Did you meet someone?" No → straight to Review.
 *                       Yes → "Got a business card?"
 *                         No  → manual contact form.
 *                         Yes → front/back card upload → "Extract business card"
 *                               (POST …/pocs/extract-card) → prefill the form,
 *                               retaining the stored card image URLs.
 *   Step 3 · Review   — confirm + Save.
 *
 * Save issues up to two writes:
 *   - PUT  …/visit-rating  (only if a rating was chosen)
 *   - POST …/pocs          (only if any contact data exists)
 * A rating-only visit is valid; a contact is never required.
 *
 * Every fetch uses `credentials: "include"`, is wrapped in try/catch, and reports
 * failures via a sonner toast + console.error. All step state resets whenever the
 * dialog closes or reopens. Monolith dark, mobile responsive — no native
 * alert/confirm/prompt anywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CreditCard,
  Loader2,
  ScanLine,
  Star,
  Upload,
  UserRound,
  X,
} from "lucide-react";
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
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperSeparator,
  StepperTitle,
} from "@/components/ui/stepper";
import { cn } from "@/lib/utils";

import { OverviewNoteEditor } from "../OverviewNoteEditor";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ContactForm {
  fullName: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
}

const EMPTY_CONTACT: ContactForm = {
  fullName: "",
  title: "",
  company: "",
  phone: "",
  email: "",
  website: "",
  address: "",
};

/** Server response from the business-card extract endpoint. */
interface ExtractCardResponse {
  businessCardFrontUrl?: string | null;
  businessCardBackUrl?: string | null;
  extracted?: Partial<ContactForm> | null;
}

type YesNo = "yes" | "no" | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read a File into a base64 data URL (for JSON transport to the extract API). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function hasAnyContact(c: ContactForm): boolean {
  return Object.values(c).some((v) => v.trim().length > 0);
}

// ─── Star rating ──────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          aria-pressed={value === i}
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange(value === i ? 0 : i)}
          className="rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-amber-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          <Star
            className={cn(
              "size-7 transition-colors",
              i <= active && "fill-amber-400 text-amber-400",
            )}
          />
        </button>
      ))}
      {value > 0 && (
        <span className="ml-2 text-sm text-muted-foreground">{value} / 5</span>
      )}
    </div>
  );
}

// ─── Yes / No pill selector ───────────────────────────────────────────────────

function YesNoChoice({
  value,
  onChange,
}: {
  value: YesNo;
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        variant={value === "yes" ? "default" : "outline"}
        onClick={() => onChange("yes")}
        className="min-w-16"
      >
        Yes
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "no" ? "default" : "outline"}
        onClick={() => onChange("no")}
        className="min-w-16"
      >
        No
      </Button>
    </div>
  );
}

// ─── Business-card upload tile ────────────────────────────────────────────────

function CardUpload({
  label,
  dataUrl,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  dataUrl: string | null;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex-1">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {dataUrl ? (
        <div className="relative overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={`${label} preview`} className="h-32 w-full object-cover" />
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={onClear}
              className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-lg bg-card text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
        >
          <Upload className="size-5" />
          <span className="text-[11px]">Take / upload photo</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          // Allow re-picking the same file later.
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Manual contact form ──────────────────────────────────────────────────────

function ContactFields({
  value,
  onChange,
  disabled,
}: {
  value: ContactForm;
  onChange: (patch: Partial<ContactForm>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rv-fullName">Full name</Label>
          <Input
            id="rv-fullName"
            value={value.fullName}
            disabled={disabled}
            onChange={(e) => onChange({ fullName: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <Label htmlFor="rv-title">Title</Label>
          <Input
            id="rv-title"
            value={value.title}
            disabled={disabled}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Design Consultant"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="rv-company">Company</Label>
        <Input
          id="rv-company"
          value={value.company}
          disabled={disabled}
          onChange={(e) => onChange({ company: e.target.value })}
          placeholder="Showroom / firm name"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rv-phone">Phone</Label>
          <Input
            id="rv-phone"
            value={value.phone}
            disabled={disabled}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="(415) 555-0100"
          />
        </div>
        <div>
          <Label htmlFor="rv-email">Email</Label>
          <Input
            id="rv-email"
            value={value.email}
            disabled={disabled}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="name@showroom.com"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="rv-website">Website</Label>
        <Input
          id="rv-website"
          value={value.website}
          disabled={disabled}
          onChange={(e) => onChange({ website: e.target.value })}
          placeholder="https://…"
        />
      </div>
      <div>
        <Label htmlFor="rv-address">Address</Label>
        <Textarea
          id="rv-address"
          value={value.address}
          disabled={disabled}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder="Street, city, state, zip"
          rows={2}
        />
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function RecordVisitModal({
  showroomId,
  open,
  onOpenChange,
  onSaved,
}: {
  showroomId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [step, setStep] = useState(1);

  // Step 1 — rating.
  const [rating, setRating] = useState(0);
  const [ratingNote, setRatingNote] = useState<{ html: string; markdown: string }>({
    html: "",
    markdown: "",
  });

  // Step 2 — contact branch.
  const [metContact, setMetContact] = useState<YesNo>(null);
  const [gotCard, setGotCard] = useState<YesNo>(null);
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [cardFrontUrl, setCardFrontUrl] = useState<string | null>(null);
  const [cardBackUrl, setCardBackUrl] = useState<string | null>(null);
  const [extractedJson, setExtractedJson] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactForm>({ ...EMPTY_CONTACT });

  // Async flags.
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  const busy = extracting || saving;

  // Reset ALL step state whenever the dialog closes or reopens.
  useEffect(() => {
    if (!open) {
      setStep(1);
      setRating(0);
      setRatingNote({ html: "", markdown: "" });
      setMetContact(null);
      setGotCard(null);
      setFrontImage(null);
      setBackImage(null);
      setCardFrontUrl(null);
      setCardBackUrl(null);
      setExtractedJson(null);
      setContact({ ...EMPTY_CONTACT });
      setExtracting(false);
      setSaving(false);
    }
  }, [open]);

  const updateContact = useCallback((patch: Partial<ContactForm>) => {
    setContact((c) => ({ ...c, ...patch }));
  }, []);

  const handleNoteChange = useCallback(
    (v: { html: string; markdown: string }) => setRatingNote(v),
    [],
  );

  // ── Business-card extraction ────────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!frontImage && !backImage) return;
    setExtracting(true);
    try {
      const res = await fetch(
        `/api/showroom-stores/${showroomId}/pocs/extract-card`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frontImage: frontImage ?? undefined,
            backImage: backImage ?? undefined,
          }),
        },
      );

      if (res.status === 429) {
        toast.error("Card extraction is rate-limited right now. Wait a moment or enter the details by hand.");
        return;
      }

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Extraction failed (${res.status})`);
      }

      const data = (await res.json()) as ExtractCardResponse;
      const ex = data.extracted ?? {};

      // Prefill the form; RETAIN the stored card image URLs for the POC write.
      setContact((c) => ({
        fullName: ex.fullName ?? c.fullName,
        title: ex.title ?? c.title,
        company: ex.company ?? c.company,
        phone: ex.phone ?? c.phone,
        email: ex.email ?? c.email,
        website: ex.website ?? c.website,
        address: ex.address ?? c.address,
      }));
      setCardFrontUrl(data.businessCardFrontUrl ?? null);
      setCardBackUrl(data.businessCardBackUrl ?? null);
      setExtractedJson(JSON.stringify(data.extracted ?? {}));
      toast.success("Business card read — review and edit the details below.");
    } catch (err) {
      console.error("[RecordVisitModal] extract-card failed", err);
      toast.error(err instanceof Error ? err.message : "Failed to extract business card");
    } finally {
      setExtracting(false);
    }
  }, [frontImage, backImage, showroomId]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const willSaveContact = metContact === "yes" && hasAnyContact(contact);
    setSaving(true);
    try {
      // 1) Visit rating (only if a rating was chosen).
      if (rating > 0) {
        const res = await fetch(
          `/api/showroom-stores/${showroomId}/visit-rating`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rating,
              ratingContextHtml: ratingNote.html,
              ratingContextMarkdown: ratingNote.markdown,
            }),
          },
        );
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error((payload.error as string) ?? `Failed to save rating (${res.status})`);
        }
      }

      // 2) Point of contact (only if any contact data exists).
      if (willSaveContact) {
        const res = await fetch(`/api/showroom-stores/${showroomId}/pocs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: contact.fullName || undefined,
            title: contact.title || undefined,
            company: contact.company || undefined,
            phone: contact.phone || undefined,
            email: contact.email || undefined,
            website: contact.website || undefined,
            address: contact.address || undefined,
            businessCardFrontUrl: cardFrontUrl ?? undefined,
            businessCardBackUrl: cardBackUrl ?? undefined,
            extractedJson: extractedJson ?? undefined,
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error((payload.error as string) ?? `Failed to save contact (${res.status})`);
        }
      }

      toast.success("Visit recorded.");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("[RecordVisitModal] save failed", err);
      toast.error(err instanceof Error ? err.message : "Failed to record visit");
    } finally {
      setSaving(false);
    }
  }, [
    metContact,
    contact,
    rating,
    ratingNote,
    showroomId,
    cardFrontUrl,
    cardBackUrl,
    extractedJson,
    onSaved,
    onOpenChange,
  ]);

  // ── Step navigation guards ──────────────────────────────────────────────────
  const canLeaveStep2 =
    metContact === "no" ||
    (metContact === "yes" && gotCard === "no") ||
    (metContact === "yes" && gotCard === "yes");

  const goNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2 && canLeaveStep2) setStep(3);
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  const STEPS: { step: number; title: string }[] = [
    { step: 1, title: "Rating" },
    { step: 2, title: "Contact" },
    { step: 3, title: "Review" },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Record a visit</DialogTitle>
          <DialogDescription>
            Rate this showroom and, if you met someone, capture their contact.
          </DialogDescription>
        </DialogHeader>

        <Stepper steps={3} value={step} onValueChange={setStep} className="space-y-5">
          {/* Stepper header */}
          <StepperList>
            {STEPS.map((s, i) => (
              <StepperItem key={s.step} step={s.step}>
                <StepperIndicator />
                <StepperTitle>{s.title}</StepperTitle>
                {i < STEPS.length - 1 && <StepperSeparator />}
              </StepperItem>
            ))}
          </StepperList>

          {/* ── Step 1 · Rating ── */}
          <StepperContent step={1}>
            <div>
              <Label className="mb-2 block">Your visit rating</Label>
              <StarRating value={rating} onChange={setRating} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Optional — you can record a visit without a rating.
              </p>
            </div>
            <div>
              <Label className="mb-2 block">Notes from this visit</Label>
              <OverviewNoteEditor onChange={handleNoteChange} />
            </div>
          </StepperContent>

          {/* ── Step 2 · Contact ── */}
          <StepperContent step={2}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                <Label className="mb-0">Did you meet a contact person?</Label>
              </div>
              <YesNoChoice
                value={metContact}
                onChange={(v) => {
                  setMetContact(v);
                  if (v === "no") setGotCard(null);
                }}
              />
            </div>

            {metContact === "yes" && (
              <div className="flex flex-col gap-3 rounded-lg bg-card p-3 ring-1 ring-border/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <Label className="mb-0">Did you get a business card?</Label>
                </div>
                <YesNoChoice value={gotCard} onChange={setGotCard} />
              </div>
            )}

            {/* Card branch: upload + extract */}
            {metContact === "yes" && gotCard === "yes" && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <CardUpload
                    label="Front of card"
                    dataUrl={frontImage}
                    onPick={async (file) => setFrontImage(await fileToDataUrl(file))}
                    onClear={() => setFrontImage(null)}
                    disabled={extracting}
                  />
                  <CardUpload
                    label="Back of card"
                    dataUrl={backImage}
                    onPick={async (file) => setBackImage(await fileToDataUrl(file))}
                    onClear={() => setBackImage(null)}
                    disabled={extracting}
                  />
                </div>

                {(frontImage || backImage) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExtract}
                    disabled={extracting}
                    className="w-full gap-2 sm:w-auto"
                  >
                    {extracting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ScanLine className="size-4" />
                    )}
                    {extracting ? "Reading card…" : "Extract business card"}
                  </Button>
                )}

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Review and edit the extracted details:
                  </p>
                  <ContactFields value={contact} onChange={updateContact} disabled={extracting} />
                </div>
              </div>
            )}

            {/* Manual branch */}
            {metContact === "yes" && gotCard === "no" && (
              <ContactFields value={contact} onChange={updateContact} />
            )}
          </StepperContent>

          {/* ── Step 3 · Review ── */}
          <StepperContent step={3}>
            <div className="space-y-4">
              <div className="rounded-lg bg-card p-4 ring-1 ring-border/40">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Rating
                </div>
                {rating > 0 ? (
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={cn(
                          "size-4",
                          i <= rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30",
                        )}
                      />
                    ))}
                    <span className="ml-2 text-sm text-muted-foreground">{rating} / 5</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No rating — visit only.</p>
                )}
              </div>

              <div className="rounded-lg bg-card p-4 ring-1 ring-border/40">
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Contact
                </div>
                {metContact === "yes" && hasAnyContact(contact) ? (
                  <div className="space-y-0.5 text-sm">
                    {contact.fullName && <div className="font-medium">{contact.fullName}</div>}
                    {(contact.title || contact.company) && (
                      <div className="text-muted-foreground">
                        {[contact.title, contact.company].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {contact.phone && <div className="text-muted-foreground">{contact.phone}</div>}
                    {contact.email && <div className="text-muted-foreground">{contact.email}</div>}
                    {(cardFrontUrl || cardBackUrl) && (
                      <div className="mt-1 text-xs text-muted-foreground/70">
                        Business card image attached.
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No contact captured.</p>
                )}
              </div>
            </div>
          </StepperContent>
        </Stepper>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <div>
            {step > 1 && (
              <Button type="button" variant="outline" onClick={goPrev} disabled={busy}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step < 3 ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={busy || (step === 2 && !canLeaveStep2)}
              >
                Next
              </Button>
            ) : (
              <Button type="button" onClick={handleSave} disabled={busy}>
                {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                Save visit
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
