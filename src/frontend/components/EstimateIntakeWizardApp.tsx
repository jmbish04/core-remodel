import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  FileText,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type SourceMode = "pdf" | "photo" | "url" | "free_text" | "audio_transcript";

interface EstimateStatus {
  id: number;
  name: string;
  description: string | null;
}

interface EstimateCompany {
  id: number;
  name: string;
  businessType: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  cslbLicenseNumber: string | null;
}

interface RoomRecord {
  id: number;
  roomName: string;
  displayName?: string;
}

interface LineItemState {
  itemCode: string;
  description: string;
  qty: string;
  uom: string;
  unitCostCents: string;
  lineTotalCents: string;
  taxCents: string;
  notes: string;
}

interface CompanyDraftState {
  name: string;
  businessType: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  cslbLicenseNumber: string;
}

interface FormState {
  estimateType: string;
  businessType: string;
  estimateStatusId: number | null;
  estimateCompanyId: number | null;
  statusNotes: string;
  aiRationale: string;
  dateEstimate: string;
  warrantyDetails: string;
  cancellationDetails: string;
  depositAmountCents: string;
  totalAmountCents: string;
  totalTaxCents: string;
  notes: string;
  lineItems: LineItemState[];
  roomIds: number[];
  createCompany: boolean;
  companyDraft: CompanyDraftState;
}

interface ExtractionPayload {
  estimateType?: string;
  businessType?: string;
  company?: Partial<CompanyDraftState>;
  estimateDate?: string;
  warrantyDetails?: string;
  cancellationDetails?: string;
  depositAmountCents?: number | null;
  totalAmountCents?: number | null;
  totalTaxCents?: number | null;
  notes?: string;
  lineItems?: Array<Partial<LineItemState> & { description: string }>;
}

const STEPS = [
  { id: 1, title: "Source of Estimate" },
  { id: 2, title: "Confirm Details" },
  { id: 3, title: "Review and Submit" },
];

function parseNumber(input: string): number | null {
  if (!input.trim()) return null;
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) ? value : null;
}

function getEmptyLineItem(): LineItemState {
  return {
    itemCode: "",
    description: "",
    qty: "",
    uom: "",
    unitCostCents: "",
    lineTotalCents: "",
    taxCents: "",
    notes: "",
  };
}

function getEmptyCompanyDraft(): CompanyDraftState {
  return {
    name: "",
    businessType: "",
    website: "",
    email: "",
    phone: "",
    address: "",
    cslbLicenseNumber: "",
  };
}

function getInitialFormState(): FormState {
  return {
    estimateType: "",
    businessType: "",
    estimateStatusId: null,
    estimateCompanyId: null,
    statusNotes: "",
    aiRationale: "",
    dateEstimate: "",
    warrantyDetails: "",
    cancellationDetails: "",
    depositAmountCents: "",
    totalAmountCents: "",
    totalTaxCents: "",
    notes: "",
    lineItems: [getEmptyLineItem()],
    roomIds: [],
    createCompany: false,
    companyDraft: getEmptyCompanyDraft(),
  };
}

