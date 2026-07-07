import { AlertTriangle, ExternalLink, Layers, Loader2, Plus, Save, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  type AdminDocument,
  apiGet,
  apiSend,
  computeViewWarnings,
  type DocumentFilters,
  type DocumentView,
  ENTITY_TYPES,
  type EntityType,
  SOURCE_TYPES,
  type SourceType,
  toSlug,
  type ViewKind,
  ViewKindBadge,
  type Visibility,
  VisibilityBadge,
} from "./shared";

interface ViewsResponse {
  success: boolean;
  count: number;
  views: DocumentView[];
}
interface AdminDocsResponse {
  success: boolean;
  count: number;
  documents: AdminDocument[];
}
interface MutationResponse {
  success: boolean;
  view: DocumentView;
  warnings: string[];
}

const ANY = "__any__";

interface FormState {
  id: number | null;
  slug: string;
  slugTouched: boolean;
  name: string;
  description: string;
  kind: ViewKind;
  visibility: Visibility;
  sortOrder: number;
  docIds: string[];
  filters: DocumentFilters;
}

const EMPTY_FORM: FormState = {
  id: null,
  slug: "",
  slugTouched: false,
  name: "",
  description: "",
  kind: "static",
  visibility: "private",
  sortOrder: 0,
  docIds: [],
  filters: {},
};

function viewToForm(view: DocumentView, docs: AdminDocument[]): FormState {
  let filters: DocumentFilters = {};
  if (view.filtersJson) {
    try {
      filters = JSON.parse(view.filtersJson) as DocumentFilters;
    } catch {
      filters = {};
    }
  }
  let docIds: string[] = [];
  if (view.docIdsJson) {
    try {
      const parsed = JSON.parse(view.docIdsJson) as unknown;
      if (Array.isArray(parsed)) docIds = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      docIds = [];
    }
  } else if (view.documents) {
    docIds = view.documents.map((d) => d.id);
  }
  void docs;
  return {
    id: view.id,
    slug: view.slug,
    slugTouched: true,
    name: view.name,
    description: view.description ?? "",
    kind: view.kind,
    visibility: view.visibility,
    sortOrder: view.sortOrder,
    docIds,
    filters,
  };
}

