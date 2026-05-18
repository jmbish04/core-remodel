import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  DollarSign,
  FileText,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  Sparkles,
  StopCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GridBento } from "@/components/ui/grid-bento";
import { ImageGallery, type ImageGalleryItem } from "@/components/ui/image-gallery";
import { ImageGalleryMasonry } from "@/components/ui/image-gallery-masonry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MediaKind = "listing" | "inspiration";
type MediaViewMode = "bento" | "gallery" | "masonry" | "list";

interface RoomSummaryObject {
  overview?: string;
  renovationStory?: string;
  budgetSnapshot?: string;
  taskFocus?: string[];
  decisionPoints?: string[];
  supportingSignals?: string[];
}

interface RoomImage {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomType?: string | null;
  metadata?: string | null;
  datetimeCreated?: string | number | Date | null;
}

interface RoomSummaryRecord {
  representativeImageId?: string | null;
  summaryMarkdown?: string | null;
  summaryObject?: RoomSummaryObject | null;
  lastUserPrompt?: string | null;
  lastVoiceTranscript?: string | null;
  datetimeGenerated?: string | number | Date | null;
}

interface SupportingDocumentRecord {
  id: string;
  title: string;
  sourceType: string;
  r2Url?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  roomLabels?: string[];
  visionNodeTitles?: string[];
  datetimeUpdated?: string | number | Date | null;
}

interface ActionItemRecord {
  id: string;
  category: string;
  title: string;
  details?: string | null;
  status: string;
  priority: number;
  estimatedCostCents?: number | null;
}

interface ScenarioPlanRecord {
  id: string;
  scenarioName: string;
  proposedUse: string;
  stage: string;
  estimatedCostCents?: number | null;
  notes?: string | null;
}

interface BudgetItemRecord {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  executionClass: string;
  estimatedLowCents?: number | null;
  estimatedHighCents?: number | null;
}

interface EstimateRecord {
  id: number;
  estimateId: number;
  revisionNumber: number;
  companyName?: string | null;
  statusName?: string | null;
  totalAmountCents?: number | null;
  sourceSummary?: string | null;
  datetimeUpdated?: string | number | Date | null;
}

interface VisionNodeRecord {
  id: string;
  title: string;
  summary?: string | null;
  status: string;
  nodeType: string;
  estimatedCostCents?: number | null;
  childCount: number;
  supportingDocumentIds: string[];
}

interface RoomDetailPayload {
  room: {
    id: number;
    roomCode: string;
    roomName: string;
    displayName: string;
    floorKey: string;
    floorName: string;
    asIsUse?: string | null;
    generalNotes?: string | null;
    problemAreas?: string | null;
    dimensionLabel?: string | null;
  };
  summary: RoomSummaryRecord | null;
  representativeImage: RoomImage | null;
  listingImages: RoomImage[];
  inspirationalImages: RoomImage[];
  supportingDocuments: SupportingDocumentRecord[];
  actionItems: ActionItemRecord[];
  scenarioPlans: ScenarioPlanRecord[];
  budget: {
    items: BudgetItemRecord[];
    totalBudgetLowCents: number;
    totalBudgetHighCents: number;
  };
  estimates: EstimateRecord[];
  visionNodes: VisionNodeRecord[];
  roomStats: {
    listingPhotoCount: number;
    inspirationPhotoCount: number;
    supportingDocumentCount: number;
    actionItemCount: number;
    visionNodeCount: number;
    estimateCount: number;
  };
}

function resolveImageUrl(image: RoomImage): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

function formatCurrency(valueCents: number | null | undefined): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return "n/a";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to encode audio note"));
        return;
      }
      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio note"));
    reader.readAsDataURL(blob);
  });
}

