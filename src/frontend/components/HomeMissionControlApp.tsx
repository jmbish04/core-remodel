import {
  ArrowRight,
  Clock3,
  Construction,
  Loader2,
  MessageSquare,
  Ruler,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface NavigationGuideItem {
  label: string;
  href: string;
  description: string;
}

interface RecentUpdate {
  id: string;
  displayName: string | null;
  roomType: string | null;
  photoCategory: string;
  datetimeCreated: string | null;
}

interface HomeownerMessage {
  id: string;
  title: string;
  message: string;
  author: string;
  datetimeCreated: string | null;
}

interface HomePayload {
  success: boolean;
  navigationGuide: NavigationGuideItem[];
  recentUpdates: RecentUpdate[];
  homeownerMessages: HomeownerMessage[];
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown date";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return date.toLocaleString();
}

function getUpdateLabel(update: RecentUpdate): string {
  const room = update.roomType?.trim() || "Unassigned room";
  const category = update.photoCategory === "listing"
    ? "Listing"
    : update.photoCategory === "ai_render"
      ? "AI Render"
      : "Inspiration";
  return `${category} · ${room}`;
}

export function HomeMissionControlApp() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const loadHomeData = useCallback(async () => {
    setLoading(true);
    try {
      const [homeResponse, authResponse] = await Promise.all([
        fetch("/api/portal/home", { credentials: "include" }),
        fetch("/api/access/status", { credentials: "include" }),
      ]);

      const homePayload = (await homeResponse.json()) as HomePayload & { error?: string };
      const authPayload = (await authResponse.json()) as { authenticated?: boolean };

      if (!homeResponse.ok || !homePayload.success) {
        throw new Error(homePayload.error || "Failed to load mission control data");
      }

      setPayload(homePayload);
      setAuthenticated(Boolean(authPayload.authenticated));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load home page");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  const postMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!title.trim() || !message.trim()) {
      toast.error("Title and message are required");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/portal/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), message: message.trim() }),
      });

      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to post message");
      }

      setTitle("");
      setMessage("");
      toast.success("Message posted for contractor view");
      await loadHomeData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to post message");
    } finally {
      setSubmitting(false);
    }
  };

  const navigation = useMemo(() => payload?.navigationGuide || [], [payload?.navigationGuide]);
  const updates = useMemo(() => payload?.recentUpdates || [], [payload?.recentUpdates]);
  const messages = useMemo(() => payload?.homeownerMessages || [], [payload?.homeownerMessages]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading mission control...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-2xl">Contractor Briefing Hub</CardTitle>
          <CardDescription>
            This workspace is the single source of truth for existing conditions, design intent,
            and iterative decisions for 126 Colby.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {navigation.map((item, index) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-xl bg-muted/30 p-4 ring-1 ring-border/40 transition hover:bg-muted/45"
              data-track={`home-nav-${item.label}`}
            >
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                Open section
                <ArrowRight className="size-3" />
              </div>
              {index === 0 ? <Ruler className="mt-3 size-4 text-muted-foreground" /> : null}
              {index === 1 ? <Sparkles className="mt-3 size-4 text-muted-foreground" /> : null}
              {index === 2 ? <Construction className="mt-3 size-4 text-muted-foreground" /> : null}
            </a>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-4 text-muted-foreground" />
              Recent Project Updates
            </CardTitle>
            <CardDescription>Latest uploaded assets and design movement.</CardDescription>
          </CardHeader>
          <CardContent>
            {updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              <div className="space-y-3">
                {updates.slice(0, 12).map((update) => (
                  <div key={update.id} className="rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                    <p className="text-sm font-medium">{update.displayName?.trim() || "Untitled photo"}</p>
                    <p className="text-xs text-muted-foreground">{getUpdateLabel(update)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(update.datetimeCreated)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              Homeowner Messages
            </CardTitle>
            <CardDescription>
              Notes posted here are highlighted for contractors on their next visit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active homeowner messages.</p>
            ) : (
              <div className="space-y-3">
                {messages.map((item) => (
                  <div key={item.id} className="rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.author} • {formatDate(item.datetimeCreated)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {authenticated ? (
              <form className="space-y-3 rounded-xl bg-muted/20 p-3 ring-1 ring-border/30" onSubmit={postMessage}>
                <Input
                  placeholder="Message title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={submitting}
                />
                <Textarea
                  placeholder="Write update for contractors"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={4}
                  disabled={submitting}
                />
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Posting
                    </>
                  ) : (
                    "Post Message"
                  )}
                </Button>
              </form>
            ) : (
              <div className="rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                <p className="text-xs text-muted-foreground">
                  Sign in through a protected page to post homeowner messages.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
