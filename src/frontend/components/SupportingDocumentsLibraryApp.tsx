import {
  ArrowUpRight,
  FileText,
  GitBranch,
  Layers3,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RoomSelect } from "@/components/ui/room-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SourceType =
  | "pdf"
  | "image"
  | "video"
  | "screenshot"
  | "url"
  | "text"
  | "other";

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface SupportingDocumentRecord {
  id: string;
  title: string;
  sourceType: SourceType;
  r2Url?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  tags?: string[];
  roomIds?: number[];
  roomLabels?: string[];
  visionNodeIds?: string[];
  visionNodeTitles?: string[];
  datetimeUpdated?: string | number | Date | null;
}

interface VisionNodeRecord {
  id: string;
  parentId?: string | null;
  title: string;
  summary?: string | null;
  nodeType: string;
  status: string;
  estimatedCostCents?: number | null;
  roomIds: number[];
  roomLabels: string[];
  supportingDocumentIds: string[];
  children?: VisionNodeRecord[];
}

function formatDate(value: SupportingDocumentRecord["datetimeUpdated"]): string {
  if (!value) return "Unknown update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown update";
  return date.toLocaleDateString();
}

function formatCurrency(valueCents: number | null | undefined): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return "n/a";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

function NodeTree(props: {
  node: VisionNodeRecord;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  depth?: number;
}) {
  const { node, selectedNodeId, onSelect, depth = 0 } = props;
  const selected = selectedNodeId === node.id;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          "w-full rounded-xl border px-3 py-3 text-left transition",
          selected ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/20",
        )}
        style={{ marginLeft: depth > 0 ? `${depth * 0.75}rem` : undefined }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{node.title}</p>
            <p className="text-xs text-muted-foreground">
              {node.nodeType} • {node.status}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary">{node.roomLabels.length} rooms</Badge>
            <Badge variant="secondary">{node.supportingDocumentIds.length} docs</Badge>
          </div>
        </div>
        {node.summary ? (
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.summary}</p>
        ) : null}
      </button>
      {(node.children || []).map((child) => (
        <NodeTree
          key={child.id}
          node={child}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function SupportingDocumentsLibraryApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [docs, setDocs] = useState<SupportingDocumentRecord[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [nodeTree, setNodeTree] = useState<VisionNodeRecord[]>([]);
  const [flatNodes, setFlatNodes] = useState<VisionNodeRecord[]>([]);
  // Room filter: null = "All rooms" (the <RoomSelect> "All" sentinel), else a
  // canonical active room id.
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("all");
  const [selectedSourceType, setSelectedSourceType] = useState<string>("all");

  const loadData = useCallback(async (setLoadingState: boolean) => {
    if (setLoadingState) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [docsRes, roomsRes, nodesRes] = await Promise.all([
        fetch("/api/supporting-documents"),
        fetch("/api/rooms/catalog"),
        fetch("/api/vision-nodes"),
      ]);

      const docsPayload = (await docsRes.json()) as {
        success?: boolean;
        documents?: SupportingDocumentRecord[];
      };
      const roomsPayload = (await roomsRes.json()) as {
        success?: boolean;
        floors?: Array<{
          key: string;
          name: string;
          rooms?: CatalogRoom[];
        }>;
      };
      const nodesPayload = (await nodesRes.json()) as {
        success?: boolean;
        nodes?: VisionNodeRecord[];
        tree?: VisionNodeRecord[];
      };

      if (!docsRes.ok || !docsPayload.success) {
        throw new Error("Failed to load supporting records");
      }
      if (!roomsRes.ok || !roomsPayload.success) {
        throw new Error("Failed to load room catalog");
      }
      if (!nodesRes.ok || !nodesPayload.success) {
        throw new Error("Failed to load vision nodes");
      }

      const nextRooms =
        roomsPayload.floors?.flatMap((floor) =>
          (floor.rooms || []).map((room) => ({
            ...room,
            floorKey: floor.key,
            floorName: floor.name,
          })),
        ) || [];

      setDocs(docsPayload.documents || []);
      setRooms(nextRooms);
      setFlatNodes(nodesPayload.nodes || []);
      setNodeTree(nodesPayload.tree || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load project records");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("roomId");
    const nodeId = params.get("visionNodeId");
    if (roomId) {
      const parsed = Number(roomId);
      setSelectedRoomId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    }
    if (nodeId) {
      setSelectedNodeId(nodeId);
    }
  }, []);

  const selectedNode = useMemo(
    () => flatNodes.find((node) => node.id === selectedNodeId) || null,
    [flatNodes, selectedNodeId],
  );

  const filteredDocs = useMemo(() => {
    return docs.filter((doc) => {
      if (selectedRoomId != null && !(doc.roomIds || []).includes(selectedRoomId)) {
        return false;
      }
      if (selectedNodeId !== "all" && !(doc.visionNodeIds || []).includes(selectedNodeId)) {
        return false;
      }
      if (selectedSourceType !== "all" && doc.sourceType !== selectedSourceType) {
        return false;
      }
      return true;
    });
  }, [docs, selectedNodeId, selectedRoomId, selectedSourceType]);

  const filteredTree = useMemo(() => {
    if (selectedRoomId == null) {
      return nodeTree;
    }
    return nodeTree.filter((node) => (node.roomIds || []).includes(selectedRoomId));
  }, [nodeTree, selectedRoomId]);

  const sourceCounts = useMemo(() => {
    const next = new Map<string, number>();
    for (const doc of filteredDocs) {
      next.set(doc.sourceType, (next.get(doc.sourceType) || 0) + 1);
    }
    return next;
  }, [filteredDocs]);

  if (loading) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading project records...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Contractor Records Library</h2>
          <p className="text-sm text-muted-foreground">
            Browse supporting documents, room references, and branching vision nodes without the
            admin editing workspace.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="ring-1 ring-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Visible Records</CardTitle>
            <CardDescription>Filtered supporting-doc count</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{filteredDocs.length}</p>
          </CardContent>
        </Card>
        <Card className="ring-1 ring-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vision Nodes</CardTitle>
            <CardDescription>Branch options in scope</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {selectedRoomId == null
                ? flatNodes.length
                : flatNodes.filter((node) => node.roomIds.includes(selectedRoomId)).length}
            </p>
          </CardContent>
        </Card>
        <Card className="ring-1 ring-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active Room Filter</CardTitle>
            <CardDescription>Current room focus</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {selectedRoomId == null
                ? "All rooms"
                : rooms.find((room) => room.id === selectedRoomId)?.displayName || "Room"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Focus records by room, node, or source type</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {/* Room filter — shared <RoomSelect> (§C4) with an explicit "All rooms"
              sentinel; floor-grouped, searchable, active-only, display names. */}
          <RoomSelect
            value={selectedRoomId}
            onChange={setSelectedRoomId}
            includeAllOption
            allOptionLabel="All rooms"
            placeholder="All rooms"
            aria-label="Filter by room"
            className="w-full"
          />

          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger>
              <SelectValue placeholder="All vision nodes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vision nodes</SelectItem>
              {flatNodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedSourceType} onValueChange={setSelectedSourceType}>
            <SelectTrigger>
              <SelectValue placeholder="All source types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All source types</SelectItem>
              {Array.from(sourceCounts.keys()).sort().map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Supporting Records</CardTitle>
            <CardDescription>Blueprints, screenshots, notes, and linked references</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredDocs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                No records match the current filters.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const href = doc.r2Url || doc.externalUrl || null;
                return (
                  <article key={doc.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{doc.title}</p>
                          <Badge variant="secondary">{doc.sourceType}</Badge>
                          <Badge variant="outline">{formatDate(doc.datetimeUpdated)}</Badge>
                        </div>
                        {doc.description ? (
                          <p className="text-sm leading-6 text-muted-foreground">{doc.description}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {(doc.roomLabels || []).slice(0, 4).map((label) => (
                            <span key={`${doc.id}-${label}`} className="rounded bg-muted px-2 py-1">
                              {label}
                            </span>
                          ))}
                          {(doc.visionNodeTitles || []).slice(0, 3).map((label) => (
                            <span key={`${doc.id}-node-${label}`} className="rounded bg-muted px-2 py-1">
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>

                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className={cn("inline-flex items-center gap-2 text-sm text-primary hover:underline")}
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

        <div className="space-y-4">
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Vision Node Map</CardTitle>
              <CardDescription>Room-linked option batches and decision branches</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredTree.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  No vision nodes are linked to this filter yet.
                </div>
              ) : (
                filteredTree.map((node) => (
                  <NodeTree
                    key={node.id}
                    node={node}
                    selectedNodeId={selectedNodeId === "all" ? null : selectedNodeId}
                    onSelect={setSelectedNodeId}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Selected Node</CardTitle>
              <CardDescription>Current branch details</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedNode ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      <GitBranch className="mr-1 size-3.5" />
                      {selectedNode.nodeType}
                    </Badge>
                    <Badge variant="outline">{selectedNode.status}</Badge>
                    <Badge variant="outline">
                      <Layers3 className="mr-1 size-3.5" />
                      {selectedNode.supportingDocumentIds.length} docs
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{selectedNode.title}</p>
                    {selectedNode.summary ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedNode.summary}</p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Rooms</p>
                      <p className="mt-2 text-sm font-medium">
                        {selectedNode.roomLabels.length > 0
                          ? selectedNode.roomLabels.join(", ")
                          : "Not room-scoped"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Budget Signal</p>
                      <p className="mt-2 text-sm font-medium">
                        {formatCurrency(selectedNode.estimatedCostCents)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`/floor-plan`}
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    Open floorplan gallery
                    <Link2 className="size-4" />
                  </a>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  Select a node to inspect its room coverage and supporting docs.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
