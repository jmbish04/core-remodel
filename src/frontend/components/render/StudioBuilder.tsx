import { Hammer, Loader2, RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RoomSelect } from "@/components/ui/room-select";
import { cn } from "@/lib/utils";

import { AngleGallery, type AngleEntry } from "./AngleGallery";
import { BranchNavigator } from "./BranchNavigator";
import { DEFAULT_DESIGN_CONFIG, DesignConfigPanel } from "./DesignConfigPanel";
import { MaskConfigurator } from "./MaskConfigurator";
import { PipelineStatusLoader } from "./PipelineStatusLoader";
import { StageExplorer } from "./StageExplorer";
import {
  STAGE_BUCKET_ACTION,
  type DesignConfig,
  type RenderCanvas,
  type StageBucket,
  resolveCfImageUrl,
} from "./types";

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  rooms: CatalogRoom[];
}

interface SessionResponse {
  id?: string;
  session?: { id: string };
  error?: string;
}

interface SessionDetailResponse {
  session?: { id: string; heroCanvasId?: string | null };
  canvases?: RenderCanvas[];
  angles?: AngleEntry[];
  error?: string;
}

interface StageResponse {
  canvas?: RenderCanvas;
  error?: string;
}

interface UploadResponse {
  id?: string;
  cfImageId?: string;
  deliveryUrl?: string;
  error?: string;
}

const REALTIME_SOCKET_URL = "/api/render/realtime";

/**
 * StudioBuilder — the /builder experience. Composes a room selector, the angle
 * gallery, the stage-explorer timeline, the design-config panel, the mask
 * configurator, the branch tree, and the pinned realtime status loader. Holds
 * studio state in React and talks to the /api/render/* endpoints.
 */
