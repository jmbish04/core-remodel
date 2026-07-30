/**
 * @fileoverview Full-page store inbox (0041) — /admin/shopping/store/[id]/inbox.
 *
 * A dedicated, full-width two-pane mail surface auto-scoped to ONE showroom
 * (matching is server-side via `?folder=`), replacing the cramped inline
 * `ShowroomGmailPanel`. Folders rail (Inbox / Receipts / Spam / Trash) + a
 * reused `GmailThreadList` + a reading pane with attachment/embedded-image
 * strips and a PlateJS (`OverviewNoteEditor`) reply composer with AI-draft.
 *
 * Body is rendered as PLAINTEXT (the quoted-reply tail collapsed behind a
 * toggle) + a separate gallery of embedded images served from our own
 * Cloudflare Images URLs — we never inject raw email HTML (XSS).
 */
import * as React from "react";
import { Inbox, Receipt, ShieldAlert, Trash2, Mail, Reply, Sparkles, Paperclip, ChevronDown, ChevronRight, RefreshCw, MailOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";
import { Button } from "@/components/ui/button";
import { GmailThreadList } from "./GmailThreadList";
import {
  gmailApi,
  displayNameFromAddress,
  formatFullDate,
  type GmailFolder,
  type GmailFolderCounts,
  type GmailInboxThreadItemWithUnread,
  type ThreadDetailResponse,
} from "./types";

const FOLDERS: { key: GmailFolder; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "receipts", label: "Receipts", icon: Receipt },
  { key: "spam", label: "Spam", icon: ShieldAlert },
  { key: "trash", label: "Trash", icon: Trash2 },
];

const EMPTY_COUNTS: GmailFolderCounts = { inbox: 0, receipts: 0, spam: 0, trash: 0 };

/** Embedded images are served from Cloudflare Images; never render any other host. */
function isTrustedImageUrl(url: string): boolean {
  return /^https:\/\/imagedelivery\.net\//.test(url);
}