export function EstimateIntakeWizardApp() {
  const [step, setStep] = useState(1);
  const [sourceMode, setSourceMode] = useState<SourceMode>("pdf");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [audioBase64, setAudioBase64] = useState("");

  const [statuses, setStatuses] = useState<EstimateStatus[]>([]);
  const [companies, setCompanies] = useState<EstimateCompany[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [processingSource, setProcessingSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);

  const [draftRevisionId, setDraftRevisionId] = useState<number | null>(null);
  const [estimateId, setEstimateId] = useState<number | null>(null);
  const [latestExtraction, setLatestExtraction] = useState<ExtractionPayload | null>(null);
  const [formState, setFormState] = useState<FormState>(getInitialFormState());
  const autoSaveTimerRef = useRef<number | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === formState.estimateCompanyId) || null,
    [companies, formState.estimateCompanyId],
  );

  const loadInitialData = useCallback(async () => {
    const [statusRes, companiesRes, roomsRes] = await Promise.all([
      fetch("/api/estimate-statuses"),
      fetch("/api/estimate-companies"),
      fetch("/api/rooms/catalog"),
    ]);

    const statusData = (await statusRes.json()) as { statuses: EstimateStatus[]; error?: string };
    const companyData = (await companiesRes.json()) as {
      companies: EstimateCompany[];
      error?: string;
    };
    const roomsData = (await roomsRes.json()) as {
      rooms: Array<{ id: number; roomName: string; displayName?: string }>;
      error?: string;
    };

    if (!statusRes.ok) throw new Error(statusData.error || "Failed to load estimate statuses");
    if (!companiesRes.ok) throw new Error(companyData.error || "Failed to load estimate companies");
    if (!roomsRes.ok) throw new Error(roomsData.error || "Failed to load rooms catalog");

    setStatuses(statusData.statuses || []);
    setCompanies(companyData.companies || []);
    setRooms(roomsData.rooms || []);

    const reviewing = (statusData.statuses || []).find((status) => status.name === "reviewing");
    setFormState((current) => ({
      ...current,
      estimateStatusId: reviewing?.id || current.estimateStatusId,
    }));
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoadingInitial(true);
      try {
        await loadInitialData();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load estimate intake data");
      } finally {
        setLoadingInitial(false);
      }
    };
    init();
  }, [loadInitialData]);

  const applyExtractionToForm = useCallback((extraction: ExtractionPayload) => {
    setFormState((current) => ({
      ...current,
      estimateType: extraction.estimateType || current.estimateType,
      businessType: extraction.businessType || current.businessType,
      dateEstimate:
        typeof extraction.estimateDate === "string" && extraction.estimateDate
          ? extraction.estimateDate.slice(0, 10)
          : current.dateEstimate,
      warrantyDetails: extraction.warrantyDetails || current.warrantyDetails,
      cancellationDetails: extraction.cancellationDetails || current.cancellationDetails,
      depositAmountCents:
        typeof extraction.depositAmountCents === "number"
          ? String(extraction.depositAmountCents)
          : current.depositAmountCents,
      totalAmountCents:
        typeof extraction.totalAmountCents === "number"
          ? String(extraction.totalAmountCents)
          : current.totalAmountCents,
      totalTaxCents:
        typeof extraction.totalTaxCents === "number"
          ? String(extraction.totalTaxCents)
          : current.totalTaxCents,
      notes: extraction.notes || current.notes,
      lineItems:
        Array.isArray(extraction.lineItems) && extraction.lineItems.length > 0
          ? extraction.lineItems.map((item) => ({
              itemCode: item.itemCode || "",
              description: item.description || "",
              qty: item.qty ? String(item.qty) : "",
              uom: item.uom || "",
              unitCostCents:
                typeof item.unitCostCents === "number" ? String(item.unitCostCents) : "",
              lineTotalCents:
                typeof item.lineTotalCents === "number" ? String(item.lineTotalCents) : "",
              taxCents: typeof item.taxCents === "number" ? String(item.taxCents) : "",
              notes: item.notes || "",
            }))
          : current.lineItems,
      createCompany: extraction.company?.name ? true : current.createCompany,
      companyDraft: extraction.company?.name
        ? {
            name: extraction.company.name || "",
            businessType: extraction.company.businessType || "",
            website: extraction.company.website || "",
            email: extraction.company.email || "",
            phone: extraction.company.phone || "",
            address: extraction.company.address || "",
            cslbLicenseNumber: extraction.company.cslbLicenseNumber || "",
          }
        : current.companyDraft,
    }));
  }, []);

  const processSource = useCallback(async () => {
    if (!sourceMode) {
      toast.error("Select a source mode");
      return;
    }

    if ((sourceMode === "pdf" || sourceMode === "photo") && !sourceFile) {
      toast.error("Upload a file to continue");
      return;
    }
    if (sourceMode === "url" && !sourceUrl.trim()) {
      toast.error("Enter a source URL");
      return;
    }
    if (sourceMode === "free_text" && !sourceText.trim()) {
      toast.error("Enter verbal/text estimate details");
      return;
    }
    if (sourceMode === "audio_transcript" && !audioBase64.trim()) {
      toast.error("Provide audio base64 payload for transcription");
      return;
    }

    setProcessingSource(true);
    try {
      let response: Response;
      if ((sourceMode === "pdf" || sourceMode === "photo") && sourceFile) {
        const form = new FormData();
        form.append("sourceType", sourceMode);
        form.append("file", sourceFile);
        if (draftRevisionId) {
          form.append("draftRevisionId", String(draftRevisionId));
        }
        response = await fetch("/api/estimates/intake/source", {
          method: "POST",
          body: form,
        });
      } else {
        response = await fetch("/api/estimates/intake/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: sourceMode,
            sourceUrl: sourceMode === "url" ? sourceUrl.trim() : null,
            freeText: sourceMode === "free_text" ? sourceText.trim() : null,
            audioBase64: sourceMode === "audio_transcript" ? audioBase64.trim() : null,
            draftRevisionId,
          }),
        });
      }

      const data = (await response.json()) as {
        success?: boolean;
        estimateId?: number;
        draftRevisionId?: number;
        extracted?: ExtractionPayload;
        error?: string;
      };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to process source");
      }
      if (typeof data.estimateId === "number") setEstimateId(data.estimateId);
      if (typeof data.draftRevisionId === "number") setDraftRevisionId(data.draftRevisionId);
      if (data.extracted) {
        setLatestExtraction(data.extracted);
        applyExtractionToForm(data.extracted);
      }
      toast.success("Source processed and extraction completed");
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to process source");
    } finally {
      setProcessingSource(false);
    }
  }, [
    applyExtractionToForm,
    audioBase64,
    draftRevisionId,
    sourceFile,
    sourceMode,
    sourceText,
    sourceUrl,
  ]);

  const autosaveDraft = useCallback(
    async (payload: Partial<FormState>) => {
      if (!draftRevisionId) return;
      setAutoSaving(true);
      try {
        const response = await fetch(`/api/estimates/drafts/${draftRevisionId}/autosave`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimateCompanyId: payload.estimateCompanyId ?? formState.estimateCompanyId,
            estimateStatusId: payload.estimateStatusId ?? formState.estimateStatusId,
            statusNotes: payload.statusNotes ?? formState.statusNotes,
            aiRationale: payload.aiRationale ?? formState.aiRationale,
            wizardState: {
              step,
              sourceMode,
              estimateId,
              draftRevisionId,
              formState: {
                ...formState,
                ...payload,
              },
            },
          }),
        });
        const data = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Autosave failed");
        }
        setLastAutoSavedAt(new Date().toLocaleTimeString());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Autosave failed");
      } finally {
        setAutoSaving(false);
      }
    },
    [draftRevisionId, estimateId, formState, sourceMode, step],
  );

  useEffect(() => {
    if (!draftRevisionId) return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      void autosaveDraft(formState);
    }, 1200);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autosaveDraft, draftRevisionId, formState]);

  const submit = useCallback(async () => {
    if (!draftRevisionId) {
      toast.error("No draft revision available to submit");
      return;
    }
    setSubmitting(true);
    try {
      let companyId = formState.estimateCompanyId;
      if (formState.createCompany) {
        if (!formState.companyDraft.name.trim()) {
          throw new Error("Company name is required when creating a new company");
        }
        const createCompanyResponse = await fetch("/api/estimate-companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formState.companyDraft.name.trim(),
            businessType: formState.companyDraft.businessType.trim() || "unknown",
            website: formState.companyDraft.website.trim() || null,
            email: formState.companyDraft.email.trim() || null,
            phone: formState.companyDraft.phone.trim() || null,
            address: formState.companyDraft.address.trim() || null,
            cslbLicenseNumber: formState.companyDraft.cslbLicenseNumber.trim() || null,
          }),
        });
        const companyData = (await createCompanyResponse.json()) as {
          company?: EstimateCompany;
          error?: string;
        };
        if (!createCompanyResponse.ok || !companyData.company) {
          throw new Error(companyData.error || "Failed to create estimate company");
        }
        companyId = companyData.company.id;
      }

      const response = await fetch("/api/estimates/intake/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftRevisionId,
          estimateCompanyId: companyId,
          estimateStatusId: formState.estimateStatusId,
          statusNotes: formState.statusNotes.trim() || null,
          aiRationale: formState.aiRationale.trim() || null,
          dateEstimate: formState.dateEstimate || null,
          warrantyDetails: formState.warrantyDetails.trim() || null,
          cancellationDetails: formState.cancellationDetails.trim() || null,
          depositAmountCents: parseNumber(formState.depositAmountCents),
          totalAmountCents: parseNumber(formState.totalAmountCents),
          totalTaxCents: parseNumber(formState.totalTaxCents),
          lineItems: formState.lineItems
            .filter((item) => item.description.trim().length > 0)
            .map((item) => ({
              itemCode: item.itemCode.trim() || null,
              description: item.description.trim(),
              qty: item.qty.trim() ? Number(item.qty) : null,
              uom: item.uom.trim() || null,
              unitCostCents: parseNumber(item.unitCostCents),
              lineTotalCents: parseNumber(item.lineTotalCents),
              taxCents: parseNumber(item.taxCents),
              notes: item.notes.trim() || null,
            })),
          roomIds: formState.roomIds,
          propValues: latestExtraction
            ? Object.entries(latestExtraction)
                .filter(([key]) => key !== "lineItems" && key !== "company")
                .map(([property, value]) => ({
                  property,
                  intakeFormValue: JSON.stringify(value),
                }))
            : [],
          submit: true,
        }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to submit estimate");
      }
      toast.success("Estimate submitted successfully");
      window.location.href = "/admin/estimates";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit estimate");
    } finally {
      setSubmitting(false);
    }
  }, [draftRevisionId, formState, latestExtraction]);

  const handleLineItemChange = useCallback(
    (index: number, key: keyof LineItemState, value: string) => {
      setFormState((current) => ({
        ...current,
        lineItems: current.lineItems.map((lineItem, lineIndex) =>
          lineIndex === index
            ? {
                ...lineItem,
                [key]: value,
              }
            : lineItem,
        ),
      }));
    },
    [],
  );

  if (loadingInitial) {
    return (
      <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading estimate intake...
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-4">
        <a href="/admin/estimates">
          <Button variant="outline" className="w-full justify-start">
            <ArrowLeft className="mr-2 size-4" />
            Back to Estimates
          </Button>
        </a>
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Intake Steps</CardTitle>
            <CardDescription>
              Follow the wizard to capture and submit estimate details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {STEPS.map((stepItem) => (
              <button
                key={stepItem.id}
                type="button"
                onClick={() => setStep(stepItem.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                  step === stepItem.id
                    ? "bg-primary/20 ring-1 ring-primary/40"
                    : "bg-muted/20 hover:bg-muted/30"
                }`}
              >
                {step > stepItem.id ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <CircleDot className="size-4 text-muted-foreground" />
                )}
                <span>{stepItem.title}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="ring-1 ring-border/40">
          <CardContent className="space-y-1 p-3 text-xs text-muted-foreground">
            <p>
              Draft revision:{" "}
              <span className="font-medium text-foreground">
                {draftRevisionId || "Not created yet"}
              </span>
            </p>
            <p>
              Autosave:{" "}
              <span className="font-medium text-foreground">
                {autoSaving
                  ? "Saving..."
                  : lastAutoSavedAt
                    ? `Saved at ${lastAutoSavedAt}`
                    : "Waiting"}
              </span>
            </p>
          </CardContent>
        </Card>
      </aside>

      <div className="space-y-6">
        {step === 1 ? (
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle>1) Source of Estimate</CardTitle>
              <CardDescription>
                Choose one source mode. The source will be processed and AI extraction will prefill
                step 2.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2 md:grid-cols-2">
                <label className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={sourceMode === "pdf"}
                    onChange={() => setSourceMode("pdf")}
                    className="mr-2"
                  />
                  I have an estimate document (PDF)
                </label>
                <label className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={sourceMode === "photo"}
                    onChange={() => setSourceMode("photo")}
                    className="mr-2"
                  />
                  I have a photo/screenshot of estimate details
                </label>
                <label className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={sourceMode === "url"}
                    onChange={() => setSourceMode("url")}
                    className="mr-2"
                  />
                  I have a URL
                </label>
                <label className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={sourceMode === "free_text"}
                    onChange={() => setSourceMode("free_text")}
                    className="mr-2"
                  />
                  Word of mouth / verbal (manual text)
                </label>
                <label className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={sourceMode === "audio_transcript"}
                    onChange={() => setSourceMode("audio_transcript")}
                    className="mr-2"
                  />
                  Audio transcript (Whisper input)
                </label>
              </div>

              {(sourceMode === "pdf" || sourceMode === "photo") && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Upload source file</p>
                  <Input
                    type="file"
                    accept={sourceMode === "pdf" ? "application/pdf" : "image/*,application/pdf"}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setSourceFile(file || null);
                    }}
                  />
                </div>
              )}

              {sourceMode === "url" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Source URL</p>
                  <Input
                    placeholder="https://vendor.example.com/estimate"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                </div>
              )}

              {sourceMode === "free_text" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Verbal details</p>
                  <Textarea
                    rows={7}
                    placeholder="Paste your notes from phone call or verbal estimate details..."
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                </div>
              )}

              {sourceMode === "audio_transcript" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Audio base64 payload</p>
                  <Textarea
                    rows={6}
                    placeholder="Paste base64 audio payload for Whisper transcription..."
                    value={audioBase64}
                    onChange={(event) => setAudioBase64(event.target.value)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={processSource} disabled={processingSource}>
                  {processingSource ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Processing
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 size-4" />
                      Process and Prefill
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle>2) Confirm Estimate Details</CardTitle>
              <CardDescription>
                Review AI extraction output and confirm the fields before submission.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Type of estimate / business type</p>
                  <Input
                    value={formState.businessType}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, businessType: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Estimate status</p>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formState.estimateStatusId || ""}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        estimateStatusId: event.target.value ? Number(event.target.value) : null,
                      }))
                    }
                  >
                    <option value="">Select status</option>
                    {statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name} — {status.description || "no description"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <p className="text-sm font-medium">Company</p>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formState.estimateCompanyId || ""}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        estimateCompanyId: event.target.value ? Number(event.target.value) : null,
                        createCompany: false,
                      }))
                    }
                  >
                    <option value="">Select existing company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name} ({company.businessType})
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={formState.createCompany}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          createCompany: event.target.checked,
                          estimateCompanyId: event.target.checked
                            ? null
                            : current.estimateCompanyId,
                        }))
                      }
                    />
                    Create a new company from this intake
                  </label>
                </div>
              </div>

              {formState.createCompany ? (
                <Card className="ring-1 ring-border/40">
                  <CardHeader>
                    <CardTitle className="text-base">New Company Details</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <Input
                      placeholder="Company name"
                      value={formState.companyDraft.name}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: { ...current.companyDraft, name: event.target.value },
                        }))
                      }
                    />
                    <Input
                      placeholder="Business type"
                      value={formState.companyDraft.businessType}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: {
                            ...current.companyDraft,
                            businessType: event.target.value,
                          },
                        }))
                      }
                    />
                    <Input
                      placeholder="Website"
                      value={formState.companyDraft.website}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: { ...current.companyDraft, website: event.target.value },
                        }))
                      }
                    />
                    <Input
                      placeholder="Email"
                      value={formState.companyDraft.email}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: { ...current.companyDraft, email: event.target.value },
                        }))
                      }
                    />
                    <Input
                      placeholder="Phone"
                      value={formState.companyDraft.phone}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: { ...current.companyDraft, phone: event.target.value },
                        }))
                      }
                    />
                    <Input
                      placeholder="CSLB license number"
                      value={formState.companyDraft.cslbLicenseNumber}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          companyDraft: {
                            ...current.companyDraft,
                            cslbLicenseNumber: event.target.value,
                          },
                        }))
                      }
                    />
                    <div className="md:col-span-2">
                      <Input
                        placeholder="Address"
                        value={formState.companyDraft.address}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            companyDraft: { ...current.companyDraft, address: event.target.value },
                          }))
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : selectedCompany ? (
                <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground">
                  Selected company:{" "}
                  <span className="font-medium text-foreground">{selectedCompany.name}</span>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Estimate date</p>
                  <Input
                    type="date"
                    value={formState.dateEstimate}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, dateEstimate: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Total amount (cents)</p>
                  <Input
                    value={formState.totalAmountCents}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        totalAmountCents: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Total tax (cents)</p>
                  <Input
                    value={formState.totalTaxCents}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, totalTaxCents: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Textarea
                  rows={4}
                  placeholder="Warranty details"
                  value={formState.warrantyDetails}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, warrantyDetails: event.target.value }))
                  }
                />
                <Textarea
                  rows={4}
                  placeholder="Cancellation details"
                  value={formState.cancellationDetails}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      cancellationDetails: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Line items</p>
                <div className="space-y-2">
                  {formState.lineItems.map((lineItem, index) => (
                    <div
                      key={`${index}-${lineItem.description}`}
                      className="rounded-md border border-border/40 bg-muted/20 p-3"
                    >
                      <div className="grid gap-2 md:grid-cols-4">
                        <Input
                          placeholder="Code"
                          value={lineItem.itemCode}
                          onChange={(event) =>
                            handleLineItemChange(index, "itemCode", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Description"
                          value={lineItem.description}
                          onChange={(event) =>
                            handleLineItemChange(index, "description", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Qty"
                          value={lineItem.qty}
                          onChange={(event) =>
                            handleLineItemChange(index, "qty", event.target.value)
                          }
                        />
                        <Input
                          placeholder="UOM"
                          value={lineItem.uom}
                          onChange={(event) =>
                            handleLineItemChange(index, "uom", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Unit cents"
                          value={lineItem.unitCostCents}
                          onChange={(event) =>
                            handleLineItemChange(index, "unitCostCents", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Line total cents"
                          value={lineItem.lineTotalCents}
                          onChange={(event) =>
                            handleLineItemChange(index, "lineTotalCents", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Tax cents"
                          value={lineItem.taxCents}
                          onChange={(event) =>
                            handleLineItemChange(index, "taxCents", event.target.value)
                          }
                        />
                        <Input
                          placeholder="Notes"
                          value={lineItem.notes}
                          onChange={(event) =>
                            handleLineItemChange(index, "notes", event.target.value)
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFormState((current) => ({
                      ...current,
                      lineItems: [...current.lineItems, getEmptyLineItem()],
                    }))
                  }
                >
                  Add line item
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Room mappings</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {rooms.map((room) => (
                    <label
                      key={room.id}
                      className="inline-flex items-center gap-2 rounded border border-border/40 bg-muted/20 px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={formState.roomIds.includes(room.id)}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            roomIds: event.target.checked
                              ? Array.from(new Set([...current.roomIds, room.id]))
                              : current.roomIds.filter((value) => value !== room.id),
                          }))
                        }
                      />
                      {room.displayName || room.roomName}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Status notes</p>
                <Textarea
                  rows={4}
                  value={formState.statusNotes}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, statusNotes: event.target.value }))
                  }
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle>3) Review, Confirm, Submit</CardTitle>
              <CardDescription>Verify the intake summary before final submission.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-md border border-border/40 bg-muted/20 p-3">
                <p className="font-medium">
                  Estimate #{estimateId || "new"} · Draft revision #{draftRevisionId || "pending"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Business type: {formState.businessType || "—"} · Status ID:{" "}
                  {formState.estimateStatusId || "—"}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-border/40 bg-card/50 p-3">
                  <p className="text-xs text-muted-foreground">Total amount (cents)</p>
                  <p className="font-medium">{formState.totalAmountCents || "—"}</p>
                </div>
                <div className="rounded-md border border-border/40 bg-card/50 p-3">
                  <p className="text-xs text-muted-foreground">Total tax (cents)</p>
                  <p className="font-medium">{formState.totalTaxCents || "—"}</p>
                </div>
                <div className="rounded-md border border-border/40 bg-card/50 p-3">
                  <p className="text-xs text-muted-foreground">Deposit (cents)</p>
                  <p className="font-medium">{formState.depositAmountCents || "—"}</p>
                </div>
              </div>
              <div className="rounded-md border border-border/40 bg-card/50 p-3">
                <p className="text-xs text-muted-foreground">Company</p>
                <p className="font-medium">
                  {formState.createCompany
                    ? formState.companyDraft.name || "New company"
                    : selectedCompany?.name || "Unassigned"}
                </p>
              </div>
              <div className="rounded-md border border-border/40 bg-card/50 p-3">
                <p className="text-xs text-muted-foreground">Line items</p>
                <p className="font-medium">
                  {formState.lineItems.filter((item) => item.description.trim().length > 0).length}
                </p>
              </div>
              <div className="rounded-md border border-border/40 bg-card/50 p-3">
                <p className="text-xs text-muted-foreground">Status notes</p>
                <p>{formState.statusNotes || "—"}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={step === 1}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((current) => Math.min(3, current + 1))}
              disabled={step === 1 && processingSource}
            >
              Next
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => autosaveDraft(formState)}
            disabled={!draftRevisionId || autoSaving}
          >
            {autoSaving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving
              </>
            ) : (
              <>
                <Save className="mr-2 size-4" />
                Save Draft
              </>
            )}
          </Button>
          <Button onClick={submit} disabled={!draftRevisionId || submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Submitting
              </>
            ) : (
              <>
                <FileText className="mr-2 size-4" />
                Submit Estimate
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
