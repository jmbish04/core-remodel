/**
 * @fileoverview ResearchPortalChat — assistant-ui chat modal for the Deep
 * Research portal, wired to the existing `ResearchAgent` (AIChatAgent DO) via
 * the canonical Cloudflare Agents stack:
 *
 *   useAgent (agents/react)
 *     → useAgentChat (@cloudflare/ai-chat/react)   ← NEVER ai/react (zodv3)
 *       → useAISDKRuntime (@assistant-ui/react-ai-sdk)
 *         → AssistantRuntimeProvider (@assistant-ui/react)
 *
 * Beyond the per-session RAG modal (ResearchChatModal), this surface adds:
 *   - chat SUGGESTIONS on the empty state
 *   - GENERATIVE UI for the agent's data tools (makeAssistantToolUI): live
 *     cards for Materials / Showrooms / Products / RAG matches
 *   - TOOLS over D1 (`/api/materials`, `/api/showroom-stores/...`) and global
 *     Vectorize RAG (`RESEARCH_INDEX`) — executed server-side in onChatMessage,
 *     surfaced here as rich UI so conversations stay data-grounded.
 */

import {
  AssistantRuntimeProvider,
  AssistantModalPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  makeAssistantToolUI,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useAgent } from "agents/react";
// CRITICAL: import from @cloudflare/ai-chat/react — never from ai/react (zodv3 breakage)
import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  Bot,
  Boxes,
  Database,
  Loader2,
  MessageSquare,
  Package,
  Send,
  Sparkles,
  Store,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Summarize the key findings and what they mean for my reno",
  "What materials do I still need to purchase?",
  "Which Bay Area showrooms match this research?",
  "Search all my research for cost ranges and price drivers",
];

// ---------------------------------------------------------------------------
// Generative UI — one tool-UI per server tool (names match chat-tools.ts).
// These render the tool's structured result as a live card inside the thread.
// ---------------------------------------------------------------------------

function ToolShell({
  icon,
  title,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status: "running" | "complete" | "incomplete" | "requires-action";
  children?: React.ReactNode;
}) {
  return (
    <div className="my-1.5 rounded-lg bg-card/80 p-2.5 text-xs ring-1 ring-border/40">
      <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
        <span className="text-emerald-400">{icon}</span>
        <span className="font-medium text-foreground/90">{title}</span>
        {status === "running" && <Loader2 className="ml-auto size-3 animate-spin" />}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right }: { left: string; right?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-border/30 py-1 first:border-t-0">
      <span className="truncate text-foreground/85">{left}</span>
      {right ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{right}</span> : null}
    </div>
  );
}

const MaterialsToolUI = makeAssistantToolUI<
  { room?: string; purchased?: boolean; search?: string },
  { count: number; items: Array<{ id: number; title: string; room?: string | null; brand?: string | null; purchased?: boolean | null }> }