export function StoreInboxApp({ storeId, storeName: storeNameProp }: { storeId: number; storeName?: string }) {
  const [storeName, setStoreName] = React.useState(storeNameProp ?? "Showroom");
  const [folder, setFolder] = React.useState<GmailFolder>("inbox");

  // Resolve the showroom's name for the header/rail (same endpoint the viewport uses).
  React.useEffect(() => {
    if (storeNameProp) return;
    const controller = new AbortController();
    fetch(`/api/showroom-stores/${storeId}`, { credentials: "include", signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ name?: string }>) : null))
      .then((d) => {
        if (d?.name) setStoreName(d.name);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [storeId, storeNameProp]);

  const [threads, setThreads] = React.useState<GmailInboxThreadItemWithUnread[]>([]);
  const [counts, setCounts] = React.useState<GmailFolderCounts>(EMPTY_COUNTS);
  const [domains, setDomains] = React.useState<string[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoadingList(true);
    gmailApi
      .listShowroomThreadsByDomain(storeId, folder, controller.signal)
      .then((data) => {
        setThreads(data.threads);
        setCounts(data.counts);
        setDomains([...data.domains, ...data.emails]);
        // keep selection only if it still exists in this folder
        setSelectedThreadId((cur) => (cur && data.threads.some((t) => t.threadId === cur) ? cur : null));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        toast.error(err instanceof Error ? err.message : "Failed to load inbox");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingList(false);
      });
    return () => controller.abort();
  }, [storeId, folder, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="flex h-[calc(100svh-9rem)] w-full overflow-hidden rounded-lg border bg-card">
      {/* Folders rail */}
      <nav className="flex w-48 shrink-0 flex-col border-r bg-muted/20 p-2">
        <div className="flex items-center gap-2 px-2 py-3">
          <Mail className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{storeName}</span>
        </div>
        {FOLDERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFolder(key)}
            className={`flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors ${
              folder === key ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-4" />
              {label}
            </span>
            {counts[key] > 0 ? (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                {counts[key]}
              </span>
            ) : null}
          </button>
        ))}
        <div className="mt-auto px-2 pb-1 pt-3 text-[10px] leading-relaxed text-muted-foreground">
          Scoped to {storeName}. Matching:{" "}
          {domains.length > 0 ? domains.map((d) => `@${d.replace(/^@/, "")}`).join(", ") : "—"}
        </div>
      </nav>

      {/* Thread list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold capitalize">{folder}</span>
          <Button size="icon" variant="ghost" className="size-7" onClick={reload} aria-label="Refresh">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GmailThreadList
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
            loading={loadingList}
            emptyLabel={`No mail in ${folder} for ${storeName}.`}
          />
        </div>
      </div>

      {/* Reading pane */}
      <div className="min-w-0 flex-1">
        {selectedThreadId ? (
          <ThreadReadingPane
            key={selectedThreadId}
            threadId={selectedThreadId}
            folder={folder}
            onChanged={reload}
            onClosed={() => {
              setSelectedThreadId(null);
              reload();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a message to read.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reading pane ─────────────────────────────────────────────────────────────

function ThreadReadingPane({
  threadId,
  folder,
  onChanged,
  onClosed,
}: {
  threadId: string;
  folder: GmailFolder;
  onChanged: () => void;
  onClosed: () => void;
}) {
  const [data, setData] = React.useState<ThreadDetailResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [replying, setReplying] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    gmailApi
      .getThread(threadId, controller.signal)
      .then((d) => {
        setData(d);
        // Opening a thread marks it read.
        void gmailApi.markThreadRead(threadId).then(onChanged).catch(() => {});
      })
      .catch((err) => {
        if (!controller.signal.aborted) toast.error(err instanceof Error ? err.message : "Failed to load thread");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const markUnread = async () => {
    try {
      await gmailApi.markThreadUnread(threadId);
      toast.success("Marked unread.");
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const del = async () => {
    try {
      await gmailApi.deleteThread(threadId);
      toast.success("Moved to Trash.");
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const { thread, messages, attachments, images } = data;

  return (
    <div className="flex h-full flex-col">
      {/* Header + actions */}
      <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{thread.subject || "(no subject)"}</h2>
          <p className="text-xs text-muted-foreground">
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={markUnread}>
            <MailOpen className="size-3.5" /> Unread
          </Button>
          {folder !== "trash" ? (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={del}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {messages.map((m) => (
          <MessageBlock
            key={m.id}
            message={m}
            attachments={attachments.filter((a) => a.gmailMessageId === m.id)}
            images={images.filter((i) => i.gmailMessageId === m.id)}
          />
        ))}
      </div>

      {/* Composer */}
      <div className="border-t bg-muted/10 p-4">
        {replying ? (
          <ReplyComposer
            threadId={threadId}
            onSent={() => {
              setReplying(false);
              onChanged();
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <Button className="gap-1.5" onClick={() => setReplying(true)}>
              <Reply className="size-4" /> Reply
            </Button>
            <p className="text-[11px] text-muted-foreground">
              💬 Prefer chat? Ask your MCP tool:{" "}
              <span className="font-mono text-foreground">reply to gmail thread {threadId}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  attachments,
  images,
}: {
  message: ThreadDetailResponse["messages"][number];
  attachments: ThreadDetailResponse["attachments"];
  images: ThreadDetailResponse["images"];
}) {
  const [showQuoted, setShowQuoted] = React.useState(false);
  const isReceipt = ["receipt", "invoice", "quote"].includes(message.classification);

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{displayNameFromAddress(message.fromRecipient)}</span>
          <span className="ml-2 truncate text-xs text-muted-foreground">{message.fromRecipient}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message.isSpam ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">Spam</span>
          ) : null}
          {isReceipt ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
              {message.classification}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">{formatFullDate(message.timestamp)}</span>
        </div>
      </div>

      {/* Body — plaintext, quoted tail collapsed */}
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {message.bodyVisible ?? message.body ?? ""}
      </div>
      {message.bodyQuoted ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showQuoted ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {showQuoted ? "Hide" : "Show"} quoted text
          </button>
          {showQuoted ? (
            <div className="mt-2 whitespace-pre-wrap border-l-2 pl-3 text-xs text-muted-foreground">
              {message.bodyQuoted}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Embedded images — only render URLs served by Cloudflare Images (these
          are OUR uploads; guard against any non-CF host sneaking into src). */}
      {images.filter((i) => isTrustedImageUrl(i.deliveryUrl)).length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {images.filter((i) => isTrustedImageUrl(i.deliveryUrl)).map((img) => (
            <a key={img.id} href={img.deliveryUrl} target="_blank" rel="noreferrer">
              <img
                src={img.deliveryUrl}
                alt={img.contentId ?? "embedded image"}
                className="max-h-40 rounded-md border object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      {/* Attachments */}
      {attachments.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
              title={a.fileMimetype ?? undefined}
            >
              <Paperclip className="size-3.5 text-muted-foreground" />
              <span className="max-w-[180px] truncate font-medium">{a.fileName ?? "attachment"}</span>
              {a.fileSizeBytes ? (
                <span className="text-muted-foreground">{Math.max(1, Math.round(a.fileSizeBytes / 1024))} KB</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Reply composer (PlateJS) ─────────────────────────────────────────────────

function ReplyComposer({
  threadId,
  onSent,
  onCancel,
}: {
  threadId: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState<{ markdown: string; html: string }>({ markdown: "", html: "" });
  const [editorKey, setEditorKey] = React.useState(0);
  const [initialMarkdown, setInitialMarkdown] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [drafting, setDrafting] = React.useState(false);

  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const res = await gmailApi.draftAssist(threadId);
      setInitialMarkdown(res.draft);
      setValue({ markdown: res.draft, html: "" });
      setEditorKey((k) => k + 1); // remount editor with the drafted content
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!value.markdown.trim() && !value.html.trim()) {
      toast.error("Write a reply before sending.");
      return;
    }
    setSending(true);
    try {
      await gmailApi.reply(threadId, { markdown: value.markdown, html: value.html });
      toast.success("Reply sent.");
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border bg-background">
      <div className="p-3">
        <OverviewNoteEditor
          key={editorKey}
          variant="modal"
          initialMarkdown={initialMarkdown}
          onChange={(v) => setValue({ markdown: v.markdown, html: v.html })}
        />
      </div>
      <div className="flex items-center justify-between border-t p-2">
        <Button size="sm" variant="ghost" className="gap-1.5 text-sky-600" onClick={draftWithAi} disabled={drafting}>
          <Sparkles className="size-4" /> {drafting ? "Drafting…" : "Draft with AI"}
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Discard
          </Button>
          <Button size="sm" className="gap-1.5" onClick={send} disabled={sending}>
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Reply className="size-3.5" />} Send
          </Button>
        </div>
      </div>
    </div>
  );
}
