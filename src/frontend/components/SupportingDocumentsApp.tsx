import {
  Check,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type SourceType =
  | "pdf"
  | "image"
  | "video"
  | "screenshot"
  | "url"
  | "text"
  | "other";

type WorkspaceTab = "documents" | "vision";

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface ScenarioRecord {
  id: string;
  name: string;
  description?: string | null;
  plans?: Array<{
    id: string;
    roomId: number;
    proposedUse: string;
    stage: string;
  }>;
}

interface SupportingDocumentRecord {
  id: string;
  title: string;
  sourceType: SourceType;
  mimeType?: string | null;
  r2Url?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  aiRationale?: string | null;
  isActive: boolean;
  isFactRecord: boolean;
  revisionNumber: number;
  revisionOfId?: string | null;
  replacedById?: string | null;
  datetimeCreated?: string | number | Date | null;
  datetimeUpdated?: string | number | Date | null;
  tags?: string[];
  roomIds?: number[];
  roomLabels?: string[];
  scenarioIds?: string[];
  scenarioNames?: string[];
  visionNodeIds?: string[];
  visionNodeTitles?: string[];
}

interface VisionNodeRecord {
  id: string;
  parentId?: string | null;
  scenarioId?: string | null;
  title: string;
  summary?: string | null;
  nodeType: string;
  status: string;
  estimatedCostCents?: number | null;
  sortOrder: number;
  roomIds: number[];
  roomLabels: string[];
  supportingDocumentIds: string[];
  supportingDocuments: SupportingDocumentRecord[];
  imageRefs: Array<{
    imageId: string;
    relationType: string;
    image?: {
      id: string;
      displayName?: string | null;
      cfImageIdOriginal: string;
      cfImageIdOptimized?: string | null;
    } | null;
  }>;
}

interface VisionNodeTreeRecord extends VisionNodeRecord {
  children: VisionNodeTreeRecord[];
}

function formatCurrency(valueCents: number | null | undefined): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return "n/a";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

function formatDate(value: SupportingDocumentRecord["datetimeUpdated"]): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function resolveImageUrl(image: {
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
}): string {
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

function DocumentNode(props: {
  node: VisionNodeTreeRecord;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
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
          "w-full rounded-lg border p-3 text-left transition",
          selected ? "border-primary bg-primary/10" : "border-border/50 hover:bg-muted/20",
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
        {node.summary ? <p className="mt-2 text-xs text-muted-foreground">{node.summary}</p> : null}
      </button>
      {node.children.map((child) => (
        <DocumentNode
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

export function SupportingDocumentsApp() {
  const [tab, setTab] = useState<WorkspaceTab>("documents");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [creatingNode, setCreatingNode] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<SupportingDocumentRecord[]>([]);
  const [rooms, setRooms] = useState<CatalogRoom[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [visionNodes, setVisionNodes] = useState<VisionNodeRecord[]>([]);
  const [visionTree, setVisionTree] = useState<VisionNodeTreeRecord[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadSourceType, setUploadSourceType] = useState<SourceType>("other");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadAiRationale, setUploadAiRationale] = useState("");
  const [uploadIsFactRecord, setUploadIsFactRecord] = useState(false);
  const [uploadRoomIds, setUploadRoomIds] = useState<string[]>([]);
  const [uploadScenarioIds, setUploadScenarioIds] = useState<string[]>([]);
  const [uploadVisionNodeIds, setUploadVisionNodeIds] = useState<string[]>([]);

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editAiRationale, setEditAiRationale] = useState("");
  const [editIsFactRecord, setEditIsFactRecord] = useState(false);
  const [editRoomIds, setEditRoomIds] = useState<string[]>([]);
  const [editScenarioIds, setEditScenarioIds] = useState<string[]>([]);
  const [editVisionNodeIds, setEditVisionNodeIds] = useState<string[]>([]);

  const [newNodeTitle, setNewNodeTitle] = useState("");
  const [newNodeSummary, setNewNodeSummary] = useState("");
  const [newNodeStatus, setNewNodeStatus] = useState("considering");
  const [newNodeType, setNewNodeType] = useState("option");
  const [newNodeScenarioId, setNewNodeScenarioId] = useState("");
  const [newNodeParentId, setNewNodeParentId] = useState("");
  const [newNodeCost, setNewNodeCost] = useState("");
  const [newNodeRoomIds, setNewNodeRoomIds] = useState<string[]>([]);

  const selectedDoc = useMemo(
    () => docs.find((doc) => doc.id === selectedDocId) || null,
    [docs, selectedDocId],
  );

  const selectedNode = useMemo(
    () => visionNodes.find((node) => node.id === selectedNodeId) || null,
    [visionNodes, selectedNodeId],
  );

  const roomOptions = useMemo(
    () =>
      rooms.map((room) => ({
        value: String(room.id),
        label: `${room.floorName} • ${room.displayName}`,
      })),
    [rooms],
  );

  const scenarioOptions = useMemo(
    () =>
      scenarios.map((scenario) => ({
        value: scenario.id,
        label: scenario.name,
      })),
    [scenarios],
  );

  const visionNodeOptions = useMemo(
    () =>
      visionNodes.map((node) => ({
        value: node.id,
        label: node.title,
      })),
    [visionNodes],
  );

  const loadAllData = useCallback(async (setLoadingState: boolean) => {
    if (setLoadingState) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const [docRes, catalogRes, scenarioRes, nodeRes] = await Promise.all([
        fetch("/api/supporting-documents"),
        fetch("/api/rooms/catalog"),
        fetch("/api/rooms/scenarios"),
        fetch("/api/vision-nodes"),
      ]);
      const docPayload = (await docRes.json()) as {
        success?: boolean;
        documents?: SupportingDocumentRecord[];
      };
      const catalogPayload = (await catalogRes.json()) as {
        success?: boolean;
        floors?: Array<{
          key: string;
          name: string;
          rooms?: CatalogRoom[];
        }>;
      };
      const scenarioPayload = (await scenarioRes.json()) as {
        success?: boolean;
        scenarios?: ScenarioRecord[];
      };
      const nodePayload = (await nodeRes.json()) as {
        success?: boolean;
        nodes?: VisionNodeRecord[];
        tree?: VisionNodeTreeRecord[];
      };

      if (!docRes.ok || !docPayload.success) {
        throw new Error("Failed to load supporting documents");
      }
      if (!catalogRes.ok || !catalogPayload.success) {
        throw new Error("Failed to load rooms catalog");
      }
      if (!scenarioRes.ok || !scenarioPayload.success) {
        throw new Error("Failed to load scenarios");
      }
      if (!nodeRes.ok || !nodePayload.success) {
        throw new Error("Failed to load vision nodes");
      }

      const nextDocs = docPayload.documents || [];
      const nextRooms =
        (catalogPayload.floors || []).flatMap((floor) =>
          (floor.rooms || []).map((room) => ({
            ...room,
            floorKey: floor.key,
            floorName: floor.name,
          })),
        ) || [];
      const nextScenarios = scenarioPayload.scenarios || [];
      const nextNodes = nodePayload.nodes || [];
      const nextTree = nodePayload.tree || [];

      setDocs(nextDocs);
      setRooms(nextRooms);
      setScenarios(nextScenarios);
      setVisionNodes(nextNodes);
      setVisionTree(nextTree);

      if (!selectedDocId && nextDocs.length > 0) {
        setSelectedDocId(nextDocs[0].id);
      } else if (selectedDocId && !nextDocs.some((doc) => doc.id === selectedDocId)) {
        setSelectedDocId(nextDocs[0]?.id || null);
      }

      if (!selectedNodeId && nextNodes.length > 0) {
        setSelectedNodeId(nextNodes[0].id);
      } else if (selectedNodeId && !nextNodes.some((node) => node.id === selectedNodeId)) {
        setSelectedNodeId(nextNodes[0]?.id || null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load supporting workspace");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDocId, selectedNodeId]);

  useEffect(() => {
    void loadAllData(true);
  }, [loadAllData]);

  useEffect(() => {
    if (!selectedDoc) {
      setEditTitle("");
      setEditDescription("");
      setEditTags("");
      setEditAiRationale("");
      setEditIsFactRecord(false);
      setEditRoomIds([]);
      setEditScenarioIds([]);
      setEditVisionNodeIds([]);
      return;
    }
    setEditTitle(selectedDoc.title);
    setEditDescription(selectedDoc.description || "");
    setEditTags((selectedDoc.tags || []).join(", "));
    setEditAiRationale(selectedDoc.aiRationale || "");
    setEditIsFactRecord(Boolean(selectedDoc.isFactRecord));
    setEditRoomIds((selectedDoc.roomIds || []).map((id) => String(id)));
    setEditScenarioIds(selectedDoc.scenarioIds || []);
    setEditVisionNodeIds(selectedDoc.visionNodeIds || []);
  }, [selectedDoc]);

  const uploadDocuments = useCallback(async () => {
    if (files.length === 0) {
      toast.error("Add at least one file to upload");
      return;
    }
    setUploading(true);
    try {
      let successCount = 0;
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        if (uploadTitle.trim()) formData.append("title", uploadTitle.trim());
        if (uploadDescription.trim()) formData.append("description", uploadDescription.trim());
        if (uploadSourceType) formData.append("sourceType", uploadSourceType);
        if (uploadTags.trim()) formData.append("tags", uploadTags.trim());
        if (uploadAiRationale.trim()) formData.append("aiRationale", uploadAiRationale.trim());
        formData.append("isFactRecord", String(uploadIsFactRecord));
        for (const roomId of uploadRoomIds) {
          formData.append("roomIds", roomId);
        }
        for (const scenarioId of uploadScenarioIds) {
          formData.append("scenarioIds", scenarioId);
        }
        for (const nodeId of uploadVisionNodeIds) {
          formData.append("visionNodeIds", nodeId);
        }

        const response = await fetch("/api/supporting-documents/upload", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `Failed uploading ${file.name}`);
        }
        successCount += 1;
      }

      setFiles([]);
      setUploadTitle("");
      setUploadDescription("");
      setUploadTags("");
      setUploadAiRationale("");
      setUploadIsFactRecord(false);
      setUploadRoomIds([]);
      setUploadScenarioIds([]);
      setUploadVisionNodeIds([]);
      toast.success(`Uploaded ${successCount} supporting document${successCount === 1 ? "" : "s"}`);
      await loadAllData(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload supporting documents");
    } finally {
      setUploading(false);
    }
  }, [
    files,
    loadAllData,
    uploadAiRationale,
    uploadDescription,
    uploadIsFactRecord,
    uploadRoomIds,
    uploadScenarioIds,
    uploadSourceType,
    uploadTags,
    uploadTitle,
    uploadVisionNodeIds,
  ]);

  const saveSelectedDocument = useCallback(async (createRevision: boolean) => {
    if (!selectedDoc) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error("Title is required");
      return;
    }

    setSavingDoc(true);
    try {
      const response = await fetch(`/api/supporting-documents/${selectedDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: editDescription.trim() || null,
          tags: editTags.trim()
            ? editTags
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
            : [],
          aiRationale: editAiRationale.trim() || null,
          isFactRecord: editIsFactRecord,
          roomIds: editRoomIds.map((value) => Number(value)),
          scenarioIds: editScenarioIds,
          visionNodeIds: editVisionNodeIds,
          createRevision,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        document?: SupportingDocumentRecord;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save document");
      }
      toast.success(createRevision ? "Created new document revision" : "Saved document");
      await loadAllData(false);
      if (payload.document?.id) {
        setSelectedDocId(payload.document.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save document");
    } finally {
      setSavingDoc(false);
    }
  }, [
    editAiRationale,
    editDescription,
    editIsFactRecord,
    editRoomIds,
    editScenarioIds,
    editTags,
    editTitle,
    editVisionNodeIds,
    loadAllData,
    selectedDoc,
  ]);

  const createVisionNode = useCallback(async () => {
    const title = newNodeTitle.trim();
    if (!title) {
      toast.error("Node title is required");
      return;
    }

    setCreatingNode(true);
    try {
      const costRaw = Number.parseFloat(newNodeCost);
      const response = await fetch("/api/vision-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary: newNodeSummary.trim() || null,
          status: newNodeStatus,
          nodeType: newNodeType,
          scenarioId: newNodeScenarioId || null,
          parentId: newNodeParentId || null,
          estimatedCostCents: Number.isFinite(costRaw) ? Math.round(costRaw * 100) : null,
          roomIds: newNodeRoomIds.map((value) => Number(value)),
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        node?: VisionNodeRecord;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to create vision node");
      }

      setNewNodeTitle("");
      setNewNodeSummary("");
      setNewNodeStatus("considering");
      setNewNodeType("option");
      setNewNodeScenarioId("");
      setNewNodeParentId("");
      setNewNodeCost("");
      setNewNodeRoomIds([]);
      toast.success("Vision node created");
      await loadAllData(false);
      if (payload.node?.id) {
        setSelectedNodeId(payload.node.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create vision node");
    } finally {
      setCreatingNode(false);
    }
  }, [
    loadAllData,
    newNodeCost,
    newNodeParentId,
    newNodeRoomIds,
    newNodeScenarioId,
    newNodeStatus,
    newNodeSummary,
    newNodeTitle,
    newNodeType,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[45svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading supporting documents workspace...
      </div>
    );
  }

  const activeDocCount = docs.filter((doc) => doc.isActive).length;
  const factDocCount = docs.filter((doc) => doc.isFactRecord && doc.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Supporting Documents</h2>
          <p className="text-sm text-muted-foreground">
            Index immutable facts, map artifacts to rooms and branches, and keep revision history intact.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAllData(false)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="ring-1 ring-border/40">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active documents</p>
            <p className="text-2xl font-semibold">{activeDocCount}</p>
          </CardContent>
        </Card>
        <Card className="ring-1 ring-border/40">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Fact records</p>
            <p className="text-2xl font-semibold">{factDocCount}</p>
          </CardContent>
        </Card>
        <Card className="ring-1 ring-border/40">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Vision branches</p>
            <p className="text-2xl font-semibold">{visionNodes.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="inline-flex rounded-md border border-border/60 bg-muted/20 p-1">
        <button
          type="button"
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium",
            tab === "documents" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
          onClick={() => setTab("documents")}
        >
          Documents
        </button>
        <button
          type="button"
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium",
            tab === "vision" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
          onClick={() => setTab("vision")}
        >
          Vision Branches
        </button>
      </div>

      {tab === "documents" ? (
        <div className="space-y-6">
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Upload Supporting Artifacts</CardTitle>
              <CardDescription>
                Upload PDFs, images, videos, and screenshot references. Apply room/scenario/branch mappings in one pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title (optional override)</p>
                  <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="1971 Structural Blueprint - Sheet A5" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source Type</p>
                  <Select value={uploadSourceType} onValueChange={(value) => setUploadSourceType(value as SourceType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select source type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="other">Auto / Other</SelectItem>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="screenshot">Screenshot</SelectItem>
                      <SelectItem value="url">URL Capture</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
                <Textarea
                  value={uploadDescription}
                  onChange={(event) => setUploadDescription(event.target.value)}
                  rows={3}
                  placeholder="Why this artifact matters for design and contractor coordination."
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
                  <Input value={uploadTags} onChange={(event) => setUploadTags(event.target.value)} placeholder="structure, footing, kitchen-wall, permit" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Rationale (optional)</p>
                  <Input value={uploadAiRationale} onChange={(event) => setUploadAiRationale(event.target.value)} placeholder="Why this was linked to these rooms/branches." />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rooms</p>
                  <MultipleSelector
                    title="Select rooms"
                    placeholder="Map rooms"
                    options={roomOptions}
                    value={uploadRoomIds}
                    onValueChange={setUploadRoomIds}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenarios</p>
                  <MultipleSelector
                    title="Select scenarios"
                    placeholder="Map scenarios"
                    options={scenarioOptions}
                    value={uploadScenarioIds}
                    onValueChange={setUploadScenarioIds}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vision Branch Nodes</p>
                  <MultipleSelector
                    title="Select branch nodes"
                    placeholder="Map nodes"
                    options={visionNodeOptions}
                    value={uploadVisionNodeIds}
                    onValueChange={setUploadVisionNodeIds}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Immutable fact record</p>
                  <p className="text-xs text-muted-foreground">
                    Use for foundational references (e.g., original blueprint sheets).
                  </p>
                </div>
                <Switch checked={uploadIsFactRecord} onCheckedChange={setUploadIsFactRecord} />
              </div>

              <FileUpload value={files} onValueChange={setFiles} multiple disabled={uploading}>
                <FileUploadDropzone className="gap-3 rounded-xl border-border/50 bg-muted/20 p-7 text-center">
                  <Upload className="size-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Drop supporting files</p>
                    <p className="text-xs text-muted-foreground">PDF, image, video, and screenshot artifacts are supported.</p>
                  </div>
                  <FileUploadTrigger asChild>
                    <Button size="sm" variant="secondary">Browse Files</Button>
                  </FileUploadTrigger>
                </FileUploadDropzone>

                <div className="flex items-center justify-between">
                  <FileUploadClear asChild>
                    <Button variant="ghost" size="sm" disabled={uploading}>Clear</Button>
                  </FileUploadClear>
                  <Button size="sm" onClick={() => void uploadDocuments()} disabled={uploading || files.length === 0}>
                    {uploading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Uploading
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 size-4" />
                        Upload Supporting Docs
                      </>
                    )}
                  </Button>
                </div>

                <FileUploadList className="max-h-56 overflow-y-auto pr-1">
                  {files.map((file) => (
                    <FileUploadItem key={`${file.name}-${file.size}-${file.lastModified}`} value={file} className="gap-3 rounded-lg border-border/40 bg-card/60 px-3 py-2">
                      <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
                      <FileUploadItemMetadata size="sm" />
                      <FileUploadItemDelete />
                    </FileUploadItem>
                  ))}
                </FileUploadList>
              </FileUpload>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="text-base">Document Index</CardTitle>
                <CardDescription>Searchable source-of-truth records with revision-safe history.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {docs.map((doc) => {
                  const selected = doc.id === selectedDocId;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      className={cn(
                        "w-full rounded-md border p-3 text-left",
                        selected ? "border-primary bg-primary/10" : "border-border/50 hover:bg-muted/20",
                      )}
                      onClick={() => setSelectedDocId(doc.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{doc.title}</p>
                        <Badge variant={doc.isActive ? "default" : "secondary"}>
                          {doc.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {doc.sourceType} • rev {doc.revisionNumber} • updated {formatDate(doc.datetimeUpdated)}
                      </p>
                      {doc.roomLabels?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {doc.roomLabels.slice(0, 4).map((label) => (
                            <Badge key={`${doc.id}-${label}`} variant="secondary" className="text-[10px]">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="text-base">Document Detail</CardTitle>
                <CardDescription>
                  Update metadata or create a new immutable revision for this record.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedDoc ? (
                  <p className="text-sm text-muted-foreground">Select a document from the index.</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</p>
                      <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
                      <Textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={3} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
                        <Input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="comma separated tags" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Rationale</p>
                        <Input value={editAiRationale} onChange={(event) => setEditAiRationale(event.target.value)} placeholder="Why this mapping/change exists" />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rooms</p>
                        <MultipleSelector
                          title="Select rooms"
                          placeholder="Map rooms"
                          options={roomOptions}
                          value={editRoomIds}
                          onValueChange={setEditRoomIds}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenarios</p>
                        <MultipleSelector
                          title="Select scenarios"
                          placeholder="Map scenarios"
                          options={scenarioOptions}
                          value={editScenarioIds}
                          onValueChange={setEditScenarioIds}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vision Nodes</p>
                        <MultipleSelector
                          title="Select vision nodes"
                          placeholder="Map nodes"
                          options={visionNodeOptions}
                          value={editVisionNodeIds}
                          onValueChange={setEditVisionNodeIds}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">Fact record</p>
                        <p className="text-xs text-muted-foreground">Use for immutable references and source facts.</p>
                      </div>
                      <Switch checked={editIsFactRecord} onCheckedChange={setEditIsFactRecord} />
                    </div>

                    {selectedDoc.r2Url ? (
                      <a
                        href={selectedDoc.r2Url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-sm text-primary hover:underline"
                      >
                        <FileText className="mr-2 size-4" />
                        Open artifact
                      </a>
                    ) : selectedDoc.externalUrl ? (
                      <a
                        href={selectedDoc.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-sm text-primary hover:underline"
                      >
                        <FileText className="mr-2 size-4" />
                        Open external source
                      </a>
                    ) : null}

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button onClick={() => void saveSelectedDocument(false)} disabled={savingDoc}>
                        {savingDoc ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                        Save In Place
                      </Button>
                      <Button variant="outline" onClick={() => void saveSelectedDocument(true)} disabled={savingDoc}>
                        {savingDoc ? <Loader2 className="mr-2 size-4 animate-spin" /> : <GitBranch className="mr-2 size-4" />}
                        Create Revision
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Create Vision Branch Node</CardTitle>
              <CardDescription>
                Build branchable decision nodes (e.g., kitchen downstairs left vs right).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</p>
                <Input value={newNodeTitle} onChange={(event) => setNewNodeTitle(event.target.value)} placeholder="Kitchen Downstairs - Living Room Side" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
                <Textarea value={newNodeSummary} onChange={(event) => setNewNodeSummary(event.target.value)} rows={3} placeholder="Pros, constraints, and dependencies for this branch." />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Node Type</p>
                  <Select value={newNodeType} onValueChange={setNewNodeType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="root">Root</SelectItem>
                      <SelectItem value="branch">Branch</SelectItem>
                      <SelectItem value="option">Option</SelectItem>
                      <SelectItem value="risk">Risk</SelectItem>
                      <SelectItem value="milestone">Milestone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                  <Select value={newNodeStatus} onValueChange={setNewNodeStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="considering">Considering</SelectItem>
                      <SelectItem value="preferred">Preferred</SelectItem>
                      <SelectItem value="deferred">Deferred</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      <SelectItem value="decided">Decided</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenario</p>
                  <Select value={newNodeScenarioId || "none"} onValueChange={(value) => setNewNodeScenarioId(value === "none" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional scenario link" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Scenario</SelectItem>
                      {scenarios.map((scenario) => (
                        <SelectItem key={scenario.id} value={scenario.id}>
                          {scenario.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent Node</p>
                  <Select value={newNodeParentId || "none"} onValueChange={(value) => setNewNodeParentId(value === "none" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional parent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Parent (Root)</SelectItem>
                      {visionNodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimated Cost (USD)</p>
                  <Input value={newNodeCost} onChange={(event) => setNewNodeCost(event.target.value)} placeholder="45000" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rooms</p>
                  <MultipleSelector
                    title="Select rooms"
                    placeholder="Link rooms"
                    options={roomOptions}
                    value={newNodeRoomIds}
                    onValueChange={setNewNodeRoomIds}
                  />
                </div>
              </div>

              <Button onClick={() => void createVisionNode()} disabled={creatingNode} className="w-full">
                {creatingNode ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                Create Vision Node
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="text-base">Branch Tree</CardTitle>
                <CardDescription>
                  Click a branch node to inspect mapped rooms, documents, and visual references.
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {visionTree.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No vision branches yet.</p>
                ) : (
                  visionTree.map((node) => (
                    <DocumentNode key={node.id} node={node} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="text-base">Selected Node Detail</CardTitle>
                <CardDescription>
                  Branch-specific documents, cost assumptions, and reference images.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedNode ? (
                  <p className="text-sm text-muted-foreground">Select a node from the tree.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{selectedNode.title}</p>
                      <Badge variant="secondary">{selectedNode.status}</Badge>
                    </div>
                    {selectedNode.summary ? (
                      <p className="text-sm text-muted-foreground">{selectedNode.summary}</p>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-border/50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
                        <p className="text-sm">{selectedNode.nodeType}</p>
                      </div>
                      <div className="rounded-md border border-border/50 px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated Cost</p>
                        <p className="text-sm">{formatCurrency(selectedNode.estimatedCostCents)}</p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked Rooms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNode.roomLabels.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No rooms linked.</span>
                        ) : (
                          selectedNode.roomLabels.map((label) => (
                            <Badge key={`${selectedNode.id}-${label}`} variant="secondary">
                              {label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked Documents</p>
                      <div className="space-y-1.5">
                        {selectedNode.supportingDocuments.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No supporting documents mapped.</p>
                        ) : (
                          selectedNode.supportingDocuments.map((doc) => (
                            <button
                              key={`node-doc-${doc.id}`}
                              type="button"
                              className="w-full rounded-md border border-border/50 px-2.5 py-2 text-left hover:bg-muted/20"
                              onClick={() => {
                                setTab("documents");
                                setSelectedDocId(doc.id);
                              }}
                            >
                              <p className="truncate text-sm font-medium">{doc.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {doc.sourceType} • rev {doc.revisionNumber}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Reference Images</p>
                      {selectedNode.imageRefs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No images linked.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {selectedNode.imageRefs.map((entry) => {
                            if (!entry.image) return null;
                            const imageUrl = resolveImageUrl(entry.image);
                            return (
                              <div key={`node-image-${entry.imageId}-${entry.relationType}`} className="overflow-hidden rounded-md border border-border/50">
                                {/* biome-ignore lint/performance/noImgElement: external image delivery URLs are expected */}
                                <img src={imageUrl} alt={entry.image.displayName || "Node image"} className="aspect-[4/3] w-full object-cover" />
                                <div className="px-2 py-1.5">
                                  <p className="truncate text-xs font-medium">
                                    {entry.image.displayName || "Untitled image"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">{entry.relationType}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
