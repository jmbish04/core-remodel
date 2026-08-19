import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface CampaignRow {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed" | "paused";
  totalAngles: number;
  completedAngles: number;
  failedAngles: number;
  datetimeCreated: number | null;
}

function statusBadgeVariant(
  status: CampaignRow["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "done":
      return "secondary";
    case "failed":
      return "destructive";
    case "paused":
      return "outline";
    default:
      return "outline";
  }
}

export function CampaignListApp() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch("/api/render/campaigns?limit=100");
      if (!res.ok) throw new Error(`Failed to load campaigns (${res.status})`);
      const data = (await res.json()) as { campaigns: CampaignRow[] };
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading campaigns…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      {campaigns.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">No campaigns yet.</p>
          <p className="text-sm text-muted-foreground">Create one via the API or MCP tools.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const progress =
                  c.totalAngles > 0
                    ? Math.round(((c.completedAngles + c.failedAngles) / c.totalAngles) * 100)
                    : 0;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(c.status)}>{c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              c.status === "failed" ? "bg-destructive" : "bg-primary",
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {c.completedAngles}/{c.totalAngles}
                          {c.failedAngles > 0 && ` (${c.failedAngles} failed)`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.datetimeCreated
                        ? new Date(c.datetimeCreated * 1000).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`/admin/render/campaigns/${c.id}`}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                      >
                        View
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
