"use client";

import { Card, CardContent, CardHeader, CardTitle } from "src/frontend/components/ui/card";
import { type BreakdownRow } from "../data";

interface BreakdownCardProps {
  title: string;
  rows: BreakdownRow[];
}

export function BreakdownCard({ title, rows }: BreakdownCardProps) {
  const maxRowValue =
    rows.length > 0 ? Math.max(...rows.map((row) => row.value)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-[11px] tracking-wider uppercase">
          <span>{title}</span>
          <span>Visitors</span>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground/90 truncate">{row.label}</span>
                <span className="text-foreground font-medium">{row.value}</span>
              </div>
              <div className="bg-muted h-1 rounded-full">
                <div
                  className="h-full rounded-full bg-blue-500/85"
                  style={{ width: `${(row.value / maxRowValue) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
