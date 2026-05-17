import {
  Building2,
  Check,
  Crop,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImageCompareSlider } from "@/components/ImageCompareSlider";
import { ImagePreview } from "@/components/ui/image-preview";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperNext,
  StepperPrev,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FileUpload,
  FileUploadClear,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomLabels?: string[];
  roomType?: string | null;
  metadata?: string | null;
  photoCategory?: "inspirational" | "listing" | "ai_render";
}

interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  rooms: CatalogRoom[];
}

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface EditSession {
  id: string;
  name: string;
  sourceImageId?: string | null;
  datetimeCreated?: string | number | Date;
  datetimeLastModified?: string | number | Date;
  revisionCount?: number;
}

interface EditRevision {
  id: string;
  sessionId: string;
  sourceImageId?: string | null;
  outputImageId: string;
  prompt: string;
  model?: string | null;
  revisionNumber: number;
  datetimeCreated?: string | number | Date;
  sourceImage?: ImageRecord | null;
  outputImage?: ImageRecord | null;
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 1;

const fileKey = (file: File) =>
  `${file.name}-${file.size}-${file.type}-${file.lastModified}`;

function parseMetadata(raw: string | null | undefined): { deliveryUrl?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { deliveryUrl?: string };
  } catch {
    return {};
  }
}

function resolveImageUrl(image: ImageRecord): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!deliveryId) return "";
  if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://")) {
    return deliveryId;
  }
  if (deliveryId.includes("/")) {
    return `https://imagedelivery.net/${deliveryId}/public`;
  }
  const metadata = parseMetadata(image.metadata);
  if (metadata.deliveryUrl) {
    return metadata.deliveryUrl;
  }
  return `https://imagedelivery.net/${deliveryId}/public`;
}

function getImageDisplayName(
  image: ImageRecord | null | undefined,
  fallback: string = "Untitled photo",
): string {
  if (!image) {
    return fallback;
  }
  const explicit = image.displayName?.trim();
  if (explicit) {
    return explicit;
  }
  const room = image.roomType?.trim();
  if (room) {
    return `${room} photo`;
  }
  return fallback;
}

function createImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });

    image.addEventListener("error", (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    });

    image.src = objectUrl;
  });
}

async function getCroppedFile(file: File, areaPixels: CropperAreaData): Promise<File> {
  const image = await createImageFromFile(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D context is not available for cropping");
  }

  const width = Math.max(1, Math.round(areaPixels.width));
  const height = Math.max(1, Math.round(areaPixels.height));
  const x = Math.max(0, Math.round(areaPixels.x));
  const y = Math.max(0, Math.round(areaPixels.y));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to render cropped image"));
          return;
        }
        resolve(result);
      },
      outputType,
      0.95,
    );
  });

  return new File([blob], file.name, {
    type: outputType,
    lastModified: Date.now(),
  });
}

