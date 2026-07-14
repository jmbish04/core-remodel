/**
 * @fileoverview 0017 — MCP Ops "Features" tab.
 *
 * A sortable / searchable feature-request table over
 * `/api/mcp-ops/features?status=`. Unlike Bugs, a row click does NOT open a
 * dialog — it opens a FULL-PAGE reading view (`FeatureDetail`) that replaces the
 * whole tab area, exposed to the root via `onOpenFeature` so the root can also
 * push a `…/features/:id` URL. `selectedId` is lifted to the root so deep-links
 * open the article on load.
 *
 * The detail view is read-only: there is no comment backend, so no composer is
 * rendered (a disabled placeholder would be dishonest UI).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Lightbulb, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";
import {
  apiGet,
  EmptyState,
  ErrorState,
  type FeatureRow,
  type FeatureStatus,
  fmtDate,
  PanelLoading,
  REPO_PR_BASE,
  SortButton,
  statusVariant,
  toEpoch,
} from "./shared";

type FeatureSortKey = "createdAt" | "updatedAt" | "status" | "title";

/** Heuristic: treat a body as markdown if it carries obvious md syntax. */
function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/.test(
    text,
  );
}

export function FeaturesTab({
  selectedId,
  onOpenFeature,
  onCloseFeature,
}: {
  /** Currently-open feature id (lifted to root for URL sync). */
  selectedId?: string | null;
  /** Open a feature's full-page view + push its URL. */
  onOpenFeature: (id: string) => void;
  /** Return to the table + push the list URL. */
  onCloseFeature: () => void;
}) {
  const [status, setStatus] = useState<FeatureStatus>("requested");
  const [rows, setRows] = useState<FeatureRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<FeatureSortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState("");

  // A deep-linked feature may not be in the current status slice. If we have a
  // selection but no matching row, widen the fetch to "all" so the detail view
  // can resolve it.
  const load = useCallback(
    async (s: FeatureStatus) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<{ features: FeatureRow[] }>(
          `/api/mcp-ops/features?status=${encodeURIComponent(s)}`,
        );
        setRows(data.features ?? []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(status);
  }, [load, status]);

  // If a deep-link points at a feature not present in the current slice, widen
  // to "all" once so the article can render.
  useEffect(() => {
    if (
      selectedId &&
      rows &&
      status !== "all" &&
      !rows.some((f) => String(f.id) === String(selectedId))
    ) {
      setStatus("all");
    }
  }, [selectedId, rows, status]);

  const toggleSort = (key: FeatureSortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const processed = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((f) => {
      if (!q) return true;
      const hay =
        `${f.title ?? ""} ${f.description ?? ""} ${f.useCase ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "status") cmp = (a.status ?? "").localeCompare(b.status ?? "");
      else if (sortKey === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
      else cmp = toEpoch(a[sortKey]) - toEpoch(b[sortKey]);
      return sortAsc ? cmp : -cmp;
    });
    return filtered;
  }, [rows, query, sortKey, sortAsc]);

  const selectedFeature = useMemo(() => {
    if (!selectedId || !rows) return null;
    return rows.find((f) => String(f.id) === String(selectedId)) ?? null;
  }, [selectedId, rows]);

  /* ---- Full-page detail view replaces the whole tab area ---- */
  if (selectedId) {
    if (loading) return <PanelLoading />;
    if (error) return <ErrorState message={error} />;
    if (!selectedFeature) {
      return (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={onCloseFeature}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Features
          </Button>
          <EmptyState
            icon={Lightbulb}
            title="Feature not found"
            hint="This feature request could not be located. It may have been removed."
          />
        </div>
      );
    }
    return <FeatureDetail feature={selectedFeature} onBack={onCloseFeature} />;
  }

  /* ---- Table view ---- */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select
            value={status}
            onValueChange={(v) => setStatus((v ?? "requested") as FeatureStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="building">Building</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, description, use case…"
          className="h-9 w-full max-w-xs"
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => load(status)}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <PanelLoading />
      ) : error ? (
        <ErrorState message={error} />
      ) : processed.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={
            rows && rows.length > 0 ? "No matching features" : "No feature requests"
          }
          hint={
            rows && rows.length > 0
              ? "No feature requests match the current filters."
              : "Feature requests filed via MCP tools will appear here."
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Title"
                      active={sortKey === "title"}
                      onClick={() => toggleSort("title")}
                    />
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">
                    Use case
                  </th>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Status"
                      active={sortKey === "status"}
                      onClick={() => toggleSort("status")}
                    />
                  </th>
                  <th className="hidden px-4 py-2.5 text-left md:table-cell">
                    <SortButton
                      label="Created"
                      active={sortKey === "createdAt"}
                      onClick={() => toggleSort("createdAt")}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    PR
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {processed.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => onOpenFeature(String(f.id))}
                    className="cursor-pointer align-top transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {f.title ?? "—"}
                      </p>
                      {f.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {f.description}
                        </p>
                      ) : null}
                      {f.planRef ? (
                        <p className="mt-0.5 text-xs text-muted-foreground/80">
                          Plan: {f.planRef}
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                      <span className="line-clamp-3">{f.useCase ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(f.status)}>
                        {f.status ?? "—"}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                      {fmtDate(f.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {f.prNumber != null && f.prNumber !== "" ? (
                        <a
                          href={`${REPO_PR_BASE}${f.prNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:underline"
                        >
                          PR #{f.prNumber}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Full-page (article/reading) view of a single feature request. Renders inline
 * inside the tab area — a back button, the title as a large heading, status +
 * timeline meta, the description as prose (markdown when it looks like it), a
 * "Use case" section, and plan ref / PR link. Read-only.
 */
function FeatureDetail({
  feature,
  onBack,
}: {
  feature: FeatureRow;
  onBack: () => void;
}) {
  const description = (feature.description ?? "").trim();
  const useCase = (feature.useCase ?? "").trim();

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Features
      </Button>

      <header className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {feature.title ?? "Untitled feature"}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Badge variant={statusVariant(feature.status)}>
            {feature.status ?? "—"}
          </Badge>
          <span>Created {fmtDate(feature.createdAt)}</span>
          <span>Updated {fmtDate(feature.updatedAt)}</span>
          {feature.planRef ? (
            <span className="font-mono">Plan: {feature.planRef}</span>
          ) : null}
          {feature.prNumber != null && feature.prNumber !== "" ? (
            <a
              href={`${REPO_PR_BASE}${feature.prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-sky-400 hover:underline"
            >
              PR #{feature.prNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </header>

      <Separator className="bg-border/40" />

      <section className="space-y-2">
        {description ? (
          looksLikeMarkdown(description) ? (
            <MarkdownProse>{description}</MarkdownProse>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {description}
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            No description provided.
          </p>
        )}
      </section>

      {useCase ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Use case
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {useCase}
          </p>
        </section>
      ) : null}
    </article>
  );
}