function MediaList(props: { items: ImageGalleryItem[] }) {
  const { items } = props;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/60 p-3 md:flex-row">
          {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
          <img
            src={item.src}
            alt={item.alt || item.title || item.id}
            className="h-40 w-full rounded-lg object-cover md:w-56"
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{item.title || "Photo"}</p>
              {item.badge ? <Badge variant="secondary">{item.badge}</Badge> : null}
            </div>
            {item.subtitle ? (
              <p className="text-sm text-muted-foreground">{item.subtitle}</p>
            ) : null}
            {item.tags && item.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <span key={`${item.id}-${tag}`} className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RoomViewApp(props: { roomCode: string }) {
  const { roomCode } = props;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<RoomDetailPayload | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [representativeImageId, setRepresentativeImageId] = useState<string>("none");
  const [savingRepresentative, setSavingRepresentative] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>("listing");
  const [mediaView, setMediaView] = useState<MediaViewMode>("bento");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const loadData = useCallback(async (setLoadingState: boolean) => {
    if (setLoadingState) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [detailRes, accessRes] = await Promise.all([
        fetch(`/api/rooms/code/${roomCode}/detail`),
        fetch("/api/access/status", { credentials: "include" }),
      ]);

      const detailPayload = (await detailRes.json()) as
        | ({ success?: boolean } & RoomDetailPayload)
        | { error?: string };
      const accessPayload = (await accessRes.json()) as {
        success?: boolean;
        authenticated?: boolean;
      };

      if (!detailRes.ok || !("success" in detailPayload) || !detailPayload.success) {
        throw new Error(("error" in detailPayload && detailPayload.error) || "Failed to load room");
      }

      setDetail(detailPayload);
      setRepresentativeImageId(
        detailPayload.summary?.representativeImageId ||
          detailPayload.representativeImage?.id ||
          "none",
      );
      if (accessRes.ok && accessPayload.success) {
        setAccessAuthenticated(Boolean(accessPayload.authenticated));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load room");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [roomCode]);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const currentMedia = useMemo(() => {
    const source = mediaKind === "listing" ? detail?.listingImages || [] : detail?.inspirationalImages || [];
    return source.map((image) => ({
      id: image.id,
      src: resolveImageUrl(image),
      title: image.displayName?.trim() || detail?.room.displayName || "Photo",
      subtitle: formatDate(image.datetimeCreated),
      badge: mediaKind === "listing" ? "Listing" : "Inspiration",
    })) as ImageGalleryItem[];
  }, [detail, mediaKind]);

  const summaryObject = detail?.summary?.summaryObject || null;

  const startVoiceNote = useCallback(async () => {
    if (!canRecord || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice recording is not available in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          const base64 = await blobToBase64(blob);
          setAudioBase64(base64);
          setAudioHint("Voice note ready for the next summary refresh.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to prepare voice note");
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          recorderRef.current = null;
          chunksRef.current = [];
          setIsRecording(false);
        }
      };

      recorder.start();
      setAudioHint("Recording voice note...");
      setIsRecording(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start voice note");
    }
  }, [canRecord]);

  const stopVoiceNote = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const saveRepresentative = useCallback(async () => {
    if (!detail) return;
    setSavingRepresentative(true);
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          representativeImageId: representativeImageId === "none" ? null : representativeImageId,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        summary?: RoomSummaryRecord | null;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save representative photo");
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              summary: payload.summary || current.summary,
            }
          : current,
      );
      toast.success("Representative photo updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save representative photo");
    } finally {
      setSavingRepresentative(false);
    }
  }, [detail, representativeImageId, roomCode]);

  const regenerateSummary = useCallback(async () => {
    if (!detail) return;
    setRegenerating(true);
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}/summary`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: summaryPrompt.trim() || null,
          audioBase64,
          representativeImageId: representativeImageId === "none" ? null : representativeImageId,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        summary?: RoomSummaryRecord | null;
        voiceTranscript?: string | null;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to regenerate room summary");
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              summary: payload.summary || current.summary,
            }
          : current,
      );
      setAudioBase64(null);
      setAudioHint(payload.voiceTranscript ? `Whisper note: ${payload.voiceTranscript}` : "");
      toast.success("Room summary refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate room summary");
    } finally {
      setRegenerating(false);
    }
  }, [audioBase64, detail, representativeImageId, roomCode, summaryPrompt]);

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading room view...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
        <p className="text-lg font-semibold">Room not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested room slug does not match the current floorplan catalog.
        </p>
      </div>
    );
  }

  const heroImage = detail.representativeImage || detail.listingImages[0] || detail.inspirationalImages[0] || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-3">
          <a
            href="/floor-plan"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to floor plan
          </a>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">{detail.room.displayName}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {detail.room.floorName} • {detail.room.asIsUse || "Room"} • {detail.room.dimensionLabel || "Dimensions pending"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{detail.roomStats.listingPhotoCount} listing photos</Badge>
            <Badge variant="secondary">{detail.roomStats.inspirationPhotoCount} inspiration photos</Badge>
            <Badge variant="secondary">{detail.roomStats.supportingDocumentCount} supporting docs</Badge>
            <Badge variant="secondary">{detail.roomStats.visionNodeCount} vision nodes</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="overflow-hidden ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Representative Photo</CardTitle>
            <CardDescription>Configurable room hero image pulled from listing photos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {heroImage ? (
              <div className="overflow-hidden rounded-2xl border border-border/60">
                {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                <img
                  src={resolveImageUrl(heroImage)}
                  alt={heroImage.displayName || detail.room.displayName}
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-16 text-center">
                <ImageIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No representative image is available yet.</p>
              </div>
            )}

            {accessAuthenticated ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <Select value={representativeImageId} onValueChange={setRepresentativeImageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a room photo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto-select first room photo</SelectItem>
                    {detail.listingImages.map((image) => (
                      <SelectItem key={image.id} value={image.id}>
                        {image.displayName?.trim() || formatDate(image.datetimeCreated)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => void saveRepresentative()} disabled={savingRepresentative}>
                  {savingRepresentative ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Homeowner access is required to change the representative photo.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Room Overview</CardTitle>
            <CardDescription>Stored Worker AI summary plus room-specific context</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {summaryObject ? (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Overview
                  </p>
                  <p className="text-sm leading-7 text-foreground/90">{summaryObject.overview}</p>
                </div>
                {summaryObject.renovationStory ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Renovation Story
                    </p>
                    <p className="text-sm leading-7 text-muted-foreground">{summaryObject.renovationStory}</p>
                  </div>
                ) : null}
                {summaryObject.budgetSnapshot ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Budget Snapshot
                    </p>
                    <p className="text-sm leading-7 text-muted-foreground">{summaryObject.budgetSnapshot}</p>
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Task Focus
                    </p>
                    <div className="space-y-2">
                      {(summaryObject.taskFocus || []).map((item) => (
                        <p key={item} className="text-sm text-muted-foreground">{item}</p>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Decision Points
                    </p>
                    <div className="space-y-2">
                      {(summaryObject.decisionPoints || []).map((item) => (
                        <p key={item} className="text-sm text-muted-foreground">{item}</p>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Supporting Signals
                    </p>
                    <div className="space-y-2">
                      {(summaryObject.supportingSignals || []).map((item) => (
                        <p key={item} className="text-sm text-muted-foreground">{item}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : detail.summary?.summaryMarkdown ? (
              <pre className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm leading-7 text-muted-foreground">
                {detail.summary.summaryMarkdown}
              </pre>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center">
                <Sparkles className="mx-auto mb-3 size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No stored room summary exists yet. Generate one once and it will stay cached in D1.
                </p>
              </div>
            )}

            {detail.room.generalNotes || detail.room.problemAreas ? (
              <div className="grid gap-4 md:grid-cols-2">
                {detail.room.generalNotes ? (
                  <div className="rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Existing Notes
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.room.generalNotes}</p>
                  </div>
                ) : null}
                {detail.room.problemAreas ? (
                  <div className="rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Problem Areas
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.room.problemAreas}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Refresh AI Summary</CardTitle>
          <CardDescription>
            Add missing context before rerunning the room summary. Voice notes are transcribed with Whisper and stored with the refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={summaryPrompt}
            onChange={(event) => setSummaryPrompt(event.target.value)}
            placeholder="Tell the room summary what it is missing. Example: include the four kitchen options, note the downstairs-left vs downstairs-right move, and mention that the budget is still provisional."
            rows={4}
          />
          <div className="flex flex-wrap items-center gap-3">
            {accessAuthenticated ? (
              <>
                <Button
                  type="button"
                  variant={isRecording ? "destructive" : "outline"}
                  onClick={() => void (isRecording ? stopVoiceNote() : startVoiceNote())}
                >
                  {isRecording ? (
                    <StopCircle className="mr-2 size-4" />
                  ) : (
                    <Mic className="mr-2 size-4" />
                  )}
                  {isRecording ? "Stop Voice Note" : "Record Voice Note"}
                </Button>
                <Button onClick={() => void regenerateSummary()} disabled={regenerating}>
                  {regenerating ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 size-4" />
                  )}
                  Refresh Room Summary
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Homeowner access is required to refresh the stored AI summary.
              </p>
            )}
          </div>
          {audioHint ? <p className="text-xs text-muted-foreground">{audioHint}</p> : null}
          {detail.summary?.lastUserPrompt ? (
            <p className="text-xs text-muted-foreground">
              Last correction prompt: {detail.summary.lastUserPrompt}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Room Options</CardTitle>
            <CardDescription>
              Scenario plans and vision-node batches that change what happens in this room
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.scenarioPlans.length === 0 && detail.visionNodes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No room options are linked yet.
              </div>
            ) : null}

            {detail.scenarioPlans.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Scenario Plans
                </p>
                {detail.scenarioPlans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{plan.proposedUse}</p>
                        <p className="text-xs text-muted-foreground">{plan.scenarioName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{plan.stage}</Badge>
                        {typeof plan.estimatedCostCents === "number" ? (
                          <Badge variant="outline">{formatCurrency(plan.estimatedCostCents)}</Badge>
                        ) : null}
                      </div>
                    </div>
                    {plan.notes ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{plan.notes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {detail.visionNodes.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Vision Nodes
                </p>
                {detail.visionNodes.map((node) => (
                  <div key={node.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{node.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {node.nodeType} • {node.status}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{node.childCount} children</Badge>
                        <Badge variant="secondary">{node.supportingDocumentIds.length} docs</Badge>
                        {typeof node.estimatedCostCents === "number" ? (
                          <Badge variant="outline">{formatCurrency(node.estimatedCostCents)}</Badge>
                        ) : null}
                      </div>
                    </div>
                    {node.summary ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{node.summary}</p>
                    ) : null}
                    <a
                      href={`/supporting-docs?roomId=${detail.room.id}&visionNodeId=${node.id}`}
                      className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      View branch in project records
                      <ArrowUpRight className="size-4" />
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Budget Signals</CardTitle>
              <CardDescription>Budget tracker rows and room-specific cost ranges</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Room Range</p>
                  <p className="mt-2 text-lg font-semibold">
                    {detail.budget.items.length > 0
                      ? `${formatCurrency(detail.budget.totalBudgetLowCents)} - ${formatCurrency(detail.budget.totalBudgetHighCents)}`
                      : "No range yet"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimate Count</p>
                  <p className="mt-2 text-lg font-semibold">{detail.estimates.length}</p>
                </div>
              </div>
              {detail.budget.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No budget tracker items are linked to this room yet.</p>
              ) : (
                detail.budget.items.slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.executionClass} • {item.status}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {formatCurrency(item.estimatedLowCents)} - {formatCurrency(item.estimatedHighCents)}
                      </Badge>
                    </div>
                    {item.description ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Estimates and Tasks</CardTitle>
              <CardDescription>Recent estimate revisions plus known room action items</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Estimate Revisions
                </p>
                {detail.estimates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No estimate revisions are linked yet.</p>
                ) : (
                  detail.estimates.slice(0, 5).map((estimate) => (
                    <div key={`${estimate.estimateId}-${estimate.id}`} className="rounded-xl border border-border/60 bg-card/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{estimate.companyName || "Estimate"}</p>
                          <p className="text-xs text-muted-foreground">
                            Revision {estimate.revisionNumber} • {estimate.statusName || "Status pending"}
                          </p>
                        </div>
                        {typeof estimate.totalAmountCents === "number" ? (
                          <Badge variant="outline">{formatCurrency(estimate.totalAmountCents)}</Badge>
                        ) : null}
                      </div>
                      {estimate.sourceSummary ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{estimate.sourceSummary}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Action Items
                </p>
                {detail.actionItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No room action items are stored yet.</p>
                ) : (
                  detail.actionItems.slice(0, 6).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.category} • {item.status} • priority {item.priority}
                          </p>
                        </div>
                        {typeof item.estimatedCostCents === "number" ? (
                          <Badge variant="outline">{formatCurrency(item.estimatedCostCents)}</Badge>
                        ) : null}
                      </div>
                      {item.details ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.details}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Room Media</CardTitle>
              <CardDescription>Switch between listing and inspiration, then choose the layout that reads best</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-1">
                <button
                  type="button"
                  className={cn(
                    "rounded px-3 py-1.5 text-xs font-medium",
                    mediaKind === "listing" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => setMediaKind("listing")}
                >
                  Listing
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-3 py-1.5 text-xs font-medium",
                    mediaKind === "inspiration" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => setMediaKind("inspiration")}
                >
                  Inspiration
                </button>
              </div>

              <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-1">
                {(["bento", "gallery", "masonry", "list"] as MediaViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded px-3 py-1.5 text-xs font-medium capitalize",
                      mediaView === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                    onClick={() => setMediaView(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {currentMedia.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No {mediaKind} photos are linked to this room yet.
            </div>
          ) : mediaView === "bento" ? (
            <GridBento items={currentMedia} />
          ) : mediaView === "gallery" ? (
            <ImageGallery items={currentMedia} />
          ) : mediaView === "masonry" ? (
            <ImageGalleryMasonry items={currentMedia} />
          ) : (
            <MediaList items={currentMedia} />
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Supporting Materials</CardTitle>
              <CardDescription>Documents and references already linked to this room</CardDescription>
            </div>
            <a
              href={`/supporting-docs?roomId=${detail.room.id}`}
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              Open project records
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.supportingDocuments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No supporting materials are linked yet.
            </div>
          ) : (
            detail.supportingDocuments.map((document) => {
              const href = document.r2Url || document.externalUrl || null;
              return (
                <article key={document.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{document.title}</p>
                        <Badge variant="secondary">{document.sourceType}</Badge>
                        <Badge variant="outline">{formatDate(document.datetimeUpdated)}</Badge>
                      </div>
                      {document.description ? (
                        <p className="text-sm leading-6 text-muted-foreground">{document.description}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {(document.visionNodeTitles || []).slice(0, 4).map((title) => (
                          <span key={`${document.id}-${title}`} className="rounded bg-muted px-2 py-1">
                            {title}
                          </span>
                        ))}
                      </div>
                    </div>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        Open
                        <ArrowUpRight className="size-4" />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
