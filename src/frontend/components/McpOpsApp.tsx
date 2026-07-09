/**
 * @fileoverview 0017 — MCP Ops observability island (root).
 *
 * A tabbed operator console for the MCP server. Fetches everything from the
 * admin-gated, same-origin `/api/mcp-ops/*` JSON endpoints (credentials sent so
 * the session cookie rides along). Nothing here is mocked — every value comes
 * from the API, and every fetch handles loading / empty / error / 401 states.
 *
 * This file is intentionally thin: it owns KPI cards, the tab strip, and — most
 * importantly — the URL <-> tab synchronisation and deep-link plumbing. Each
 * tab's body lives in its own focused module under `./mcp-ops/*`.
 *
 * URL model (see `pages/admin/mcp-ops/[...path].astro`):
 *   /admin/mcp-ops                    -> Sessions
 *   /admin/mcp-ops/logs               -> Logs
 *   /admin/mcp-ops/conversations      -> Conversations
 *   /admin/mcp-ops/conversations/:id  -> Conversations, that record open
 *   /admin/mcp-ops/bugs               -> Bugs
 *   /admin/mcp-ops/features           -> Features
 *   /admin/mcp-ops/features/:id       -> Features, full-page article for :id
 *
 * The component is CONTROLLED: `tab` state drives `<Tabs value>`, and every
 * user navigation `pushState`s the canonical URL. A `popstate` listener
 * re-derives the tab (and, for features, the open record) from the pathname so
 * browser back/forward works.
 *
 * Tab order: Sessions · Logs · Conversations · Bugs · Features.
 *
 * Monolith rules: dark theme, no 1px borders (ring/divide/bg-card only), no
 * window.confirm/alert, theme tokens only, mobile-responsive.
 */

import { useCallback, useEffect, useState } from "react";
import { Bug, Lightbulb, MessageSquare, ScrollText, Terminal } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { OverviewCards } from "./mcp-ops/OverviewCards";
import { SessionsTab } from "./mcp-ops/SessionsTab";
import { LogsTab } from "./mcp-ops/LogsTab";
import { ConversationsTab } from "./mcp-ops/ConversationsTab";
import { BugsTab } from "./mcp-ops/BugsTab";
import { FeaturesTab } from "./mcp-ops/FeaturesTab";

const BASE = "/admin/mcp-ops";

/** The canonical, URL-addressable tab ids in render order. */
const TAB_IDS = ["sessions", "logs", "conversations", "bugs", "features"] as const;
type TabId = (typeof TAB_IDS)[number];

/** Validate an arbitrary string to a known tab id, defaulting to "sessions". */
function normalizeTab(t: string | null | undefined): TabId {
  return (TAB_IDS as readonly string[]).includes(t ?? "")
    ? (t as TabId)
    : "sessions";
}

/**
 * Derive `{ tab, detailId }` from a pathname like `/admin/mcp-ops/features/5`.
 * Segments after the base: [0] = tab, [1] = optional detail id.
 */
function parsePath(pathname: string): { tab: TabId; detailId: string | null } {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : "";
  const segments = rest.split("/").filter(Boolean);
  return {
    tab: normalizeTab(segments[0]),
    detailId: segments[1] ?? null,
  };
}

/** Build a canonical URL for a tab (+ optional detail id). */
function buildUrl(tab: TabId, detailId?: string | null): string {
  if (detailId) return `${BASE}/${tab}/${encodeURIComponent(detailId)}`;
  if (tab === "sessions") return BASE;
  return `${BASE}/${tab}`;
}

export function McpOpsApp({
  initialTab,
  initialDetailId,
}: {
  initialTab?: string;
  initialDetailId?: string;
}) {
  const [tab, setTab] = useState<TabId>(normalizeTab(initialTab));
  // Detail id for the two tabs that support deep-linking a record.
  const [featureId, setFeatureId] = useState<string | null>(
    normalizeTab(initialTab) === "features" ? (initialDetailId ?? null) : null,
  );
  const [conversationId] = useState<string | null>(
    normalizeTab(initialTab) === "conversations" ? (initialDetailId ?? null) : null,
  );
  // A session id handed off from the Logs tab so Sessions opens pre-selected.
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);

  /** Switch tabs and push the canonical URL (no reload). */
  const goTab = useCallback((next: TabId, detailId?: string | null) => {
    setTab(next);
    if (next !== "features") setFeatureId(null);
    if (next === "features") setFeatureId(detailId ?? null);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", buildUrl(next, detailId));
    }
  }, []);

  // Browser back/forward: re-derive tab + open record from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const { tab: t, detailId } = parsePath(window.location.pathname);
      setTab(t);
      setFeatureId(t === "features" ? detailId : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* -- Features full-page open/close (also drives the /features/:id URL) -- */
  const openFeature = useCallback((id: string) => {
    setFeatureId(id);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", buildUrl("features", id));
    }
  }, []);
  const closeFeature = useCallback(() => {
    setFeatureId(null);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", buildUrl("features"));
    }
  }, []);

  /* -- Logs -> Sessions hand-off -- */
  const openSession = useCallback((sessionId: string) => {
    setFocusSessionId(sessionId);
    setTab("sessions");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", buildUrl("sessions"));
    }
  }, []);

  return (
    <div className="space-y-2">
      <OverviewCards />

      <Tabs value={tab} onValueChange={(t) => goTab(normalizeTab(t))}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="sessions">
            <Terminal className="h-4 w-4" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="logs">
            <ScrollText className="h-4 w-4" />
            Logs
          </TabsTrigger>
          <TabsTrigger value="conversations">
            <MessageSquare className="h-4 w-4" />
            Conversations
          </TabsTrigger>
          <TabsTrigger value="bugs">
            <Bug className="h-4 w-4" />
            Bugs
          </TabsTrigger>
          <TabsTrigger value="features">
            <Lightbulb className="h-4 w-4" />
            Features
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab focusSessionId={focusSessionId} />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <LogsTab onOpenSession={openSession} />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
          <ConversationsTab initialDetailId={conversationId} />
        </TabsContent>
        <TabsContent value="bugs" className="mt-4">
          <BugsTab />
        </TabsContent>
        <TabsContent value="features" className="mt-4">
          <FeaturesTab
            selectedId={featureId}
            onOpenFeature={openFeature}
            onCloseFeature={closeFeature}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
