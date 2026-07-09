/**
 * @fileoverview 0017 — MCP Ops "Conversations" tab.
 *
 * Master/detail view of saved MCP conversations. The left rail lists rows from
 * `/api/mcp-ops/conversations`; selecting one loads the full record from
 * `/api/mcp-ops/conversations/:id` and renders its body as markdown (via
 * MarkdownProse) or pretty-printed JSON depending on the row's `format`.
 *
 * `initialDetailId` supports deep-linking: when the URL carries a conversation
 * id (…/conversations/:id) the tab opens that conversation pre-selected.
 */

import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";
import {
  apiGet,
  type ConversationDetail,
  type ConversationRow,
  EmptyState,
  ErrorState,
  fmtDate,
  PanelLoading,
  prettyJson,
} from "./shared";

export function ConversationsTab({
  initialDetailId,
  onOpenConversation,
}: {
  initialDetailId?: string | null;
  /** Notify the parent so it can sync the /conversations/:id URL + history. */
  onOpenConversation?: (id: string) => void;
}) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDetailId ?? null,
  );

  // Adopt a deep-linked conversation id when it arrives / changes.
  useEffect(() => {
    if (initialDetailId) setSelectedId(initialDetailId);
  }, [initialDetailId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ conversations: ConversationRow[] }>(
        "/api/mcp-ops/conversations",
      );
      setRows(data.conversations ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No saved conversations"
        hint="Conversations captured by the MCP server will appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="overflow-hidden py-0">
        <ScrollArea className="h-[28rem]">
          <div className="divide-y divide-border/40">
            {rows.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(c.id);
                    onOpenConversation?.(c.id);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {c.title ?? "Untitled conversation"}
                    </span>
                    {c.format ? (
                      <Badge variant="secondary" className="shrink-0 px-1.5 py-0">
                        {c.format}
                      </Badge>
                    ) : null}
                  </div>
                  {c.summary ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {c.summary}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {c.messageCount != null ? `${c.messageCount} messages · ` : ""}
                    {fmtDate(c.updatedAt ?? c.createdAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      <div>
        {selectedId ? (
          <ConversationPanel conversationId={selectedId} />
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Select a conversation"
            hint="Pick a conversation on the left to read its full content."
          />
        )}
      </div>
    </div>
  );
}

function ConversationPanel({ conversationId }: { conversationId: string }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await apiGet<ConversationDetail>(
          `/api/mcp-ops/conversations/${encodeURIComponent(conversationId)}`,
        );
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!detail) return null;

  const isJson = (detail.format ?? "").toLowerCase() === "json";
  const content = detail.content ?? "";

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="gap-1 bg-muted/30 px-4 py-3">
        <CardTitle className="text-sm">
          {detail.title ?? "Untitled conversation"}
        </CardTitle>
        <CardDescription className="text-xs">
          {detail.messageCount != null ? `${detail.messageCount} messages · ` : ""}
          {fmtDate(detail.updatedAt ?? detail.createdAt)}
        </CardDescription>
      </CardHeader>
      <ScrollArea className="h-[26rem]">
        <div className="px-4 py-4">
          {content === "" ? (
            <p className="text-sm text-muted-foreground">
              This conversation has no content.
            </p>
          ) : isJson ? (
            <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
              {prettyJson(content)}
            </pre>
          ) : (
            <MarkdownProse>{content}</MarkdownProse>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