export function DocViewBuilderApp() {
  const [views, setViews] = useState<DocumentView[] | null>(null);
  const [docs, setDocs] = useState<AdminDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const [viewsPayload, docsPayload] = await Promise.all([
        apiGet<ViewsResponse>("/api/document-views"),
        apiGet<AdminDocsResponse>("/api/supporting-documents"),
      ]);
      setViews(viewsPayload.views ?? []);
      setDocs(docsPayload.documents ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load views");
      setViews((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const docsById = useMemo(() => {
    const map = new Map<string, { title: string; visibility: Visibility }>();
    for (const doc of docs) map.set(doc.id, { title: doc.title, visibility: doc.visibility });
    return map;
  }, [docs]);

  const docOptions = useMemo(
    () =>
      docs.map((doc) => ({
        value: doc.id,
        label: doc.title,
        description: `${doc.sourceType}${doc.visibility === "private" ? " · private" : ""}`,
      })),
    [docs],
  );

  // Live client-side amber warnings — computed as the form changes.
  const liveWarnings = useMemo(
    () =>
      computeViewWarnings({
        visibility: form.visibility,
        kind: form.kind,
        filters: form.filters,
        docIds: form.docIds,
        docsById,
      }),
    [form.visibility, form.kind, form.filters, form.docIds, docsById],
  );

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setServerWarnings([]);
  }, []);

  const editView = useCallback(
    (view: DocumentView) => {
      setForm(viewToForm(view, docs));
      setServerWarnings([]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [docs],
  );

  const setName = useCallback((name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      slug: prev.slugTouched ? prev.slug : toSlug(name),
    }));
  }, []);

  const setFilter = useCallback(<K extends keyof DocumentFilters>(key: K, value: DocumentFilters[K]) => {
    setForm((prev) => {
      const filters = { ...prev.filters };
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
        delete filters[key];
      } else {
        filters[key] = value;
      }
      return { ...prev, filters };
    });
  }, []);

  const save = useCallback(async () => {
    const slug = form.slug.trim();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      toast.error("Slug must be lowercase alphanumeric with hyphens");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        slug,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        kind: form.kind,
        visibility: form.visibility,
        sortOrder: form.sortOrder,
        ...(form.kind === "static"
          ? { docIds: form.docIds }
          : { filters: form.filters }),
      };
      const response = form.id
        ? await apiSend<MutationResponse>(`/api/document-views/${form.id}`, "PATCH", payload)
        : await apiSend<MutationResponse>("/api/document-views", "POST", payload);
      setServerWarnings(response.warnings ?? []);
      toast.success(form.id ? "View updated" : "View created");
      await load(false);
      if (!form.id && response.view) {
        setForm((prev) => ({ ...prev, id: response.view.id, slugTouched: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const remove = useCallback(
    async (view: DocumentView) => {
      setSaving(true);
      try {
        await apiSend(`/api/document-views/${view.id}`, "DELETE");
        toast.success("View deleted");
        if (form.id === view.id) resetForm();
        await load(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete view");
      } finally {
        setSaving(false);
      }
    },
    [form.id, load, resetForm],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Layers className="size-6 text-muted-foreground" />
            Document Views
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curate document shelves — static hand-picked sets or dynamic filtered queries.
          </p>
        </div>
        {form.id ? (
          <Button variant="secondary" size="sm" onClick={resetForm}>
            <Plus className="mr-2 size-4" />
            New view
          </Button>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Builder form */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">{form.id ? "Edit view" : "Create view"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="view-name">
                <Input
                  id="view-name"
                  value={form.name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Permit packet"
                  disabled={saving}
                />
              </Field>
              <Field label="Slug" htmlFor="view-slug">
                <Input
                  id="view-slug"
                  value={form.slug}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      slug: toSlug(event.target.value),
                      slugTouched: true,
                    }))
                  }
                  placeholder="permit-packet"
                  disabled={saving}
                  className="font-mono"
                />
              </Field>
            </div>

            <Field label="Description" htmlFor="view-description">
              <Textarea
                id="view-description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="What this shelf collects…"
                rows={2}
                disabled={saving}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Kind">
                <Select
                  value={form.kind}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, kind: value as ViewKind }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kind" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Static (hand-picked)</SelectItem>
                    <SelectItem value="dynamic">Dynamic (filtered)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Visibility">
                <Select
                  value={form.visibility}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, visibility: value as Visibility }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort order" htmlFor="view-sort">
                <Input
                  id="view-sort"
                  type="number"
                  value={String(form.sortOrder)}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      sortOrder: Number(event.target.value) || 0,
                    }))
                  }
                  disabled={saving}
                />
              </Field>
            </div>

            {form.kind === "static" ? (
              <Field label="Documents">
                <MultipleSelector
                  options={docOptions}
                  value={form.docIds}
                  onValueChange={(next) => setForm((prev) => ({ ...prev, docIds: next }))}
                  placeholder="Pick documents"
                  title="Add documents"
                  searchPlaceholder="Search documents…"
                  emptyMessage="No documents found"
                  disabled={saving}
                />
              </Field>
            ) : (
              <DynamicFilterBuilder
                filters={form.filters}
                docs={docs}
                onChange={setFilter}
                disabled={saving}
              />
            )}

            {/* Amber warnings — live client-side + server-returned */}
            <WarningPanel warnings={mergeWarnings(liveWarnings, serverWarnings)} />

            <div className="flex items-center justify-end gap-2 pt-1">
              {form.id ? (
                <Button variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Save className="mr-2 size-4" />
                    {form.id ? "Save changes" : "Create view"}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing views list */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Existing views
          </p>
          {loading && !views ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : !views || views.length === 0 ? (
            <Card className="ring-1 ring-border/40">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No views yet.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {views
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((view) => (
                  <li key={view.id}>
                    <Card
                      className={cn(
                        "ring-1 transition-colors",
                        form.id === view.id ? "ring-primary/50" : "ring-border/40",
                      )}
                    >
                      <CardContent className="space-y-2 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => editView(view)}
                            className="min-w-0 text-left outline-none"
                          >
                            <p className="truncate text-sm font-medium">{view.name}</p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              /docs/view/{view.slug}
                            </p>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <a
                              href={`/docs/view/${view.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                              title="Preview shelf"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => void remove(view)}
                              disabled={saving}
                              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                              title="Delete view"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ViewKindBadge kind={view.kind} />
                          <VisibilityBadge visibility={view.visibility} />
                          <span className="text-[11px] text-muted-foreground">
                            {view.documents?.length ?? 0} docs
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DynamicFilterBuilder({
  filters,
  docs,
  onChange,
  disabled,
}: {
  filters: DocumentFilters;
  docs: AdminDocument[];
  onChange: <K extends keyof DocumentFilters>(key: K, value: DocumentFilters[K]) => void;
  disabled?: boolean;
}) {
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const doc of docs) for (const tag of doc.tags) set.add(tag);
    return Array.from(set).sort();
  }, [docs]);

  const availableDocTypes = useMemo(() => {
    const set = new Set<string>();
    for (const doc of docs) if (doc.docType) set.add(doc.docType);
    return Array.from(set).sort();
  }, [docs]);

  return (
    <div className="space-y-4 rounded-lg bg-muted/20 p-4 ring-1 ring-border/30">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Dynamic filters
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source type">
          <Select
            value={filters.sourceType ?? ANY}
            onValueChange={(value) =>
              onChange("sourceType", value === ANY ? undefined : (value as SourceType))
            }
          >
            <SelectTrigger className="capitalize">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {SOURCE_TYPES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Doc type">
          <Select
            value={filters.docType ?? ANY}
            onValueChange={(value) =>
              onChange("docType", !value || value === ANY ? undefined : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {availableDocTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Visibility">
          <Select
            value={filters.visibility ?? ANY}
            onValueChange={(value) =>
              onChange("visibility", value === ANY ? undefined : (value as Visibility))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Search text">
          <Input
            value={filters.search ?? ""}
            onChange={(event) => onChange("search", event.target.value || undefined)}
            placeholder="keyword"
            disabled={disabled}
          />
        </Field>

        <Field label="Entity type">
          <Select
            value={filters.entityType ?? ANY}
            onValueChange={(value) =>
              onChange("entityType", value === ANY ? undefined : (value as EntityType))
            }
          >
            <SelectTrigger className="capitalize">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              {ENTITY_TYPES.map((e) => (
                <SelectItem key={e} value={e} className="capitalize">
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Entity ID">
          <Input
            value={filters.entityId ?? ""}
            onChange={(event) => onChange("entityId", event.target.value || undefined)}
            placeholder="entity id"
            disabled={disabled || !filters.entityType}
          />
        </Field>
      </div>

      <Field label="Tags (match any)">
        <MultipleSelector
          options={availableTags.map((tag) => ({ value: tag, label: tag }))}
          value={filters.tags ?? []}
          onValueChange={(next) => onChange("tags", next.length > 0 ? next : undefined)}
          placeholder="Any tag"
          title="Filter by tags"
          searchPlaceholder="Search tags…"
          emptyMessage="No tags found"
          enableCreate
          createLabel="Use tag"
          onCreateOption={(label) => ({ value: label, label })}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function WarningPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg bg-amber-500/10 p-4 text-amber-400 ring-1 ring-amber-500/30">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4" />
        Exposure warning
      </p>
      <ul className="space-y-1 pl-6 text-sm">
        {warnings.map((warning) => (
          <li key={warning} className="list-disc">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function mergeWarnings(a: string[], b: string[]): string[] {
  const set = new Set<string>();
  for (const w of a) set.add(w);
  for (const w of b) set.add(w);
  return Array.from(set);
}
