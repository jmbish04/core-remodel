import {
  Camera,
  Check,
  Compass,
  MapPinned,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImageCompareSlider } from "@/components/ImageCompareSlider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomType?: string | null;
  metadata?: string | null;
  photoCategory?: "inspirational" | "listing" | "ai_render";
}

interface RevisionRecord {
  id: string;
  revisionNumber: number;
  prompt: string;
  sourceImageId: string | null;
  outputImageId: string;
  sourceImage: ImageRecord | null;
  outputImage: ImageRecord | null;
}

interface SessionRecord {
  id: string;
  name: string;
  status: string;
  sourceImageId: string | null;
  revisions: RevisionRecord[];
}

interface CameraPoint {
  imageId: string;
  floor: number;
  x: number;
  y: number;
  direction: number;
  label: string;
}

interface RoomRecord {
  room: string;
  listingImages: ImageRecord[];
  inspirationalImages: ImageRecord[];
  aiRenderImages: ImageRecord[];
  promotedImages: Array<ImageRecord & { metadataParsed?: ImageMetadata }>;
  sessions: SessionRecord[];
  cameraPoints: CameraPoint[];
}

interface DecisionRoomPayload {
  floors: number[];
  rooms: RoomRecord[];
}

interface ImageMetadata {
  note?: string;
  tags?: string[];
  decision?: {
    promoted?: boolean;
    label?: string;
    stage?: "draft" | "candidate" | "final";
  };
  camera?: {
    floor?: number;
    x?: number;
    y?: number;
    direction?: number;
    label?: string;
  };
}

interface CameraEditorState {
  floor: number;
  x: number;
  y: number;
  direction: number;
  label: string;
  note: string;
  stage: "draft" | "candidate" | "final";
  promoted: boolean;
}

const FLOORPLAN_STORAGE_KEY = "decision-room-floorplan-image";

