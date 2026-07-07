import {
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { AssociationsDialog } from "./AssociationsDialog";
import { DocumentUploader } from "./DocumentUploader";
import {
  type AdminDocument,
  apiGet,
  apiSend,
  ExtractionBadge,
  EXTRACTION_STATUSES,
  type ExtractionStatus,
  formatDocDate,
  SourceTypeIcon,
  SOURCE_TYPES,
  type SourceType,
  TagChip,
  VisibilityBadge,
  type Visibility,
} from "./shared";

interface AdminDocsResponse {
  success: boolean;
  count: number;
  documents: AdminDocument[];
}

interface SettingsResponse {
  success: boolean;
  document: AdminDocument | null;
}

const ALL = "__all__";

export function AdminDocsApp() {
  const [docs, setDocs] = useState<AdminDocument[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const [assocDoc, setAssocDoc] = useState<AdminDocument | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const payload = await apiGet<AdminDocsResponse>("/api/supporting-documents");
      setDocs(payload.documents ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load documents");
      setDocs((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const patchSettings = useCallback(
    async (doc: AdminDocument, body: Record<string, unknown>) => {
      setBusyId(doc.id);
      try {
        const payload = await apiSend<SettingsResponse>(
          `/api/supporting-documents/${doc.id}/settings`,
          "PATCH",
          body,
        );
        if (payload.document) {
          const updated = payload.document;
          setDocs((prev) =>
            prev ? prev.map((d) => (d.id === doc.id ? { ...d, ...updated } : d)) : prev,
          );
        }
        toast.success("Saved");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save");
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const toggleVisibility = useCallback(
    (doc: AdminDocument) => {
      const next: Visibility = doc.visibility === "public" ? "private" : "public";
      void patchSettings(doc, { visibility: next });
    },
    [patchSettings],
  );

  const reextract = useCallback(async (doc: AdminDocument) => {
    setBusyId(doc.id);
    try {
      await apiSend(`/api/supporting-documents/${doc.id}/reextract`, "POST");
      setDocs((prev) =>
        prev
          ? prev.map((d) =>
              d.id === doc.id ? { ...d, extractionStatus: "pending" as ExtractionStatus } : d,
            )
          : prev,
      );
      toast.success("Re-extraction queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue re-extraction");
    } finally {
      setBusyId(null);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const q = search.trim().toLowerCase();
    return docs.filter((doc) => {
      if (visibilityFilter !== ALL && doc.visibility !== visibilityFilter) return false;
      if (sourceFilter !== ALL && doc.sourceType !== sourceFilter) return false;
      if (statusFilter !== ALL && doc.extractionStatus !== statusFilter) return false;
      if (q) {
        const haystack = `${doc.title} ${doc.docType ?? ""} ${doc.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [docs, search, visibilityFilter, sourceFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <FileText className="size-6 text-muted-foreground" />
          Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload, classify, and control the visibility of every project document. Text extraction
          runs automatically on upload.
        </p>
      </header>

      {/* Upload */}
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Upload documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentUploader onUploaded={() => void load(false)} />
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, type, tags…"
            className="pl-9"
            aria-label="Search documents"
          />
        </div>
        <FilterSelect
          value={visibilityFilter}
          onValueChange={setVisibilityFilter}
          placeholder="Visibility"
          options={[
            { value: ALL, label: "All visibility" },
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
        />
        <FilterSelect
          value={sourceFilter}
          onValueChange={setSourceFilter}
          placeholder="Source"
          options={[
            { value: ALL, label: "All sources" },
            ...SOURCE_TYPES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Extraction"
          options={[
            { value: ALL, label: "All extraction" },
            ...EXTRACTION_STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>

      {/* Table */}
      {loading && !docs ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading documents…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {docs && docs.length > 0
                ? "No documents match the current filters."
                : "No documents yet. Upload one above to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden ring-1 ring-border/40">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Visibility</th>
                  <th className="px-4 py-3 font-medium">Extraction</th>
                  <th className="px-4 py-3 font-medium">Tags</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    busy={busyId === doc.id}
                    onToggleVisibility={() => toggleVisibility(doc)}
                    onSaveType={(docType) => void patchSettings(doc, { docType: docType || null })}
                    onSaveTags={(tags) => void patchSettings(doc, { tags })}
                    onReextract={() => void reextract(doc)}
                    onManageAssociations={() => setAssocDoc(doc)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {assocDoc ? (
        <AssociationsDialog
          open={Boolean(assocDoc)}
          onOpenChange={(next) => {
            if (!next) setAssocDoc(null);
          }}
          documentId={assocDoc.id}
          documentTitle={assocDoc.title}
          initialAssociations={[]}
        />
      ) : null}
    </div>
  );
}

function DocRow({
  doc,
  busy,
  onToggleVisibility,
  onSaveType,
  onSaveTags,
  onReextract,
  onManageAssociations,
}: {
  doc: AdminDocument;
  busy: boolean;
  onToggleVisibility: () => void;
  onSaveType: (docType: string) => void;
  onSaveTags: (tags: string[]) => void;
  onReextract: () => void;
  onManageAssociations: () => void;
}) {
  const [docTypeDraft, setDocTypeDraft] = useState(doc.docType ?? "");
  const [tagsDraft, setTagsDraft] = useState(doc.tags.join(", "));
  const [editingTags, setEditingTags] = useState(false);

  useEffect(() => {
    setDocTypeDraft(doc.docType ?? "");
  }, [doc.docType]);
  useEffect(() => {
    setTagsDraft(doc.tags.join(", "));
  }, [doc.tags]);

  const commitType = () => {
    const next = docTypeDraft.trim().toUpperCase();
    if (next !== (doc.docType ?? "")) onSaveType(next);
  };
  const commitTags = () => {
    setEditingTags(false);
    const next = tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (next.join("|") !== doc.tags.join("|")) onSaveTags(next);
  };

  const viewHref = doc.visibility === "public" ? `/docs/${doc.id}` : doc.r2Url;

  return (
    <tr className="bg-card/40 align-top transition-colors hover:bg-card/70">
      <td className="max-w-xs px-4 py-3">
        <div className="flex items-start gap-2">
          <SourceTypeIcon
            sourceType={doc.sourceType}
            className="mt-0.5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{doc.title}</p>
            {doc.description ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">{doc.description}</p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Input
          value={docTypeDraft}
          onChange={(event) => setDocTypeDraft(event.target.value)}
          onBlur={commitType}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          disabled={busy}
          className="h-8 w-28 uppercase"
        />
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onToggleVisibility}
          disabled={busy}
          className="outline-none disabled:opacity-50"
          title="Toggle visibility"
        >
          <VisibilityBadge visibility={doc.visibility} />
        </button>
      </td>
      <td className="px-4 py-3">
        <ExtractionBadge status={doc.extractionStatus} />
      </td>
      <td className="max-w-[16rem] px-4 py-3">
        {editingTags ? (
          <Input
            autoFocus
            value={tagsDraft}
            onChange={(event) => setTagsDraft(event.target.value)}
            onBlur={commitTags}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTags();
              }
            }}
            placeholder="comma, separated"
            disabled={busy}
            className="h-8"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTags(true)}
            className="flex flex-wrap gap-1 text-left"
            title="Edit tags"
          >
            {doc.tags.length > 0 ? (
              doc.tags.slice(0, 4).map((tag) => <TagChip key={tag} tag={tag} />)
            ) : (
              <span className="text-xs text-muted-foreground">Add tags</span>
            )}
            {doc.tags.length > 4 ? (
              <span className="text-[11px] text-muted-foreground">+{doc.tags.length - 4}</span>
            ) : null}
          </button>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
        {formatDocDate(doc.datetimeCreated)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <IconAction
            label="Toggle visibility"
            onClick={onToggleVisibility}
            disabled={busy}
            icon={
              doc.visibility === "public" ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )
            }
          />
          <IconAction
            label="Re-extract"
            onClick={onReextract}
            disabled={busy}
            icon={
              busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )
            }
          />
          <IconAction
            label="Manage associations"
            onClick={onManageAssociations}
            disabled={busy}
            icon={<Link2 className="size-4" />}
          />
          {viewHref ? (
            <a
              href={viewHref}
              target={doc.visibility === "public" ? undefined : "_blank"}
              rel={doc.visibility === "public" ? undefined : "noreferrer"}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title="View document"
            >
              <ExternalLink className="size-4" />
            </a>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  options,
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange((next as string | null) ?? ALL)}>
      <SelectTrigger className="min-w-[10rem] capitalize">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="capitalize">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
