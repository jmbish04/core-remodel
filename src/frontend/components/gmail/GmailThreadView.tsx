/**
 * @fileoverview Right reading pane of the Gmail two-pane layout. Given a
 * `threadId`, fetches `GET /api/gmail/threads/:threadId`, renders the messages
 * chronologically (each: from, date, subject, body; `aiSummary` shown as a
 * subtle summary chip), and hosts the reply composer.
 *
 * Composer actions:
 *   - "Draft with AI"  → POST /api/gmail/draft-assist (fills the composer)
 *   - "Send"           → POST /api/gmail/threads/:threadId/reply (reply-all)
 *
 * On a successful send the thread is refetched so the just-sent message appears.
 * Every fetch is race-guarded with an `active` flag + AbortController so a fast
 * thread switch never lands stale data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  Building2,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  displayNameFromAddress,
  formatFullDate,
  gmailApi,
  initialsFromAddress,
  type GmailMessage,
  type GmailThreadDetail,
} from "./types";

interface GmailThreadViewProps {
  threadId: string | null;
  /** Optional company name to render as a scope chip in the header. */
  companyName?: string | null;
  /** Mobile back affordance — shown only when provided. */
  onBack?: () => void;
}

function EmptyReadingPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="rounded-full bg-muted/60 p-4">
        <Mail className="size-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        Select a conversation to read it here.
      </p>
    </div>
  );
}

function ThreadViewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg bg-card p-4 ring-1 ring-border/40">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function MessageCard({ msg }: { msg: GmailMessage }) {
  const senderName = displayNameFromAddress(msg.fromRecipient);
  const to = msg.toRecipients.join(", ");
  return (
    <article className="rounded-lg bg-card p-4 ring-1 ring-border/40">
      <header className="flex items-start gap-3">
        <Avatar className="size-8 shrink-0 bg-primary/10 text-primary">
          <AvatarFallback className="bg-primary/10 text-primary">
            {initialsFromAddress(msg.fromRecipient)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {senderName}
            </span>
            <time className="shrink-0 text-xs text-muted-foreground">
              {formatFullDate(msg.timestamp)}
            </time>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={msg.fromRecipient}>
            {msg.fromRecipient}
          </p>
          {to && (
            <p className="truncate text-xs text-muted-foreground" title={to}>
              to {to}
            </p>
          )}
        </div>
      </header>

      {msg.aiSummary && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-primary/5 px-3 py-2 ring-1 ring-primary/20">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">{msg.aiSummary}</p>
        </div>
      )}

      {msg.body ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {msg.body}
        </p>
      ) : (
        <p className="mt-3 text-sm italic text-muted-foreground">
          No message body.
        </p>
      )}
    </article>
  );
}

export function GmailThreadView({
  threadId,
  companyName,
  onBack,
}: GmailThreadViewProps) {
  const [thread, setThread] = useState<GmailThreadDetail | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (id: string, signal: AbortSignal, isActive: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const data = await gmailApi.getThread(id, signal);
        if (!isActive()) return;
        setThread(data.thread);
        setMessages(data.messages);
      } catch (err) {
        if (signal.aborted || !isActive()) return;
        const message = err instanceof Error ? err.message : "Failed to load thread";
        setError(message);
        setThread(null);
        setMessages([]);
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [],
  );

  // Fetch on threadId change, race-guarded.
  useEffect(() => {
    if (!threadId) {
      setThread(null);
      setMessages([]);
      setError(null);
      setReplyBody("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    // Reset the composer when switching threads.
    setReplyBody("");
    void load(threadId, controller.signal, () => active);
    return () => {
      active = false;
      controller.abort();
    };
  }, [threadId, load]);

  // Manual refetch (used after a successful send, and by the refresh button).
  const refetch = useCallback(() => {
    if (!threadId) return;
    const controller = new AbortController();
    void load(threadId, controller.signal, () => true);
  }, [threadId, load]);

  const draftWithAi = useCallback(async () => {
    if (!threadId) return;
    setDrafting(true);
    try {
      const { draft } = await gmailApi.draftAssist(threadId);
      setReplyBody(draft);
      toast.success("AI draft ready — review before sending.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setDrafting(false);
    }
  }, [threadId]);

  const send = useCallback(async () => {
    if (!threadId) return;
    const body = replyBody.trim();
    if (!body) {
      toast.error("Write a reply before sending.");
      return;
    }
    setSending(true);
    try {
      await gmailApi.reply(threadId, body);
      toast.success("Reply sent.");
      setReplyBody("");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }, [threadId, replyBody, refetch]);

  if (!threadId) return <EmptyReadingPane />;

  const subject = thread?.subject || messages[0]?.subject || "(no subject)";
  const busy = drafting || sending;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-4 py-3 md:px-6">
        <div className="flex items-start gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to list"
              className="md:hidden"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground" title={subject}>
              {subject}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {messages.length} message{messages.length === 1 ? "" : "s"}
              </span>
              {companyName && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Building2 className="size-3" />
                  {companyName}
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refetch}
            disabled={loading}
            aria-label="Refresh thread"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1">
        {loading && messages.length === 0 ? (
          <ThreadViewSkeleton />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm text-muted-foreground">
              This thread has no messages.
            </p>
          </div>
        ) : (
          <div className="space-y-4 p-4 md:p-6">
            {messages.map((msg) => (
              <MessageCard key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Composer */}
      {!error && messages.length > 0 && (
        <div className="shrink-0 border-t border-border/40 bg-background p-4 md:px-6">
          <Textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
            className="min-h-24 resize-y"
            disabled={busy}
            aria-label="Reply body"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={draftWithAi}
              disabled={busy}
            >
              <Sparkles className={`mr-2 size-4 ${drafting ? "animate-pulse" : ""}`} />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
            <Button size="sm" onClick={send} disabled={busy || !replyBody.trim()}>
              <Send className="mr-2 size-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
          <Separator className="mt-3 opacity-0" />
        </div>
      )}
    </div>
  );
}
