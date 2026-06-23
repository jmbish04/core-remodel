/**
 * @fileoverview Research chat — a strict assistant-ui floating modal.
 *
 * Uses the assistant-ui AssistantModalPrimitive (floating trigger + popup),
 * wired to the ResearchAgent Durable Object via @cloudflare/ai-chat
 * (`useAgent` → `useAgentChat`) for RAG-grounded answers over the session's
 * Vectorize namespace. Includes suggested prompts on the empty state.
 *
 * Generative UI: register assistant-ui tool UIs here once the ResearchAgent
 * chat exposes tools (e.g. a "cite_sources" tool) — see the note below.
 */

import {
  AssistantRuntimeProvider,
  AssistantModalPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useAgent } from "agents/react";
// CRITICAL: import from @cloudflare/ai-chat/react — never from ai/react (zodv3 breakage)
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Bot, MessageSquare, Send, Sparkles, User } from "lucide-react";

import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Summarize the key findings",
  "What are the cost ranges and price drivers?",
  "List the top vendors or products with tradeoffs",
  "What should I watch out for?",
];

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
      <div className="max-w-[80%] rounded-xl bg-card px-3 py-2 text-sm leading-relaxed text-foreground/90 ring-1 ring-border/40">
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

export function ResearchChatModal({
  sessionId,
  topic,
}: {
  sessionId: number;
  topic: string;
}) {
  const agent = useAgent({ agent: "ResearchAgent", name: `research-${sessionId}` });
  const chat = useAgentChat({ agent });

  const runtime = useExternalStoreRuntime({
    isRunning: chat.status === "streaming" || chat.status === "submitted",
    messages: chat.messages,
    convertMessage: (message: any) => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text" as const, text: message.content }],
    }),
    onNew: async (message) => {
      if (message.content[0]?.type === "text") {
        chat.sendMessage({
          role: "user",
          parts: [{ type: "text", text: message.content[0].text }],
        });
      }
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
          className="z-50 flex h-[600px] max-h-[80vh] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-border/40 outline-none"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
            <Bot className="size-4 text-emerald-400" />
            <span className="text-sm font-semibold">Research chat</span>
            <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/25">
              RAG
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
                    <p className="text-sm font-medium text-foreground">Ask about this research</p>
                    <p className="mt-1 line-clamp-2 max-w-[16rem] text-xs text-muted-foreground">
                      Grounded in the deep research on “{topic}”.
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
                  placeholder="Ask a question about the research…"
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
