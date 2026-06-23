/**
 * @fileoverview Presentational table for the /measurements admin surface
 * (0006 Phase 1).  Renders measurements grouped by room (one Card per room),
 * then sub-grouped by element type, with source / approximate badges and
 * edit / delete actions.  Rows are separated by hairline dividers
 * (`divide-border/40`) per the Monolith no-1px-border rule.
 *
 * Pure presentation: grouping is computed by the parent (MeasurementsApp) and
 * passed in as `groups`; all mutations bubble up via onEdit / onDelete.
 */

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnitSystem } from "@/lib/use-unit-system";
import { formatAreaFromSqFt, type UnitSystem } from "@/lib/units";

import {
  SOURCE_LABELS,
  elementTypeLabel,
  formatDimensions,
  sourceBadgeVariant,
  type Measurement,
} from "./measurement-types";

/** A room's measurements, pre-sorted by the parent for stable display order. */
export interface RoomGroup {
  key: string;
  title: string;
  subtitle: string;
  sortKey: string;
  items: Measurement[];
}

export function MeasurementTable({
  groups,
  onEdit,
  onDelete,
}: {
  groups: RoomGroup[];
  onEdit: (m: Measurement) => void;
  onDelete: (m: Measurement) => void;
}) {
  // Read the active unit once here and thread it down (one subscription, not one per row).
  const [unitSystem] = useUnitSystem();
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <RoomGroupCard
          key={group.key}
          group={group}
          system={unitSystem}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

/**
 * One room's measurements, sub-grouped by element type.  Within a group the rows
 * share a small element-type subheader; rows are separated by hairline dividers.
 */
function RoomGroupCard({
  group,
  system,
  onEdit,
  onDelete,
}: {
  group: RoomGroup;
  system: UnitSystem;
  onEdit: (m: Measurement) => void;
  onDelete: (m: Measurement) => void;
}) {
  // Sub-group by element type, element types ordered alphabetically by label.
  const byType = React.useMemo(() => {
    const map = new Map<string, Measurement[]>();
    for (const m of group.items) {
      const list = map.get(m.elementType) ?? [];
      list.push(m);
      map.set(m.elementType, list);
    }
    return Array.from(map.entries()).sort((a, b) =>
      elementTypeLabel(a[0]).localeCompare(elementTypeLabel(b[0])),
    );
  }, [group.items]);

  return (
    <Card className="ring-1 ring-border/40">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{group.title}</CardTitle>
            {group.subtitle ? <CardDescription>{group.subtitle}</CardDescription> : null}
          </div>
          <Badge variant="outline">{group.items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {byType.map(([elementType, items]) => (
          <div key={elementType}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {elementTypeLabel(elementType)}
            </p>
            <div className="divide-y divide-border/40">
              {items.map((m) => (
                <MeasurementRow
                  key={m.id}
                  measurement={m}
                  system={system}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A single measurement row: identity + dims on the left, badges + actions on the right. */
function MeasurementRow({
  measurement: m,
  system,
  onEdit,
  onDelete,
}: {
  measurement: Measurement;
  system: UnitSystem;
  onEdit: (m: Measurement) => void;
  onDelete: (m: Measurement) => void;
}) {
  const meta = [
    formatDimensions(m, system),
    formatAreaFromSqFt(m.areaSqFt, system),
    m.quantity > 1 ? `×${m.quantity}` : null,
    m.accuracyNote || null,
  ].filter((part): part is string => Boolean(part) && part !== "—");

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">
          {m.label || elementTypeLabel(m.elementType)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {meta.length > 0 ? meta.join(" · ") : "No dimensions recorded"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant={sourceBadgeVariant(m.source)}>{SOURCE_LABELS[m.source]}</Badge>
        {m.isApproximate ? <Badge variant="outline">approx</Badge> : null}
        <Button size="icon-sm" variant="ghost" onClick={() => onEdit(m)} aria-label="Edit measurement">
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onDelete(m)}
          aria-label="Delete measurement"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