export function StudioBuilder() {
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);

  const [designConfig, setDesignConfig] = useState<DesignConfig>(
    DEFAULT_DESIGN_CONFIG,
  );

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<RenderCanvas[]>([]);
  const [angles, setAngles] = useState<AngleEntry[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);

  const [selectedAngleId, setSelectedAngleId] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageBucket>("stage_1");
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);

  const [runningStage, setRunningStage] = useState(false);

  // ---- catalog load --------------------------------------------------------

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
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
      const normalized: CatalogFloor[] = (payload.floors ?? []).map((floor) => ({
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
      setFloors(normalized);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load rooms");
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const allRooms = useMemo(
    () => floors.flatMap((floor) => floor.rooms),
    [floors],
  );

  // ---- session bootstrap on room change -----------------------------------

  const loadSessionDetail = useCallback(async (id: string) => {
    setLoadingSession(true);
    try {
      const response = await fetch(`/api/render/sessions/${id}`);
      const payload = (await response.json()) as SessionDetailResponse;
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to load session");
      }
      const rows = Array.isArray(payload.canvases) ? payload.canvases : [];
      setCanvases(rows);
      setAngles(Array.isArray(payload.angles) ? payload.angles : []);
      if (!selectedAngleId && payload.angles && payload.angles.length > 0) {
        setSelectedAngleId(payload.angles[0].listingPhotoId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }, [selectedAngleId]);

  const startSessionForRoom = useCallback(
    async (roomId: number) => {
      setLoadingSession(true);
      setCanvases([]);
      setAngles([]);
      setSelectedAngleId(null);
      setSelectedCanvasId(null);
      try {
        const room = allRooms.find((entry) => entry.id === roomId);
        const response = await fetch("/api/render/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            name: room ? `${room.displayName} render` : `Room ${roomId} render`,
            designConfig,
          }),
        });
        const payload = (await response.json()) as SessionResponse;
        const newId = payload.id ?? payload.session?.id;
        if (!response.ok || !newId) {
          throw new Error(payload.error ?? "Failed to create session");
        }
        setSessionId(newId);
        await loadSessionDetail(newId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to start session",
        );
      } finally {
        setLoadingSession(false);
      }
    },
    [allRooms, designConfig, loadSessionDetail],
  );

  const handleRoomChange = useCallback(
    (roomId: number | null) => {
      setSelectedRoomId(roomId);
      if (roomId == null) return;
      void startSessionForRoom(roomId);
    },
    [startSessionForRoom],
  );

  // ---- derived ------------------------------------------------------------

  const anglesCanvases = useMemo(() => {
    if (!selectedAngleId) return canvases;
    return canvases.filter(
      (canvas) =>
        canvas.listingPhotoId === selectedAngleId ||
        canvas.listingPhotoId === null,
    );
  }, [canvases, selectedAngleId]);

  const selectedAngle = useMemo(
    () => angles.find((angle) => angle.listingPhotoId === selectedAngleId) ?? null,
    [angles, selectedAngleId],
  );

  // The image the mask is painted over: the selected canvas output, else the
  // latest render for the angle, else the blank canvas.
  const maskTargetUrl = useMemo(() => {
    if (selectedCanvasId) {
      const canvas = canvases.find((entry) => entry.id === selectedCanvasId);
      if (canvas) {
        return resolveCfImageUrl(
          canvas.outputImageUrl || canvas.outputCfImageId || "",
        );
      }
    }
    if (selectedAngle?.latestRender) {
      return resolveCfImageUrl(
        selectedAngle.latestRender.outputImageUrl ||
          selectedAngle.latestRender.outputCfImageId ||
          "",
      );
    }
    return resolveCfImageUrl(selectedAngle?.blankCanvasUrl || "");
  }, [canvases, selectedAngle, selectedCanvasId]);

  // ---- mask runner (the page-level wiring for MaskConfigurator) ------------

  const handleRunStage = useCallback(
    async ({
      prompt,
      configJson,
      maskBlob,
    }: {
      prompt: string;
      configJson: string | null;
      maskBlob: Blob | null;
    }) => {
      if (!sessionId) {
        toast.error("Pick a room to start a session first");
        return;
      }
      const effectivePrompt = prompt || configJson || "";
      if (!effectivePrompt.trim()) {
        toast.error("Add a prompt or JSON config for this step");
        return;
      }

      setRunningStage(true);
      try {
        // 1. Upload the mask as its own Cloudflare Images asset (URL, not base64).
        let maskCfImageId: string | undefined;
        if (maskBlob) {
          const form = new FormData();
          form.append("file", maskBlob, "mask.png");
          form.append("photoCategory", "ai_render");
          const uploadRes = await fetch("/api/images/upload", {
            method: "POST",
            body: form,
          });
          const uploadPayload = (await uploadRes.json()) as UploadResponse;
          if (!uploadRes.ok || !(uploadPayload.id || uploadPayload.cfImageId)) {
            throw new Error(uploadPayload.error ?? "Failed to upload mask");
          }
          maskCfImageId = uploadPayload.cfImageId ?? uploadPayload.id;
        }

        // 2. Run the stage.
        const stageRes = await fetch("/api/render/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            canvasId: selectedCanvasId ?? undefined,
            actionType: STAGE_BUCKET_ACTION[selectedStage],
            branchLabel: "A",
            lightingProfile: designConfig.lighting,
            prompt: effectivePrompt.trim(),
            maskCfImageId,
          }),
        });
        const stagePayload = (await stageRes.json()) as StageResponse;
        if (!stageRes.ok || !stagePayload.canvas) {
          throw new Error(stagePayload.error ?? "Stage run failed");
        }
        toast.success("Pipeline step queued");
        await loadSessionDetail(sessionId);
        setSelectedCanvasId(stagePayload.canvas.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Stage run failed");
      } finally {
        setRunningStage(false);
      }
    },
    [designConfig.lighting, loadSessionDetail, selectedCanvasId, selectedStage, sessionId],
  );

  // ---- render -------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Pinned realtime status (renders null while IDLE). */}
      <PipelineStatusLoader socketUrl={REALTIME_SOCKET_URL} />

      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Hammer className="size-4 text-muted-foreground" />
            <div>
              <CardTitle>Renovation Studio</CardTitle>
              <CardDescription>
                Stage a design across a room&apos;s angles and branch variations.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sessionId && loadSessionDetail(sessionId)}
            disabled={!sessionId || loadingSession}
            className="gap-2"
          >
            <RefreshCw className={cn("size-4", loadingSession && "animate-spin")} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Room
            </span>
            <RoomSelect
              value={selectedRoomId}
              onChange={handleRoomChange}
              disabled={loadingCatalog}
              placeholder="Select a room"
              aria-label="Room"
              className="w-full"
            />
          </div>
        </CardContent>
      </Card>

      {!selectedRoomId ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Hammer className="size-7 text-muted-foreground" />
            <p className="text-sm font-medium">Pick a room to begin</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Selecting a room starts a render session and loads its blank-canvas
              angles, stage history, and branch tree.
            </p>
          </CardContent>
        </Card>
      ) : loadingSession && canvases.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading studio...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Main column */}
          <div className="space-y-6">
            <Card className="ring-1 ring-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Angles</CardTitle>
                <CardDescription>
                  Blank canvases and the latest render per angle.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AngleGallery
                  angles={angles}
                  selectedListingPhotoId={selectedAngleId}
                  onSelect={(id) => {
                    setSelectedAngleId(id);
                    setSelectedCanvasId(null);
                  }}
                />
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Stages</CardTitle>
              </CardHeader>
              <CardContent>
                <StageExplorer
                  canvases={anglesCanvases}
                  selectedStage={selectedStage}
                  onSelectStage={setSelectedStage}
                  selectedCanvasId={selectedCanvasId}
                  onSelectCanvas={setSelectedCanvasId}
                />
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Mask & Run</CardTitle>
                <CardDescription>
                  Paint the region to edit, then execute the pipeline step.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MaskConfigurator
                  imageUrl={maskTargetUrl}
                  onRunStage={handleRunStage}
                  running={runningStage}
                />
              </CardContent>
            </Card>
          </div>

          {/* Side column */}
          <div className="space-y-6">
            <DesignConfigPanel value={designConfig} onChange={setDesignConfig} />
            <BranchNavigator
              nodes={canvases}
              selectedCanvasId={selectedCanvasId}
              onSelect={setSelectedCanvasId}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default StudioBuilder;
