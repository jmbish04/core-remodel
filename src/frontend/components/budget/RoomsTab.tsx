/**
 * @fileoverview Budget Command Center — "Rooms" tab.
 *
 * Renders the "Room finances" table from
 * `docs/plans/budget-command-center/screens/2-decision-inbox.html`: one row
 * per room (committed / spent / remaining / open materials / risk) plus a
 * pinned Total row. Data comes from `GET /api/budget/rooms-finance`
 * (`getRoomsFinance` in `@/lib/budget-api`) — the server already grouped and
 * totaled it, so this component only sorts client-side (bounded by room
 * count) and never re-aggregates.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCents,
  getRoomsFinance,
  useBudgetQuery,
  type RoomFinanceRow,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

/** Where a room row goes — matches the RoomPicker workshop pattern (`?roomId=`), the only admin surface keyed by numeric room id. */
function roomHref(roomId: number): string {
  return `/admin/designs/workshop?roomId=${roomId}`;
}

const RISK_RANK: Record<RoomFinanceRow["risk"], number> = { at_risk: 2, watch: 1, ok: 0 };

function RiskBadge({ risk }: { risk: RoomFinanceRow["risk"] }) {
  switch (risk) {
    case "at_risk":
      return (
        <Badge variant="destructive" aria-label="Risk: at risk">
          <CircleAlert aria-hidden data-icon="inline-start" />
          at risk
        </Badge>
      );
    case "watch":
      return (
        <Badge variant="outline" className="text-amber-500" aria-label="Risk: watch">
          <TriangleAlert aria-hidden data-icon="inline-start" />
          watch
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-emerald-500" aria-label="Risk: ok">
          ok
        </Badge>
      );
  }
}

type SortKey =
  | "name"
  | "committedCents"
  | "spentCents"
  | "remainingCents"
  | "openMaterialsCount"
  | "risk";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right" }> = [
  { key: "name", label: "Room", align: "left" },
  { key: "committedCents", label: "Committed", align: "right" },
  { key: "spentCents", label: "Spent", align: "right" },
  { key: "remainingCents", label: "Remaining", align: "right" },
  { key: "openMaterialsCount", label: "Open materials", align: "right" },
  { key: "risk", label: "Risk", align: "left" },
];

function SortHeader({
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = column.key === sortKey;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead aria-sort={ariaSort} className={column.align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          column.align === "right" && "flex-row-reverse",
        )}
      >
        {column.label}
        <Icon aria-hidden className={cn("size-3", !active && "opacity-40")} />
        <span className="sr-only">{active ? `, sorted ${ariaSort}` : ", not sorted"}</span>
      </button>
    </TableHead>
  );
}

export function RoomsTab() {
  const { data, error, isLoading } = useBudgetQuery(getRoomsFinance, []);
  const [sortKey, setSortKey] = useState<SortKey>("committedCents");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const rooms = data?.rooms ?? [];
    const sorted = [...rooms].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "risk") cmp = RISK_RANK[a.risk] - RISK_RANK[b.risk];
      else cmp = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "risk" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading room finances…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <CircleAlert aria-hidden className="size-5 text-destructive" />
        <p className="text-sm font-medium text-destructive">Couldn't load room finances</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No rooms with budget activity yet.</p>
      </div>
    );
  }

  const ZERO_TOTALS = {
    committedCents: 0,
    spentCents: 0,
    remainingCents: 0,
    openMaterialsCount: 0,
  };
  const totals = data?.totals ?? ZERO_TOTALS;

  // The Total row is project-wide, so it does not always equal the column above
  // it: money attached to no room, and items mapped to several rooms, live in
  // this gap. Naming it is the difference between a reader trusting the table
  // and a reader finding two numbers that disagree.
  const unassigned = data?.unassigned ?? ZERO_TOTALS;
  const hasUnassigned =
    unassigned.committedCents !== 0 ||
    unassigned.spentCents !== 0 ||
    unassigned.openMaterialsCount !== 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => (
              <SortHeader
                key={column.key}
                column={column}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((room) => (
            <TableRow key={room.roomId}>
              <TableCell className="font-medium">
                <a
                  href={roomHref(room.roomId)}
                  className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {room.name}
                </a>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(room.committedCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(room.spentCents)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono tabular-nums",
                  room.remainingCents < 0 && "text-destructive",
                )}
              >
                {formatCents(room.remainingCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {room.openMaterialsCount}
              </TableCell>
              <TableCell>
                <RiskBadge risk={room.risk} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          {hasUnassigned && (
            <TableRow className="text-muted-foreground">
              <TableCell className="font-medium">
                Not assigned to a room
                <span className="ml-2 text-xs font-normal">
                  counted in the total, not in the rows above
                </span>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(unassigned.committedCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(unassigned.spentCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(unassigned.remainingCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {unassigned.openMaterialsCount}
              </TableCell>
              <TableCell aria-hidden />
            </TableRow>
          )}
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-mono font-semibold tabular-nums">
              {formatCents(totals.committedCents)}
            </TableCell>
            <TableCell className="text-right font-mono font-semibold tabular-nums">
              {formatCents(totals.spentCents)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-mono font-semibold tabular-nums",
                totals.remainingCents < 0 && "text-destructive",
              )}
            >
              {formatCents(totals.remainingCents)}
            </TableCell>
            <TableCell className="text-right font-mono font-semibold tabular-nums">
              {totals.openMaterialsCount}
            </TableCell>
            <TableCell aria-hidden />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default RoomsTab;
