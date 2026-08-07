import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { resolveCfImageUrl } from "./types";

interface CampaignAngle {
  id: number;
  roomId: number | null;
  listingPhotoId: number | null;
  isHero: boolean;
  sortOrder: number;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  sessionId: string | null;
  canvasId: string | null;
  error: string | null;
  canvasDeliveryUrl?: string | null;
}

interface CampaignSession {
  id: number;
  sessionId: string;
  roomId: number | null;
  isHero: boolean;
}

interface Campaign {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed" | "paused";
  prompt: string | null;
  totalAngles: number;
  completedAngles: number;
  failedAngles: number;
}

interface CampaignDetail {
  campaign: Campaign;
  angles: CampaignAngle[];
  sessions: CampaignSession[];
}

function statusBadgeVariant(
  status: Campaign["status"] | CampaignAngle["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "done":
      return "secondary";
    case "failed":
    case "skipped":
      return "destructive";
    case "paused":
      return "outline";
    default:
      return "outline";
  }
}

export function CampaignDetailApp({ campaignId }: { campaignId?: string }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!campaignId) return;
    try {
      const res = await fetch(`/api/render/campaigns/${campaignId}`);
      if (!res.ok) throw new Error(`Failed to load campaign (${res.status})`);
      const data = (await res.json()) as CampaignDetail;
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchDetail();
    const interval = setInterval(fetchDetail, 3000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  const handleCancel = async () => {
    if (!campaignId) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/render/campaigns/${campaignId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed to cancel (${res.status})`);
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading campaign…</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!detail) return <p className="text-muted-foreground">Campaign not found.</p>;

  const { campaign, angles } = detail;
  const progress =
    campaign.totalAngles > 0
      ? Math.round(
          ((campaign.completedAngles + campaign.failedAngles) / campaign.totalAngles) * 100,
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <a
            href="/admin/render/campaigns"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            ← Back to campaigns
          </a>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-muted-foreground">{campaign.prompt}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusBadgeVariant(campaign.status)}>{campaign.status}</Badge>
          {(campaign.status === "pending" || campaign.status === "running") && (
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="text-muted-foreground">
            {campaign.completedAngles} done · {campaign.failedAngles} failed ·{" "}
            {campaign.totalAngles} total
          </span>
        </div>
        <Progress value={progress} />
      </div>

      {angles.length === 0 ? (
        <p className="text-muted-foreground">No angles enrolled.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {angles.map((angle) => (
            <Card
              key={angle.id}
              className={cn("overflow-hidden", angle.isHero && "ring-1 ring-primary")}
            >
              <CardContent className="p-0">
                <div className="aspect-video bg-muted">
                  {angle.canvasDeliveryUrl ? (
                    <img
                      src={resolveCfImageUrl(angle.canvasDeliveryUrl)}
                      alt={`Angle ${angle.listingPhotoId}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      {angle.status === "running" ? "Rendering…" : "Pending"}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      Room {angle.roomId ?? "—"} · Photo {angle.listingPhotoId ?? "—"}
                    </div>
                    <Badge variant={statusBadgeVariant(angle.status)}>{angle.status}</Badge>
                  </div>
                  {angle.isHero && <div className="mt-1 text-xs text-primary">Hero reference</div>}
                  {angle.error && (
                    <div className="mt-2 text-xs text-destructive">{angle.error}</div>
                  )}
                  {angle.canvasId && angle.sessionId && (
                    <a
                      href={`/admin/render?session=${angle.sessionId}`}
                      className={buttonVariants({ size: "sm", variant: "ghost", className: "mt-2 h-auto px-0 text-xs" })}
                    >
                      Open in studio
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
