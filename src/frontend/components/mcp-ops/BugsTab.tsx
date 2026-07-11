/**
 * @fileoverview 0017 — MCP Ops "Bugs" tab (issues board).
 *
 * Sortable issue table over `/api/mcp-ops/issues?status=`, rebuilt toward a
 * lightweight issues board:
 *   - Server-side status Select (open / in_progress / fixed / wontfix / all).
 *   - Client-side free-text search over summary / details / tool.
 *   - A severity facet: a Popover of Checkboxes to multi-select severities.
 *   - Sortable Severity / Status / Created headers.
 *   - Row click opens a Dialog with the full issue (summary, details, repro
 *     steps, tool, severity + status badges, created / updated, PR link).
 *
 * The Dialog is Base-UI-backed: controlled via open / onOpenChange only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, ExternalLink, Filter, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  apiGet,
  EmptyState,
  ErrorState,
  fmtDate,
  type IssueRow,
  type IssueStatus,
  PanelLoading,
  REPO_PR_BASE,
  severityVariant,
  SortButton,
  statusVariant,
  toEpoch,
} from "./shared";

type IssueSortKey = "createdAt" | "updatedAt" | "severity" | "status";

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"] as const;

export function BugsTab() {
  const [status, setStatus] = useState<IssueStatus>("open");
  const [rows, setRows] = useState<IssueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<IssueSortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<IssueRow | null>(null);

  const load = useCallback(async (s: IssueStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ issues: IssueRow[] }>(
        `/api/mcp-ops/issues?status=${encodeURIComponent(s)}`,
      );
      setRows(data.issues ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [load, status]);

  const toggleSort = (key: IssueSortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const toggleSeverity = (sev: string) => {
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  const processed = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((i) => {
      if (severities.size > 0 && !severities.has((i.severity ?? "").toLowerCase()))
        return false;
      if (!q) return true;
      const hay =
        `${i.summary ?? ""} ${i.details ?? ""} ${i.toolName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });

    const sevRank: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "severity") {
        cmp =
          (sevRank[(a.severity ?? "").toLowerCase()] ?? 0) -
          (sevRank[(b.severity ?? "").toLowerCase()] ?? 0);
      } else if (sortKey === "status") {
        cmp = (a.status ?? "").localeCompare(b.status ?? "");
      } else {
        cmp = toEpoch(a[sortKey]) - toEpoch(b[sortKey]);
      }
      return sortAsc ? cmp : -cmp;
    });
    return filtered;
  }, [rows, query, severities, sortKey, sortAsc]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select
            value={status}
            onValueChange={(v) => setStatus((v ?? "open") as IssueStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
              <SelectItem value="wontfix">Won't fix</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search summary, details, tool…"
          className="h-9 w-full max-w-xs"
        />

        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            <Filter className="mr-2 h-4 w-4" />
            Severity
            {severities.size > 0 ? (
              <Badge variant="secondary" className="ml-2 px-1.5 py-0">
                {severities.size}
              </Badge>
            ) : null}
          </PopoverTrigger>
          <PopoverContent className="w-52">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filter severity
              </p>
              {SEVERITY_OPTIONS.map((sev) => (
                <Label
                  key={sev}
                  className="flex cursor-pointer items-center gap-2 text-sm font-normal capitalize"
                >
                  <Checkbox
                    checked={severities.has(sev)}
                    onCheckedChange={() => toggleSeverity(sev)}
                  />
                  {sev}
                </Label>
              ))}
              {severities.size > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 w-full justify-start px-2 text-xs"
                  onClick={() => setSeverities(new Set())}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

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
          icon={Bug}
          title={rows && rows.length > 0 ? "No matching bugs" : "No bug reports"}
          hint={
            rows && rows.length > 0
              ? "No issues match the current filters. Adjust search or severity."
              : "Bug reports filed via MCP tools will appear here."
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
                      label="Severity"
                      active={sortKey === "severity"}
                      onClick={() => toggleSort("severity")}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Summary
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                    Tool
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
                    Fix
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {processed.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setSelected(i)}
                    className="cursor-pointer align-top transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <Badge variant={severityVariant(i.severity)}>
                        {i.severity ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {i.summary ?? "—"}
                      </p>
                      {i.details ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {i.details}
                        </p>
                      ) : null}
                      {i.reproSteps ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                          Repro: {i.reproSteps}
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">
                        {i.toolName ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(i.status)}>
                        {i.status ?? "—"}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                      {fmtDate(i.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {i.fixedByPr != null && i.fixedByPr !== "" ? (
                        <a
                          href={`${REPO_PR_BASE}${i.fixedByPr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:underline"
                        >
                          PR #{i.fixedByPr}
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

      <IssueDetailDialog issue={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function IssueDetailDialog({
  issue,
  onClose,
}: {
  issue: IssueRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={issue != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {issue ? (
          <>
            <DialogHeader>
              <DialogTitle>{issue.summary ?? "Bug report"}</DialogTitle>
              <DialogDescription>
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(issue.severity)}>
                    {issue.severity ?? "—"}
                  </Badge>
                  <Badge variant={statusVariant(issue.status)}>
                    {issue.status ?? "—"}
                  </Badge>
                  {issue.toolName ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {issue.toolName}
                    </span>
                  ) : null}
                </span>
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-2 text-sm">
                {issue.details ? (
                  <section>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Details
                    </p>
                    <p className="whitespace-pre-wrap text-foreground/90">
                      {issue.details}
                    </p>
                  </section>
                ) : null}

                {issue.reproSteps ? (
                  <section>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Repro steps
                    </p>
                    <p className="whitespace-pre-wrap text-foreground/90">
                      {issue.reproSteps}
                    </p>
                  </section>
                ) : null}

                <section>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Timeline
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {fmtDate(issue.createdAt)} · Updated{" "}
                    {fmtDate(issue.updatedAt)}
                  </p>
                </section>

                {issue.fixedByPr != null && issue.fixedByPr !== "" ? (
                  <a
                    href={`${REPO_PR_BASE}${issue.fixedByPr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-sky-400 hover:underline"
                  >
                    Fixed by PR #{issue.fixedByPr}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            </ScrollArea>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