>({
  toolName: "list_materials",
  render: ({ status, result }) => (
    <ToolShell icon={<Boxes className="size-3.5" />} title="Materials Schedule" status={status.type}>
      {result ? (
        <div className="space-y-0">
          {result.items.length === 0 ? (
            <p className="text-muted-foreground">No matching materials.</p>
          ) : (
            result.items.map((m) => (
              <Row key={m.id} left={`${m.title}${m.room ? ` · ${m.room}` : ""}`} right={m.purchased ? "bought" : "needed"} />
            ))
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">{result.count} total</p>
        </div>
      ) : null}
    </ToolShell>
  ),
});

const ShowroomsToolUI = makeAssistantToolUI<
  { search?: string; pricePoint?: string },
  { count: number; stores: Array<{ id: number; name: string; pricePoint?: string | null; scale?: string | null }> }
>({
  toolName: "list_showrooms",
  render: ({ status, result }) => (
    <ToolShell icon={<Store className="size-3.5" />} title="Showrooms" status={status.type}>
      {result ? (
        <div className="space-y-0">
          {result.stores.length === 0 ? (
            <p className="text-muted-foreground">No matching showrooms.</p>
          ) : (
            result.stores.map((s) => <Row key={s.id} left={s.name} right={s.pricePoint ?? s.scale ?? undefined} />)
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">{result.count} total</p>
        </div>
      ) : null}
    </ToolShell>
  ),
});

const ProductsToolUI = makeAssistantToolUI<
  { storeId?: number; search?: string },
  { count: number; products: Array<{ id: number; itemName: string; price?: string | null; leadTime?: string | null }> }
>({
  toolName: "list_products",
  render: ({ status, result }) => (
    <ToolShell icon={<Package className="size-3.5" />} title="Products" status={status.type}>
      {result ? (
        <div className="space-y-0">
          {result.products.length === 0 ? (
            <p className="text-muted-foreground">No matching products.</p>
          ) : (
            result.products.map((p) => <Row key={p.id} left={p.itemName} right={p.price ?? undefined} />)
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">{result.count} total</p>
        </div>
      ) : null}
    </ToolShell>
  ),
});

const ResearchSearchToolUI = makeAssistantToolUI<
  { query: string; topK?: number },
  { count: number; matches: Array<{ score: number; text: string }> }
>({
  toolName: "search_research",
  render: ({ status, args, result }) => (
    <ToolShell icon={<Database className="size-3.5" />} title={`RAG · "${args?.query ?? ""}"`} status={status.type}>
      {result ? (
        <div className="space-y-1.5">
          {result.matches.length === 0 ? (
            <p className="text-muted-foreground">No relevant research chunks.</p>
          ) : (
            result.matches.map((m, i) => (
              <p key={i} className="line-clamp-3 border-l-2 border-emerald-500/40 pl-2 text-foreground/75">
                <span className="mr-1 font-mono text-[9px] text-emerald-400">{m.score}</span>
                {m.text}
              </p>
            ))
          )}
        </div>
      ) : null}
    </ToolShell>
  ),
});

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function UserBubble() {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[80%] rounded-xl bg-emerald-600/20 px-3 py-2 text-sm text-foreground ring-1 ring-emerald-500/20">
        <MessagePrimitive.Content />
      </div>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border/40">
        <User className="size-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

function AssistantBubble() {
  return (
    <div className="flex gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-950 ring-1 ring-emerald-500/30">
        <Bot className="size-3.5 text-emerald-400" />
      </div>
      <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-sm leading-relaxed text-foreground/90 ring-1 ring-border/40">
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function ResearchPortalChat({
  sessionId,
  topic,
}: {
  sessionId: number;
  topic: string;
}) {
  const agent = useAgent({ agent: "ResearchAgent", name: `research-${sessionId}` });
  const chat = useAgentChat({ agent });
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Register generative-UI for every server tool. */}
      <MaterialsToolUI />
      <ShowroomsToolUI />
      <ProductsToolUI />
      <ResearchSearchToolUI />

      <AssistantModalPrimitive.Root>
        <AssistantModalPrimitive.Anchor className="fixed bottom-6 right-6 z-50">
          <AssistantModalPrimitive.Trigger asChild>
            <Button
              size="icon-lg"
              aria-label="Open research chat"
              className="size-12 rounded-full bg-emerald-500 text-emerald-950 shadow-lg hover:bg-emerald-500/90"
            >
              <MessageSquare className="size-5" />
            </Button>
          </AssistantModalPrimitive.Trigger>
        </AssistantModalPrimitive.Anchor>

        <AssistantModalPrimitive.Content
          sideOffset={16}
          className="z-50 flex h-[640px] max-h-[80vh] w-[min(440px,calc(100vw_-_2rem))] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-border/40 outline-none"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
            <Bot className="size-4 text-emerald-400" />
            <span className="text-sm font-semibold">Research assistant</span>
            <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/25">
              RAG + D1 tools
            </span>
          </div>

          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <ThreadPrimitive.Empty>
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                    <Sparkles className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Ask about this research — grounded in your data</p>
                    <p className="mt-1 line-clamp-2 max-w-[18rem] text-xs text-muted-foreground">
                      Findings on “{topic}”, plus live Materials, Showrooms, Products &amp; cross-session RAG.
                    </p>
                  </div>
                  <div className="mt-1 flex w-full flex-col gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <ThreadPrimitive.Suggestion
                        key={s}
                        prompt={s}
                        method="replace"
                        autoSend
                        className="cursor-pointer rounded-lg bg-card px-3 py-2 text-left text-xs text-foreground/80 ring-1 ring-border/40 transition hover:ring-border"
                      >
                        {s}
                      </ThreadPrimitive.Suggestion>
                    ))}
                  </div>
                </div>
              </ThreadPrimitive.Empty>

              <ThreadPrimitive.Messages
                components={{ UserMessage: UserBubble, AssistantMessage: AssistantBubble }}
              />
            </ThreadPrimitive.Viewport>

            {/* Composer */}
            <div className="border-t border-border/40 p-3">
              <ComposerPrimitive.Root className="flex items-end gap-2">
                <ComposerPrimitive.Input
                  rows={1}
                  placeholder="Ask a data-grounded question…"
                  className="flex-1 resize-none rounded-lg bg-card px-3 py-2 text-sm text-foreground ring-1 ring-border/40 outline-none placeholder:text-muted-foreground focus:ring-emerald-500/40"
                />
                <ComposerPrimitive.Send asChild>
                  <Button size="icon-sm" aria-label="Send" className="size-9 shrink-0">
                    <Send className="size-4" />
                  </Button>
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </div>
          </ThreadPrimitive.Root>
        </AssistantModalPrimitive.Content>
      </AssistantModalPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