function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export function PhotoEditSessionsApp() {
  const [sessions, setSessions] = useState<EditSession[]>([]);
  const [sourceImages, setSourceImages] = useState<ImageRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<EditSession | null>(null);
  const [sessionSourceImage, setSessionSourceImage] = useState<ImageRecord | null>(null);
  const [revisions, setRevisions] = useState<EditRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);

  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionSourceImageId, setNewSessionSourceImageId] = useState("");
  const [newSessionRoomType, setNewSessionRoomType] = useState("");
  const [newSessionPromptTemplate, setNewSessionPromptTemplate] = useState("");

  const [prompt, setPrompt] = useState("");
  const [roomType, setRoomType] = useState("");
  const [revisionSourceImageId, setRevisionSourceImageId] = useState("");
  const [revisionFiles, setRevisionFiles] = useState<File[]>([]);

  const [catalogFloors, setCatalogFloors] = useState<CatalogFloor[]>([]);
  const [catalogRooms, setCatalogRooms] = useState<CatalogRoom[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [sessionWizardOpen, setSessionWizardOpen] = useState(false);
  const [sessionWizardStep, setSessionWizardStep] = useState(1);
  const [sessionWizardEditType, setSessionWizardEditType] = useState<
    "layout" | "paint" | "staging" | "inspiration"
  >("layout");
  const [wizardSelectedFloorKey, setWizardSelectedFloorKey] = useState("lower_level");
  const [wizardSelectedRoomId, setWizardSelectedRoomId] = useState("");
  const [wizardSelectedSourceImageIds, setWizardSelectedSourceImageIds] = useState<string[]>([]);
  const [wizardPreviewImageId, setWizardPreviewImageId] = useState<string | null>(null);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetFile, setCropTargetFile] = useState<File | null>(null);
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });

  const cropTargetPreview = useMemo(
    () => (cropTargetFile ? URL.createObjectURL(cropTargetFile) : null),
    [cropTargetFile],
  );

  useEffect(() => {
    return () => {
      if (cropTargetPreview) {
        URL.revokeObjectURL(cropTargetPreview);
      }
    };
  }, [cropTargetPreview]);

  const lowerFloor = useMemo(
    () =>
      catalogFloors.find((floor) => floor.key === "lower_level") ||
      catalogFloors[0] ||
      null,
    [catalogFloors],
  );
  const upperFloor = useMemo(
    () =>
      catalogFloors.find((floor) => floor.key === "upper_level") ||
      catalogFloors[catalogFloors.length - 1] ||
      null,
    [catalogFloors],
  );
  const isWizardUpperFloor = wizardSelectedFloorKey === upperFloor?.key;
  const wizardRoomsForSelectedFloor = useMemo(() => {
    const floor = catalogFloors.find((entry) => entry.key === wizardSelectedFloorKey);
    return floor?.rooms || [];
  }, [catalogFloors, wizardSelectedFloorKey]);

  const loadSourceImages = useCallback(async () => {
    const response = await fetch("/api/images");
    const payload = (await response.json()) as { images?: ImageRecord[] };
    if (!response.ok) {
      throw new Error("Failed to load source images");
    }
    const rows = Array.isArray(payload.images) ? payload.images : [];
    setSourceImages(rows.filter((row) => row.photoCategory !== "ai_render"));
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const response = await fetch("/api/rooms/catalog");
      const payload = (await response.json()) as {
        success?: boolean;
        floors?: Array<{
          id: number;
          key: string;
          name: string;
          rooms?: Array<{
            id: number;
            floorId: number;
            roomCode: string;
            roomName: string;
            displayName: string;
          }>;
        }>;
      };

      if (!response.ok || !payload.success) {
        throw new Error("Failed to load room catalog");
      }

      const floors = Array.isArray(payload.floors) ? payload.floors : [];
      const normalizedFloors: CatalogFloor[] = floors.map((floor) => ({
        id: floor.id,
        key: floor.key,
        name: floor.name,
        rooms: Array.isArray(floor.rooms)
          ? floor.rooms.map((room) => ({
              ...room,
              floorKey: floor.key,
              floorName: floor.name,
            }))
          : [],
      }));

      setCatalogFloors(normalizedFloors);
      setCatalogRooms(normalizedFloors.flatMap((floor) => floor.rooms));
      if (!normalizedFloors.some((floor) => floor.key === wizardSelectedFloorKey)) {
        setWizardSelectedFloorKey(normalizedFloors[0]?.key ?? "lower_level");
      }
    } finally {
      setCatalogLoading(false);
    }
  }, [wizardSelectedFloorKey]);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/photo-edits/sessions");
    const payload = (await response.json()) as { sessions?: EditSession[] };
    if (!response.ok) {
      throw new Error("Failed to load edit sessions");
    }

    const rows = Array.isArray(payload.sessions) ? payload.sessions : [];
    setSessions(rows);

    if (!selectedSessionId && rows.length > 0) {
      setSelectedSessionId(rows[0].id);
    }
  }, [selectedSessionId]);

  const loadSelectedSession = useCallback(async () => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      setSessionSourceImage(null);
      setRevisions([]);
      return;
    }

    setLoadingSession(true);
    try {
      const response = await fetch(`/api/photo-edits/sessions/${selectedSessionId}`);
      const payload = (await response.json()) as {
        session?: EditSession;
        sourceImage?: ImageRecord | null;
        revisions?: EditRevision[];
      };

      if (!response.ok || !payload.session) {
        throw new Error("Failed to load session details");
      }

      setSelectedSession(payload.session);
      setSessionSourceImage(payload.sourceImage ?? null);
      setRevisions(Array.isArray(payload.revisions) ? payload.revisions : []);
      setNewSessionSourceImageId(payload.session.sourceImageId || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([loadSourceImages(), loadSessions(), loadCatalog()]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load editor");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadCatalog, loadSessions, loadSourceImages]);

  useEffect(() => {
    loadSelectedSession();
  }, [loadSelectedSession]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ target?: string }>;
      if (
        customEvent.detail?.target !== "images" &&
        customEvent.detail?.target !== "photo-reviews"
      ) {
        return;
      }

      void Promise.all([loadSourceImages(), loadSessions(), loadCatalog()]);
      if (selectedSessionId) {
        void loadSelectedSession();
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [loadCatalog, loadSelectedSession, loadSessions, loadSourceImages, selectedSessionId]);

  const sessionSourceOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string }>();

    if (sessionSourceImage) {
      options.set(sessionSourceImage.id, {
        id: sessionSourceImage.id,
        label: `Session source · ${getImageDisplayName(sessionSourceImage)}`,
      });
    }

    for (const revision of revisions) {
      if (revision.outputImage) {
        options.set(revision.outputImage.id, {
          id: revision.outputImage.id,
          label: `Revision ${revision.revisionNumber} · ${getImageDisplayName(revision.outputImage)}`,
        });
      }
    }

    return Array.from(options.values());
  }, [revisions, sessionSourceImage]);

  const listingSourceCandidates = useMemo(() => {
    const selectedRoomId = wizardSelectedRoomId ? Number(wizardSelectedRoomId) : null;
    return sourceImages.filter((image) => {
      if (image.photoCategory !== "listing") {
        return false;
      }
      if (!selectedRoomId) {
        return true;
      }
      if (image.roomId === selectedRoomId) {
        return true;
      }
      if (Array.isArray(image.roomLabels)) {
        const selectedRoom = catalogRooms.find((room) => room.id === selectedRoomId);
        if (selectedRoom && image.roomLabels.includes(selectedRoom.roomName)) {
          return true;
        }
      }
      return false;
    });
  }, [catalogRooms, sourceImages, wizardSelectedRoomId]);

  useEffect(() => {
    if (!wizardSelectedRoomId) {
      return;
    }

    const exists = wizardRoomsForSelectedFloor.some(
      (room) => room.id === Number(wizardSelectedRoomId),
    );
    if (!exists) {
      setWizardSelectedRoomId("");
      setWizardSelectedSourceImageIds([]);
    }
  }, [wizardRoomsForSelectedFloor, wizardSelectedRoomId]);

  const resetSessionWizard = useCallback(() => {
    setSessionWizardStep(1);
    setSessionWizardEditType("layout");
    setWizardSelectedFloorKey(lowerFloor?.key || "lower_level");
    setWizardSelectedRoomId("");
    setWizardSelectedSourceImageIds([]);
    setWizardPreviewImageId(null);
    setNewSessionRoomType("");
    setNewSessionPromptTemplate("");
    setNewSessionName("");
  }, [lowerFloor?.key]);

  const openSessionWizard = useCallback(() => {
    resetSessionWizard();
    setSessionWizardOpen(true);
  }, [resetSessionWizard]);

  const handleWizardFloorToggle = useCallback(
    (checked: boolean) => {
      const nextFloorKey = checked ? upperFloor?.key : lowerFloor?.key;
      if (!nextFloorKey) {
        return;
      }
      setWizardSelectedFloorKey(nextFloorKey);
      setWizardSelectedRoomId("");
      setWizardSelectedSourceImageIds([]);
    },
    [lowerFloor?.key, upperFloor?.key],
  );

  const handleWizardRoomChange = useCallback(
    (value: string) => {
      const nextRoomId = value === "all" ? "" : value;
      setWizardSelectedRoomId(nextRoomId);
      setWizardSelectedSourceImageIds([]);
      const nextRoom = catalogRooms.find((room) => room.id === Number(nextRoomId));
      if (nextRoom && nextRoom.floorKey !== wizardSelectedFloorKey) {
        setWizardSelectedFloorKey(nextRoom.floorKey);
      }
    },
    [catalogRooms, wizardSelectedFloorKey],
  );

  useEffect(() => {
    if (wizardSelectedSourceImageIds.length === 0) {
      setNewSessionSourceImageId("");
      return;
    }
    setNewSessionSourceImageId(wizardSelectedSourceImageIds[0] || "");
  }, [wizardSelectedSourceImageIds]);

  const selectedWizardRoom = useMemo(
    () =>
      catalogRooms.find((room) => room.id === Number(wizardSelectedRoomId)) ||
      null,
    [catalogRooms, wizardSelectedRoomId],
  );
  const wizardPreviewImage = useMemo(
    () =>
      wizardPreviewImageId
        ? sourceImages.find((image) => image.id === wizardPreviewImageId) || null
        : null,
    [sourceImages, wizardPreviewImageId],
  );

  useEffect(() => {
    if (!selectedWizardRoom) {
      return;
    }
    setNewSessionRoomType(selectedWizardRoom.roomName.toLowerCase());
  }, [selectedWizardRoom]);

  useEffect(() => {
    if (!selectedSessionId) {
      setRevisionSourceImageId("");
      return;
    }

    if (revisions.length > 0) {
      const latestOutput = revisions[revisions.length - 1]?.outputImage?.id;
      if (latestOutput) {
        setRevisionSourceImageId(latestOutput);
        return;
      }
    }

    if (sessionSourceImage?.id) {
      setRevisionSourceImageId(sessionSourceImage.id);
      return;
    }

    if (selectedSession?.sourceImageId) {
      setRevisionSourceImageId(selectedSession.sourceImageId);
      return;
    }

    setRevisionSourceImageId("");
  }, [revisions, selectedSession?.sourceImageId, selectedSessionId, sessionSourceImage?.id]);

  const onFileValidate = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      return "Only image files are supported";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File must be 10MB or less";
    }
    return null;
  }, []);

  const createSession = useCallback(async (sourceOverrideIds?: string[]) => {
    const candidateSourceIds =
      Array.isArray(sourceOverrideIds) && sourceOverrideIds.length > 0
        ? sourceOverrideIds
        : newSessionSourceImageId
          ? [newSessionSourceImageId]
          : [];

    const sourceIdsToCreate = candidateSourceIds.length > 0 ? candidateSourceIds : [null];

    setCreatingSession(true);
    try {
      const createdSessionIds: string[] = [];
      const baseName = newSessionName.trim();

      for (let index = 0; index < sourceIdsToCreate.length; index++) {
        const sourceId = sourceIdsToCreate[index];
        const sourceImage = sourceImages.find((image) => image.id === sourceId) || null;
        const suffix =
          sourceIdsToCreate.length > 1
            ? ` · Angle ${index + 1}`
            : "";
        const resolvedName =
          baseName ||
          `${sourceImage?.displayName?.trim() || sourceImage?.roomType || "Photo Edit"}${suffix}`;

        const response = await fetch("/api/photo-edits/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: resolvedName || undefined,
            sourceImageId: sourceId || undefined,
          }),
        });
        const payload = (await response.json()) as { session?: EditSession; error?: string };

        if (!response.ok || !payload.session) {
          throw new Error(payload.error ?? "Failed to create session");
        }

        createdSessionIds.push(payload.session.id);
      }

      if (newSessionRoomType.trim().length > 0) {
        setRoomType(newSessionRoomType.trim().toLowerCase());
      }
      if (newSessionPromptTemplate.trim().length > 0) {
        setPrompt(newSessionPromptTemplate.trim());
      }

      resetSessionWizard();
      setSessionWizardOpen(false);
      await loadSessions();

      const targetSessionId = createdSessionIds[0];
      if (targetSessionId) {
        setSelectedSessionId(targetSessionId);
      }

      toast.success(
        createdSessionIds.length > 1
          ? `Created ${createdSessionIds.length} sessions`
          : "Session created",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setCreatingSession(false);
    }
  }, [
    loadSessions,
    newSessionName,
    newSessionPromptTemplate,
    newSessionRoomType,
    newSessionSourceImageId,
    resetSessionWizard,
    sourceImages,
  ]);

  const openCropModal = useCallback((file: File) => {
    setCropTargetFile(file);
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      areaPixels: null,
    });
    setCropModalOpen(true);
  }, []);

  const closeCropModal = useCallback(() => {
    setCropModalOpen(false);
    setCropTargetFile(null);
  }, []);

  const applyCrop = useCallback(async () => {
    if (!cropTargetFile || !cropState.areaPixels) {
      toast.error("Select a crop area first");
      return;
    }

    try {
      const cropped = await getCroppedFile(cropTargetFile, cropState.areaPixels);
      setRevisionFiles((prev) =>
        prev.map((entry) => (entry === cropTargetFile ? cropped : entry)),
      );
      toast.success("Crop applied");
      closeCropModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to crop image");
    }
  }, [closeCropModal, cropState.areaPixels, cropTargetFile]);

  const createRevision = useCallback(async () => {
    if (!selectedSessionId) {
      toast.error("Select or create a session first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Prompt is required");
      return;
    }

    setCreatingRevision(true);
    try {
      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      if (roomType.trim()) {
        formData.append("roomType", roomType.trim().toLowerCase());
      }
      if (revisionSourceImageId) {
        formData.append("sourceImageId", revisionSourceImageId);
      } else if (selectedSession?.sourceImageId) {
        formData.append("sourceImageId", selectedSession.sourceImageId);
      } else if (newSessionSourceImageId) {
        formData.append("sourceImageId", newSessionSourceImageId);
      }
      if (revisionFiles[0]) {
        formData.append("file", revisionFiles[0]);
      }

      const response = await fetch(`/api/photo-edits/sessions/${selectedSessionId}/revisions`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create revision");
      }

      setPrompt("");
      setRoomType("");
      setRevisionFiles([]);
      await loadSessions();
      await loadSelectedSession();
      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: { target: "images", isListingPhoto: false, source: "photo-edits" },
        }),
      );
      toast.success("Revision created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create revision");
    } finally {
      setCreatingRevision(false);
    }
  }, [
    loadSelectedSession,
    loadSessions,
    newSessionSourceImageId,
    prompt,
    revisionSourceImageId,
    revisionFiles,
    roomType,
    selectedSession,
    selectedSessionId,
  ]);

  const submitSessionWizard = useCallback(async () => {
    if (!newSessionName.trim()) {
      toast.error("Session name is required");
      setSessionWizardStep(3);
      return;
    }

    if (wizardSelectedSourceImageIds.length === 0) {
      toast.error("Select at least one source listing photo");
      setSessionWizardStep(1);
      return;
    }

    await createSession(wizardSelectedSourceImageIds);
  }, [createSession, newSessionName, wizardSelectedSourceImageIds]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading photo editor...
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit ring-1 ring-border/40">
          <CardHeader>
            <CardTitle>Edit Sessions</CardTitle>
            <CardDescription>
              Create a session for each room or idea, then iterate revisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full gap-2" onClick={openSessionWizard}>
              <Plus className="size-4" />
              New Edit Session
            </Button>

            <div className="space-y-2 pt-2">
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions yet.</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      "w-full rounded-lg border border-border/50 bg-card px-3 py-2 text-left text-sm transition",
                      selectedSessionId === session.id && "ring-2 ring-ring",
                    )}
                  >
                    <p className="truncate font-medium">{session.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.revisionCount || 0} revisions
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="ring-1 ring-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedSession?.name || "Select a Session"}
                </CardTitle>
                <CardDescription>
                  Track prompts, generated revisions, and image history per session.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSelectedSession}
                disabled={loadingSession || !selectedSessionId}
                className="gap-2"
              >
                <RefreshCw className={cn("size-4", loadingSession && "animate-spin")} />
                Refresh
              </Button>
            </CardHeader>

            <CardContent className="space-y-4">
              {sessionSourceImage ? (
                <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
                  <img
                    src={resolveImageUrl(sessionSourceImage)}
                    alt="Session source"
                    className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-border/40"
                  />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Source:</span>{" "}
                      {getImageDisplayName(sessionSourceImage)}
                    </p>
                    <p><span className="font-medium text-foreground">Room:</span> {sessionSourceImage.roomType || "unassigned"}</p>
                    <p><span className="font-medium text-foreground">Created:</span> {formatDate(selectedSession?.datetimeCreated)}</p>
                    <p><span className="font-medium text-foreground">Updated:</span> {formatDate(selectedSession?.datetimeLastModified)}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Set a source image on the session before generating revisions.
                </p>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="revision-prompt-input"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Prompt
                </label>
                <textarea
                  id="revision-prompt-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  placeholder="Extract the panel-ready fridge style from the inspiration and apply it to this kitchen photo."
                  className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="room-override-input"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Room Override (Optional)
                </label>
                <input
                  id="room-override-input"
                  type="text"
                  value={roomType}
                  onChange={(event) => setRoomType(event.target.value)}
                  placeholder="kitchen"
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="revision-source-image-select"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Source Image For Next Revision
                </label>
                <select
                  id="revision-source-image-select"
                  value={revisionSourceImageId}
                  onChange={(event) => setRevisionSourceImageId(event.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                >
                  <option value="">Choose source image</option>
                  {sessionSourceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Optional Output Upload
                </p>
                <FileUpload
                  value={revisionFiles}
                  onValueChange={setRevisionFiles}
                  onFileValidate={onFileValidate}
                  maxFiles={MAX_FILES}
                  maxSize={MAX_FILE_SIZE}
                  accept="image/*"
                  multiple={false}
                  label="Revision output upload"
                  disabled={creatingRevision}
                >
                  <FileUploadDropzone className="gap-2 rounded-xl border-border/40 bg-muted/20 p-6 text-center">
                    <p className="text-sm font-medium">Drop rendered image output</p>
                    <p className="text-xs text-muted-foreground">
                      If empty, Workers AI will generate from the source image + prompt.
                    </p>
                    <FileUploadTrigger asChild>
                      <Button size="sm" variant="secondary">
                        Browse File
                      </Button>
                    </FileUploadTrigger>
                  </FileUploadDropzone>

                  <div className="flex justify-between">
                    <FileUploadClear asChild>
                      <Button size="sm" variant="ghost">
                        Clear
                      </Button>
                    </FileUploadClear>
                  </div>

                  <FileUploadList>
                    {revisionFiles.map((file) => (
                      <FileUploadItem key={fileKey(file)} value={file} className="gap-3 rounded-lg border-border/40 bg-card/60 px-3 py-2">
                        <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
                        <FileUploadItemMetadata size="sm" />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openCropModal(file)}
                          title="Crop image"
                        >
                          <Crop className="size-4" />
                        </Button>
                        <FileUploadItemDelete asChild>
                          <Button variant="ghost" size="icon-sm" title="Remove file">
                            <Plus className="size-4 rotate-45" />
                          </Button>
                        </FileUploadItemDelete>
                      </FileUploadItem>
                    ))}
                  </FileUploadList>
                </FileUpload>
              </div>

              <Button
                className="w-full gap-2"
                onClick={createRevision}
                disabled={creatingRevision || !selectedSessionId}
              >
                {creatingRevision ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating Revision
                  </>
                ) : (
                  <>
                    {revisionFiles.length > 0 ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                    {revisionFiles.length > 0 ? "Upload Revision" : "Generate with Workers AI"}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle>Revision History</CardTitle>
              <CardDescription>
                Each revision is saved to Cloudflare Images and linked to this session in D1.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No revisions yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {revisions.map((revision) => {
                    const outputImage = revision.outputImage;
                    const sourceImage = revision.sourceImage;
                    const imageUrl = outputImage ? resolveImageUrl(outputImage) : "";
                    return (
                      <article key={revision.id} className="overflow-hidden rounded-lg border bg-card/50 ring-1 ring-border/40">
                        {imageUrl ? (
                          <>
                            <img
                              src={imageUrl}
                              alt={`Revision ${revision.revisionNumber}`}
                              className="aspect-[4/3] w-full object-cover"
                            />
                            {sourceImage && (
                              <div className="border-t border-border/40 p-2">
                                <ImageCompareSlider
                                  beforeSrc={resolveImageUrl(sourceImage)}
                                  afterSrc={imageUrl}
                                  beforeLabel="Source"
                                  afterLabel={`Revision ${revision.revisionNumber}`}
                                  defaultValue={55}
                                  aspectClassName="aspect-[16/10]"
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-muted/30 text-sm text-muted-foreground">
                            No preview
                          </div>
                        )}
                        <div className="space-y-2 p-3">
                          <p className="text-sm font-medium">Revision {revision.revisionNumber}</p>
                          <p className="line-clamp-3 text-xs text-muted-foreground">{revision.prompt}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDate(revision.datetimeCreated)}</p>
                          {outputImage && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => setRevisionSourceImageId(outputImage.id)}
                            >
                              Use As Source For Next Revision
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={sessionWizardOpen} onOpenChange={setSessionWizardOpen}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Create New Edit Session</DialogTitle>
          </DialogHeader>

          <Stepper steps={3} value={sessionWizardStep} onValueChange={setSessionWizardStep}>
            <StepperList className="flex-nowrap overflow-x-auto pb-1">
              <StepperItem step={1}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Choose Source Photos</StepperTitle>
                    <StepperDescription>Floor, room, and listing angles</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
              <StepperItem step={2}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Edit Strategy</StepperTitle>
                    <StepperDescription>Pick mode and prompt defaults</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
              <StepperItem step={3}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Confirm Session</StepperTitle>
                    <StepperDescription>Create and start revising</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
            </StepperList>

            <StepperContent step={1} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Floor
                  </p>
                  <div className="flex items-center justify-between rounded-md bg-muted/20 px-3 py-2 ring-1 ring-border/40">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        !isWizardUpperFloor ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {lowerFloor?.name ?? "Downstairs"}
                    </span>
                    <Switch
                      checked={isWizardUpperFloor}
                      onCheckedChange={handleWizardFloorToggle}
                      aria-label="Toggle between downstairs and upstairs rooms"
                      disabled={catalogLoading || !lowerFloor || !upperFloor}
                    />
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isWizardUpperFloor ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {upperFloor?.name ?? "Upstairs"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Room
                  </p>
                  <Select
                    value={wizardSelectedRoomId || "all"}
                    onValueChange={handleWizardRoomChange}
                    disabled={catalogLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All listing rooms" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All listing rooms</SelectItem>
                      {wizardRoomsForSelectedFloor.map((room) => (
                        <SelectItem key={room.id} value={String(room.id)}>
                          {room.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Selected Source Photos</p>
                  <span className="text-xs text-muted-foreground">
                    {wizardSelectedSourceImageIds.length} selected
                  </span>
                </div>
                <MultipleSelector
                  title="Select source listing photos"
                  placeholder="Choose one or more listing photos"
                  options={listingSourceCandidates.map((image) => ({
                    value: image.id,
                    label: `${getImageDisplayName(image)} • ${image.roomType || "unassigned"}`,
                  }))}
                  value={wizardSelectedSourceImageIds}
                  onValueChange={setWizardSelectedSourceImageIds}
                />
              </div>

              {listingSourceCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No listing photos match this room yet.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {listingSourceCandidates.map((image) => {
                    const selected = wizardSelectedSourceImageIds.includes(image.id);
                    const name = getImageDisplayName(image);
                    return (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => {
                          setWizardSelectedSourceImageIds((current) => {
                            if (current.includes(image.id)) {
                              return current.filter((entry) => entry !== image.id);
                            }
                            return [...current, image.id];
                          });
                        }}
                        className={cn(
                          "overflow-hidden rounded-xl border bg-card text-left ring-1 ring-border/40 transition",
                          selected && "ring-2 ring-ring",
                        )}
                      >
                        <img
                          src={resolveImageUrl(image)}
                          alt={name}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <div className="space-y-1 p-2.5">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">{image.roomType || "unassigned"}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              setWizardPreviewImageId(image.id);
                            }}
                          >
                            Preview
                          </Button>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </StepperContent>

            <StepperContent step={2} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  {
                    key: "layout" as const,
                    title: "Wall Layout Change",
                    description: "Open walls, move zones, remove fixed elements, and establish a base canvas.",
                  },
                  {
                    key: "paint" as const,
                    title: "Paint Color Visuals",
                    description: "Test color systems, sheen, and finish detail prompts.",
                  },
                  {
                    key: "staging" as const,
                    title: "Staging / Furniture",
                    description: "Show furniture, lighting, and styling concepts.",
                  },
                  {
                    key: "inspiration" as const,
                    title: "Inspirational Stitching",
                    description: "Extract details from inspiration and apply to listing angles.",
                  },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSessionWizardEditType(option.key)}
                    className={cn(
                      "rounded-xl border p-3 text-left ring-1 ring-border/40 transition",
                      sessionWizardEditType === option.key
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted/20",
                    )}
                  >
                    <p className="text-sm font-semibold">{option.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Room Override
                </label>
                <input
                  type="text"
                  value={newSessionRoomType}
                  onChange={(event) => setNewSessionRoomType(event.target.value)}
                  placeholder="kitchen"
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prompt Template
                </label>
                <textarea
                  value={newSessionPromptTemplate}
                  onChange={(event) => setNewSessionPromptTemplate(event.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                  placeholder="Describe the baseline transformation, constraints, and material intent. This carries into the main prompt box after session creation."
                />
              </div>
            </StepperContent>

            <StepperContent step={3} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Session Name
                </label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(event) => setNewSessionName(event.target.value)}
                  placeholder="Kitchen base layout v1"
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="rounded-lg bg-muted/20 p-3 text-sm ring-1 ring-border/30">
                <p className="font-medium">Summary</p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>• Edit type: {sessionWizardEditType}</li>
                  <li>• Selected listing photos: {wizardSelectedSourceImageIds.length}</li>
                  <li>• Room override: {newSessionRoomType || "auto"}</li>
                </ul>
              </div>
            </StepperContent>
          </Stepper>

          <div className="flex justify-between gap-2 border-t border-border/40 pt-4">
            <StepperPrev onClick={() => setSessionWizardStep((current) => Math.max(1, current - 1))}>
              Back
            </StepperPrev>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSessionWizardOpen(false)}>
                Cancel
              </Button>
              {sessionWizardStep < 3 ? (
                <StepperNext
                  onClick={() =>
                    setSessionWizardStep((current) => Math.min(3, current + 1))
                  }
                  disabled={sessionWizardStep === 1 && wizardSelectedSourceImageIds.length === 0}
                >
                  Next
                </StepperNext>
              ) : (
                <Button onClick={submitSessionWizard} disabled={creatingSession}>
                  {creatingSession ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Creating
                    </>
                  ) : (
                    <>
                      <Building2 className="mr-2 size-4" />
                      Create Session
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {wizardPreviewImage && (
        <ImagePreview
          open={wizardPreviewImageId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setWizardPreviewImageId(null);
            }
          }}
          src={resolveImageUrl(wizardPreviewImage)}
          title={wizardPreviewImage.displayName || "Source Preview"}
          metadata={wizardPreviewImage.metadata || null}
        />
      )}

      <Dialog open={cropModalOpen} onOpenChange={(open) => (open ? setCropModalOpen(true) : closeCropModal())}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Crop Output Image</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative h-[22rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
              {cropTargetPreview && (
                <Cropper
                  crop={cropState.crop}
                  zoom={cropState.zoom}
                  rotation={cropState.rotation}
                  aspectRatio={4 / 3}
                  withGrid
                  onCropChange={(crop) => setCropState((prev) => ({ ...prev, crop }))}
                  onZoomChange={(zoom) => setCropState((prev) => ({ ...prev, zoom }))}
                  onRotationChange={(rotation) =>
                    setCropState((prev) => ({ ...prev, rotation }))
                  }
                  onCropAreaChange={(_, areaPixels) =>
                    setCropState((prev) => ({ ...prev, areaPixels }))
                  }
                >
                  <CropperImage src={cropTargetPreview} alt="Crop target" />
                  <CropperArea />
                </Cropper>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Zoom ({cropState.zoom.toFixed(2)}x)</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.05}
                  value={cropState.zoom}
                  onChange={(event) =>
                    setCropState((prev) => ({
                      ...prev,
                      zoom: Number(event.target.value),
                    }))
                  }
                  className="w-full"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Rotation ({Math.round(cropState.rotation)}°)</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={cropState.rotation}
                  onChange={(event) =>
                    setCropState((prev) => ({
                      ...prev,
                      rotation: Number(event.target.value),
                    }))
                  }
                  className="w-full"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeCropModal}>
                Cancel
              </Button>
              <Button onClick={applyCrop}>
                <Crop className="mr-2 size-4" />
                Apply Crop
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