function parseMetadata(raw: string | null | undefined): ImageMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ImageMetadata;
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
  if (metadata && typeof metadata === "object" && typeof metadata.decision === "object") {
    const deliveryUrl = (metadata as { deliveryUrl?: string }).deliveryUrl;
    if (deliveryUrl) {
      return deliveryUrl;
    }
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

export function DecisionRoomApp() {
  const [payload, setPayload] = useState<DecisionRoomPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [floorplanImageUrl, setFloorplanImageUrl] = useState("");

  const [compareListingId, setCompareListingId] = useState("");
  const [compareInspirationId, setCompareInspirationId] = useState("");
  const [compareRenderId, setCompareRenderId] = useState("");

  const [cameraEditorImage, setCameraEditorImage] = useState<ImageRecord | null>(null);
  const [cameraEditorState, setCameraEditorState] = useState<CameraEditorState>({
    floor: 1,
    x: 50,
    y: 50,
    direction: 0,
    label: "",
    note: "",
    stage: "candidate",
    promoted: false,
  });
  const [savingCamera, setSavingCamera] = useState(false);

  const loadDecisionData = useCallback(async () => {
    const response = await fetch("/api/photo-edits/decision-room");
    const data = (await response.json()) as DecisionRoomPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to load decision-room data");
    }
    setPayload(data);
  }, []);

  useEffect(() => {
    const savedFloorplan = window.localStorage.getItem(FLOORPLAN_STORAGE_KEY) || "";
    setFloorplanImageUrl(savedFloorplan);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadDecisionData();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load decision room");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadDecisionData]);

  const roomNames = useMemo(
    () => (payload?.rooms || []).map((room) => room.room),
    [payload?.rooms],
  );

  useEffect(() => {
    if (roomNames.length === 0) {
      setSelectedRoom("");
      return;
    }
    if (!roomNames.includes(selectedRoom)) {
      setSelectedRoom(roomNames[0]);
    }
  }, [roomNames, selectedRoom]);

  useEffect(() => {
    if (!payload?.floors || payload.floors.length === 0) {
      setSelectedFloor(1);
      return;
    }
    if (!payload.floors.includes(selectedFloor)) {
      setSelectedFloor(payload.floors[0] || 1);
    }
  }, [payload?.floors, selectedFloor]);

  const roomData = useMemo(
    () => payload?.rooms.find((room) => room.room === selectedRoom) || null,
    [payload?.rooms, selectedRoom],
  );

  useEffect(() => {
    if (!roomData) {
      setCompareListingId("");
      setCompareInspirationId("");
      setCompareRenderId("");
      return;
    }

    const listingDefault = roomData.listingImages[0]?.id || "";
    const inspirationDefault = roomData.inspirationalImages[0]?.id || "";
    const renderDefault =
      roomData.aiRenderImages[0]?.id ||
      roomData.sessions.flatMap((session) => session.revisions).at(-1)?.outputImageId ||
      "";

    setCompareListingId((current) =>
      roomData.listingImages.some((image) => image.id === current)
        ? current
        : listingDefault,
    );
    setCompareInspirationId((current) =>
      roomData.inspirationalImages.some((image) => image.id === current)
        ? current
        : inspirationDefault,
    );
    setCompareRenderId((current) => {
      const validRenderIds = new Set([
        ...roomData.aiRenderImages.map((image) => image.id),
        ...roomData.sessions.flatMap((session) =>
          session.revisions.map((revision) => revision.outputImageId),
        ),
      ]);
      return validRenderIds.has(current) ? current : renderDefault;
    });
  }, [roomData]);

  const listingImageMap = useMemo(() => {
    const map = new Map<string, ImageRecord>();
    for (const room of payload?.rooms || []) {
      for (const image of room.listingImages) {
        map.set(image.id, image);
      }
      for (const image of room.inspirationalImages) {
        map.set(image.id, image);
      }
      for (const image of room.aiRenderImages) {
        map.set(image.id, image);
      }
      for (const session of room.sessions) {
        for (const revision of session.revisions) {
          if (revision.sourceImage) map.set(revision.sourceImage.id, revision.sourceImage);
          if (revision.outputImage) map.set(revision.outputImage.id, revision.outputImage);
        }
      }
    }
    return map;
  }, [payload?.rooms]);

  const compareListing = compareListingId ? listingImageMap.get(compareListingId) || null : null;
  const compareInspiration = compareInspirationId ? listingImageMap.get(compareInspirationId) || null : null;
  const compareRender = compareRenderId ? listingImageMap.get(compareRenderId) || null : null;
  const renderCompareOptions = useMemo(() => {
    if (!roomData) {
      return [] as ImageRecord[];
    }
    const map = new Map<string, ImageRecord>();
    for (const image of roomData.aiRenderImages) {
      map.set(image.id, image);
    }
    for (const session of roomData.sessions) {
      for (const revision of session.revisions) {
        if (revision.outputImage) {
          map.set(revision.outputImage.id, revision.outputImage);
        }
      }
    }
    return Array.from(map.values());
  }, [roomData]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDecisionData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }, [loadDecisionData]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ target?: string }>;
      if (
        customEvent.detail?.target !== "images" &&
        customEvent.detail?.target !== "photo-reviews"
      ) {
        return;
      }

      refresh();
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [refresh]);

  const updateImageMetadata = useCallback(async (
    image: ImageRecord,
    updater: (metadata: ImageMetadata) => ImageMetadata,
    options?: { roomType?: string | null },
  ) => {
    const current = parseMetadata(image.metadata);
    const nextMetadata = updater(current);

    const response = await fetch(`/api/images/${image.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomType: options?.roomType ?? image.roomType ?? null,
        photoCategory: image.photoCategory,
        metadata: nextMetadata,
      }),
    });
    const payloadUpdate = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payloadUpdate.error || "Failed to update image metadata");
    }
  }, []);

  const togglePromoted = useCallback(async (image: ImageRecord) => {
    try {
      await updateImageMetadata(image, (metadata) => {
        const promoted = !metadata.decision?.promoted;
        return {
          ...metadata,
          decision: {
            promoted,
            stage: metadata.decision?.stage || "candidate",
            label: metadata.decision?.label,
          },
        };
      });
      await refresh();
      toast.success("Decision flag updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update decision flag");
    }
  }, [refresh, updateImageMetadata]);

  const openCameraEditor = useCallback((image: ImageRecord) => {
    const metadata = parseMetadata(image.metadata);
    const camera = metadata.camera || {};
    setCameraEditorImage(image);
    setCameraEditorState({
      floor: typeof camera.floor === "number" ? camera.floor : selectedFloor,
      x: typeof camera.x === "number" ? camera.x : 50,
      y: typeof camera.y === "number" ? camera.y : 50,
      direction: typeof camera.direction === "number" ? camera.direction : 0,
      label: camera.label || "",
      note: metadata.note || "",
      stage: metadata.decision?.stage || "candidate",
      promoted: metadata.decision?.promoted || false,
    });
  }, [selectedFloor]);

  const saveCameraEditor = useCallback(async () => {
    if (!cameraEditorImage) return;

    setSavingCamera(true);
    try {
      await updateImageMetadata(cameraEditorImage, (metadata) => ({
        ...metadata,
        note: cameraEditorState.note,
        decision: {
          promoted: cameraEditorState.promoted,
          stage: cameraEditorState.stage,
          label: cameraEditorState.label || metadata.decision?.label,
        },
        camera: {
          floor: cameraEditorState.floor,
          x: cameraEditorState.x,
          y: cameraEditorState.y,
          direction: cameraEditorState.direction,
          label: cameraEditorState.label || `${cameraEditorImage.roomType || "room"} camera`,
        },
      }));
      await refresh();
      toast.success("Camera marker saved");
      setCameraEditorImage(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save camera marker");
    } finally {
      setSavingCamera(false);
    }
  }, [cameraEditorImage, cameraEditorState, refresh, updateImageMetadata]);

  const persistFloorplan = useCallback((value: string) => {
    setFloorplanImageUrl(value);
    window.localStorage.setItem(FLOORPLAN_STORAGE_KEY, value);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        Loading decision room...
      </div>
    );
  }

  if (!roomData) {
    return (
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle>Decision Room</CardTitle>
          <CardDescription>
            No room-level decision data is available yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const promotedSessions = roomData.sessions.filter(
    (session) => session.status === "candidate" || session.status === "final_candidate",
  );
  const floorCameraPoints = roomData.cameraPoints.filter(
    (point) => point.floor === selectedFloor,
  );

  return (
    <>
      <div className="grid gap-6">
        <Card className="ring-1 ring-border/40">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>Decision Room</CardTitle>
              <CardDescription>
                Organize room-by-room outcomes for contractors, designers, and engineering teams.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </CardHeader>

          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <label htmlFor="decision-room-room" className="text-xs uppercase text-muted-foreground">Room</label>
              <select
                id="decision-room-room"
                value={selectedRoom}
                onChange={(event) => setSelectedRoom(event.target.value)}
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
              >
                {roomNames.map((room) => (
                  <option key={room} value={room}>{room}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="decision-room-floor" className="text-xs uppercase text-muted-foreground">Floor</label>
              <select
                id="decision-room-floor"
                value={selectedFloor}
                onChange={(event) => setSelectedFloor(Number(event.target.value))}
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
              >
                {(payload?.floors || [1]).map((floor) => (
                  <option key={floor} value={floor}>Floor {floor}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label htmlFor="decision-room-floorplan" className="text-xs uppercase text-muted-foreground">Floorplan Image URL (Optional)</label>
              <input
                id="decision-room-floorplan"
                value={floorplanImageUrl}
                onChange={(event) => persistFloorplan(event.target.value)}
                placeholder="https://.../floorplan.png"
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-6">
            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPinned className="size-4" />
                  Floorplan Camera Map
                </CardTitle>
                <CardDescription>
                  Place camera viewpoints from listing photos to map where each comparison angle comes from.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/40">
                  {floorplanImageUrl ? (
                    <img
                      src={floorplanImageUrl}
                      alt={`Floor ${selectedFloor} plan`}
                      className="size-full object-contain"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                      Add a floorplan image URL to use as the map background.
                    </div>
                  )}

                  {floorCameraPoints.map((point) => (
                    <button
                      key={`${point.imageId}-${point.floor}-${point.x}-${point.y}`}
                      type="button"
                      title={point.label}
                      className="group absolute -translate-x-1/2 -translate-y-1/2"
                      style={{
                        left: `${point.x}%`,
                        top: `${point.y}%`,
                      }}
                      onClick={() => {
                        const image = listingImageMap.get(point.imageId);
                        if (image) {
                          setCompareListingId(image.id);
                        }
                      }}
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Camera className="size-4" />
                      </span>
                      <span
                        className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                      >
                        {point.label}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle>Room Comparisons</CardTitle>
                <CardDescription>
                  Compare original listing photos to inspiration and current AI render candidates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label htmlFor="compare-listing" className="text-xs uppercase text-muted-foreground">Listing</label>
                    <select
                      id="compare-listing"
                      value={compareListingId}
                      onChange={(event) => setCompareListingId(event.target.value)}
                      className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                    >
                      {roomData.listingImages.map((image) => (
                        <option key={image.id} value={image.id}>
                          {getImageDisplayName(image)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="compare-inspiration" className="text-xs uppercase text-muted-foreground">Inspiration</label>
                    <select
                      id="compare-inspiration"
                      value={compareInspirationId}
                      onChange={(event) => setCompareInspirationId(event.target.value)}
                      className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                    >
                      <option value="">None</option>
                      {roomData.inspirationalImages.map((image) => (
                        <option key={image.id} value={image.id}>
                          {getImageDisplayName(image)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="compare-render" className="text-xs uppercase text-muted-foreground">Render</label>
                    <select
                      id="compare-render"
                      value={compareRenderId}
                      onChange={(event) => setCompareRenderId(event.target.value)}
                      className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                    >
                      <option value="">None</option>
                      {renderCompareOptions.map((image) => (
                        <option key={image.id} value={image.id}>
                          {getImageDisplayName(image)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {compareListing && compareRender ? (
                    <ImageCompareSlider
                      beforeSrc={resolveImageUrl(compareListing)}
                      afterSrc={resolveImageUrl(compareRender)}
                      beforeLabel="As-Is Listing"
                      afterLabel="AI Render"
                      defaultValue={52}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground ring-1 ring-border/40">
                      Select listing + render to compare.
                    </div>
                  )}

                  {compareListing && compareInspiration ? (
                    <ImageCompareSlider
                      beforeSrc={resolveImageUrl(compareListing)}
                      afterSrc={resolveImageUrl(compareInspiration)}
                      beforeLabel="As-Is Listing"
                      afterLabel="Inspiration"
                      defaultValue={52}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground ring-1 ring-border/40">
                      Select listing + inspiration to compare.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4" />
                  Final Considerations
                </CardTitle>
                <CardDescription>
                  Promoted image ideas and candidate sessions for this room.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {roomData.promotedImages.length === 0 && promotedSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No promoted items yet. Promote listing/inspiration/render images or mark sessions as candidate.
                  </p>
                ) : (
                  <>
                    {roomData.promotedImages.map((image) => {
                      const metadata = parseMetadata(image.metadata);
                      return (
                        <div key={image.id} className="rounded-lg border border-border/50 p-3">
                          <p className="text-sm font-medium">{getImageDisplayName(image)}</p>
                          <p className="text-xs text-muted-foreground">
                            Stage: {metadata.decision?.stage || "candidate"}
                          </p>
                        </div>
                      );
                    })}

                    {promotedSessions.map((session) => (
                      <div key={session.id} className="rounded-lg border border-border/50 p-3">
                        <p className="text-sm font-medium">{session.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Session status: {session.status}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Compass className="size-4" />
                  Listing Camera Anchors
                </CardTitle>
                <CardDescription>
                  Set camera marker position and direction so the team can connect each listing angle to design decisions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {roomData.listingImages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No listing images for this room.</p>
                ) : (
                  roomData.listingImages.map((image) => {
                    const metadata = parseMetadata(image.metadata);
                    const isPromoted = Boolean(metadata.decision?.promoted);
                    return (
                      <div key={image.id} className="rounded-lg border border-border/50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium">{getImageDisplayName(image)}</p>
                          {isPromoted && (
                            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
                              Promoted
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => openCameraEditor(image)}
                          >
                            <Camera className="mr-2 size-3.5" />
                            Edit Camera
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => togglePromoted(image)}
                          >
                            {isPromoted ? "Unpromote" : "Promote"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle>Session Paths</CardTitle>
                <CardDescription>
                  Iterative kitchen/bath/etc render history for this room.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {roomData.sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions for this room.</p>
                ) : (
                  roomData.sessions.map((session) => (
                    <div key={session.id} className="rounded-lg border border-border/50 p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{session.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {session.revisions.length} revisions
                          </p>
                        </div>
                        <select
                          value={session.status}
                          onChange={async (event) => {
                            try {
                              const response = await fetch(`/api/photo-edits/sessions/${session.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: event.target.value }),
                              });
                              const patchPayload = (await response.json()) as { error?: string };
                              if (!response.ok) {
                                throw new Error(patchPayload.error || "Failed to update status");
                              }
                              await refresh();
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to update session status");
                            }
                          }}
                          className="rounded-md border border-border/50 bg-background px-2 py-1 text-xs"
                        >
                          <option value="active">active</option>
                          <option value="candidate">candidate</option>
                          <option value="final_candidate">final_candidate</option>
                          <option value="archived">archived</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        {session.revisions
                          .slice()
                          .sort((a, b) => a.revisionNumber - b.revisionNumber)
                          .map((revision) => (
                            <div key={revision.id} className="rounded border border-border/40 bg-muted/10 px-2 py-1">
                              <p className="text-xs font-medium">
                                r{revision.revisionNumber} →{" "}
                                {getImageDisplayName(revision.outputImage)}
                              </p>
                              <p className="line-clamp-2 text-[11px] text-muted-foreground">
                                {revision.prompt}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={cameraEditorImage !== null} onOpenChange={(open) => !open && setCameraEditorImage(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Camera Marker Editor</DialogTitle>
          </DialogHeader>

          {cameraEditorImage && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="camera-floor" className="text-xs uppercase text-muted-foreground">Floor</label>
                  <input
                    id="camera-floor"
                    type="number"
                    value={cameraEditorState.floor}
                    onChange={(event) =>
                      setCameraEditorState((prev) => ({
                        ...prev,
                        floor: Number(event.target.value) || 1,
                      }))
                    }
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="camera-direction" className="text-xs uppercase text-muted-foreground">Direction (degrees)</label>
                  <input
                    id="camera-direction"
                    type="number"
                    value={cameraEditorState.direction}
                    onChange={(event) =>
                      setCameraEditorState((prev) => ({
                        ...prev,
                        direction: Number(event.target.value) || 0,
                      }))
                    }
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="camera-x" className="text-xs uppercase text-muted-foreground">X Position (%)</label>
                  <input
                    id="camera-x"
                    type="number"
                    value={cameraEditorState.x}
                    onChange={(event) =>
                      setCameraEditorState((prev) => ({
                        ...prev,
                        x: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                      }))
                    }
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="camera-y" className="text-xs uppercase text-muted-foreground">Y Position (%)</label>
                  <input
                    id="camera-y"
                    type="number"
                    value={cameraEditorState.y}
                    onChange={(event) =>
                      setCameraEditorState((prev) => ({
                        ...prev,
                        y: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                      }))
                    }
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="camera-label" className="text-xs uppercase text-muted-foreground">Marker Label</label>
                <input
                  id="camera-label"
                  value={cameraEditorState.label}
                  onChange={(event) =>
                    setCameraEditorState((prev) => ({
                      ...prev,
                      label: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="camera-stage" className="text-xs uppercase text-muted-foreground">Decision Stage</label>
                <select
                  id="camera-stage"
                  value={cameraEditorState.stage}
                  onChange={(event) =>
                    setCameraEditorState((prev) => ({
                      ...prev,
                      stage: event.target.value as "draft" | "candidate" | "final",
                    }))
                  }
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                >
                  <option value="draft">draft</option>
                  <option value="candidate">candidate</option>
                  <option value="final">final</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="camera-notes" className="text-xs uppercase text-muted-foreground">Notes</label>
                <textarea
                  id="camera-notes"
                  value={cameraEditorState.note}
                  onChange={(event) =>
                    setCameraEditorState((prev) => ({
                      ...prev,
                      note: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cameraEditorState.promoted}
                  onChange={(event) =>
                    setCameraEditorState((prev) => ({
                      ...prev,
                      promoted: event.target.checked,
                    }))
                  }
                />
                Promote in final considerations
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCameraEditorImage(null)} disabled={savingCamera}>
                  Cancel
                </Button>
                <Button onClick={saveCameraEditor} disabled={savingCamera} className="gap-2">
                  {savingCamera ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      Saving
                    </>
                  ) : (
                    <>
                      <Check className="size-4" />
                      Save Marker
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
