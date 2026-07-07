import { FileText, Layers, Loader2, Search, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { DocCard } from "./DocCard";
import {
  apiGet,
  DocTypeBadge,
  type DocumentView,
  formatDocDate,
  type PublicDocument,
  type SearchResult,
  SourceTypeIcon,
  type SourceType,
  TagChip,
} from "./shared";

interface PublicDocsResponse {
  success: boolean;
  count: number;
  documents: PublicDocument[];
}
interface SearchResponse {
  success: boolean;
  query: string;
  count: number;
  results: SearchResult[];
}
interface ViewsResponse {
  success: boolean;
  count: number;
  views: DocumentView[];
}

const SEARCH_DEBOUNCE_MS = 300;

interface UrlState {
  q: string;
  type: string;
  tag: string;
  view: string;
}

function readUrlState(): UrlState {
  if (typeof window === "undefined") return { q: "", type: "", tag: "", view: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") ?? "",
    type: params.get("type") ?? "",
    tag: params.get("tag") ?? "",
    view: params.get("view") ?? "",
  };
}

function writeUrlState(state: UrlState) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.type) params.set("type", state.type);
  if (state.tag) params.set("tag", state.tag);
  if (state.view) params.set("view", state.view);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", next);
}

export function PublicDocsApp() {
  const initial = useRef<UrlState>(readUrlState());

  const [docs, setDocs] = useState<PublicDocument[] | null>(null);
  const [views, setViews] = useState<DocumentView[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(initial.current.q);
  const [debouncedQuery, setDebouncedQuery] = useState(initial.current.q);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [typeFilter, setTypeFilter] = useState(initial.current.type);
  const [tagFilter, setTagFilter] = useState(initial.current.tag);
  const [viewFilter, setViewFilter] = useState(initial.current.view);

  // --- Initial load: public docs + public views ---
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [docsPayload, viewsPayload] = await Promise.all([
          apiGet<PublicDocsResponse>("/api/supporting-documents/public"),
          apiGet<ViewsResponse>("/api/document-views"),
        ]);
        if (!mounted) return;
        setDocs(docsPayload.documents ?? []);
        setViews(viewsPayload.views ?? []);
      } catch (error) {
        if (!mounted) return;
        toast.error(error instanceof Error ? error.message : "Failed to load documents");
        setDocs([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  // --- Persist filter/search state to the URL ---
  useEffect(() => {
    writeUrlState({ q: query, type: typeFilter, tag: tagFilter, view: viewFilter });
  }, [query, typeFilter, tagFilter, viewFilter]);

  // --- Debounce the search query ---
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // --- Run search when the debounced query is non-empty ---
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let mounted = true;
    setSearching(true);
    const run = async () => {
      try {
        const payload = await apiGet<SearchResponse>(
          `/api/supporting-documents/search?q=${encodeURIComponent(debouncedQuery)}`,
        );
        if (!mounted) return;
        setSearchResults(payload.results ?? []);
      } catch (error) {
        if (!mounted) return;
        toast.error(error instanceof Error ? error.message : "Search failed");
        setSearchResults([]);
      } finally {
        if (mounted) setSearching(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [debouncedQuery]);

  const activeView = useMemo(
    () => (viewFilter ? views.find((v) => v.slug === viewFilter) ?? null : null),
    [viewFilter, views],
  );

  // Docs scoped to the selected view shelf (if any), else the full public list.
  const scopedDocs = useMemo<PublicDocument[]>(() => {
    if (!docs) return [];
    if (!activeView || !activeView.documents) return docs;
    const viewIds = new Set(activeView.documents.map((d) => d.id));
    return docs.filter((doc) => viewIds.has(doc.id));
  }, [docs, activeView]);

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const doc of scopedDocs) set.add(doc.sourceType);
    return Array.from(set).sort();
  }, [scopedDocs]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const doc of scopedDocs) for (const tag of doc.tags) set.add(tag);
    return Array.from(set).sort();
  }, [scopedDocs]);

  const filteredDocs = useMemo(() => {
    return scopedDocs.filter((doc) => {
      if (typeFilter && doc.sourceType !== typeFilter) return false;
      if (tagFilter && !doc.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [scopedDocs, typeFilter, tagFilter]);

  const clearFilters = useCallback(() => {
    setTypeFilter("");
    setTagFilter("");
    setViewFilter("");
  }, []);

  const hasFilters = Boolean(typeFilter || tagFilter || viewFilter);
  const isSearchMode = debouncedQuery.length > 0;

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <FileText className="size-6 text-muted-foreground" />
            Documents
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public project documents — permits, specs, and reference material for the 126 Colby
            remodel.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents…"
            className="pl-9"
            aria-label="Search documents"
          />
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      {/* View shelves */}
      {views.length > 0 && !isSearchMode ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Layers className="size-3.5" />
            Shelves
          </span>
          <FilterChip
            active={!viewFilter}
            onClick={() => setViewFilter("")}
            label="All documents"
          />
          {views.map((view) => (
            <FilterChip
              key={view.slug}
              active={viewFilter === view.slug}
              onClick={() => setViewFilter(view.slug)}
              label={view.name}
              count={view.documents?.length}
            />
          ))}
        </div>
      ) : null}

      {/* Type + tag filter chips (list mode only) */}
      {!isSearchMode && (availableTypes.length > 0 || availableTags.length > 0) ? (
        <div className="space-y-2">
          {availableTypes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Type
              </span>
              {availableTypes.map((type) => (
                <FilterChip
                  key={type}
                  active={typeFilter === type}
                  onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                  label={type}
                  icon={<SourceTypeIcon sourceType={type as SourceType} className="size-3" />}
                />
              ))}
            </div>
          ) : null}
          {availableTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tags
              </span>
              {availableTags.slice(0, 24).map((tag) => (
                <FilterChip
                  key={tag}
                  active={tagFilter === tag}
                  onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
                  label={tag}
                />
              ))}
            </div>
          ) : null}
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading documents…
        </div>
      ) : isSearchMode ? (
        <SearchResultsGrid results={searchResults} query={debouncedQuery} searching={searching} />
      ) : filteredDocs.length === 0 ? (
        <EmptyCard
          message={
            hasFilters
              ? "No documents match the current filters."
              : "No public documents yet. Published documents will appear here."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredDocs.map((doc) => (
            <DocCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResultsGrid({
  results,
  query,
  searching,
}: {
  results: SearchResult[] | null;
  query: string;
  searching: boolean;
}) {
  if (searching && results === null) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Searching…
      </div>
    );
  }
  if (!results || results.length === 0) {
    return <EmptyCard message={`No documents found for “${query}”.`} />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {results.map((result) => (
        <a
          key={result.id}
          href={`/docs/${result.id}`}
          className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Card className="h-full ring-1 ring-border/40 transition-colors group-hover:ring-border/80">
            <CardContent className="space-y-3 py-5">
              <div className="flex items-start gap-2">
                <SourceTypeIcon
                  sourceType={result.sourceType}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <p className="min-w-0 text-base font-semibold leading-snug">{result.title}</p>
              </div>
              {result.snippet ? (
                <p className="line-clamp-3 text-sm text-muted-foreground">{result.snippet}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <DocTypeBadge docType={result.docType} />
                {result.tags.slice(0, 3).map((tag) => (
                  <TagChip key={tag} tag={tag} />
                ))}
              </div>
            </CardContent>
          </Card>
        </a>
      ))}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <Card className="ring-1 ring-border/40">
      <CardContent className="py-16 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 transition-colors",
        active
          ? "bg-primary/15 text-primary ring-primary/40"
          : "bg-muted/30 text-muted-foreground ring-border/30 hover:text-foreground hover:ring-border/60",
      )}
    >
      {icon}
      {label}
      {typeof count === "number" ? (
        <span className="tabular-nums text-foreground/80">{count}</span>
      ) : null}
    </button>
  );
}

export { formatDocDate };
