/**
 * @fileoverview AdminChatPanel — Full-page chat panel for the admin dashboard.
 *
 * Wired to AdminChatAgent (AIChatAgent DO) via the canonical Cloudflare stack:
 *   useAgent (agents/react)
 *     → useAgentChat (@cloudflare/ai-chat/react)   ← NEVER ai/react (zodv3)
 *       → useAISDKRuntime (@assistant-ui/react-ai-sdk)
 *         → AssistantRuntimeProvider (@assistant-ui/react)
 *
 * Features:
 *   - Model selector (Kimi K2.6 / Llama 4 Scout / Llama 3.3 70B)
 *   - New Chat (clear history)
 *   - Streaming responses with typing indicator
 *   - Monolith design system (dark, ring/divider separation)
 */

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useCallback, useState } from "react";
import {
  Bot,
  ChevronDown,
  Loader2,
  Plus,
  Send,
  Sparkles,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MODELS = [
  { key: "kimi-k2.6", label: "Kimi K2.6", tag: "default" },
  { key: "llama-4-scout", label: "Llama 4 Scout", tag: "16E" },
  { key: "llama-3.3-70b", label: "Llama 3.3 70B", tag: "quality" },
] as const;

const SUGGESTIONS = [
  "What's the current status of the renovation project?",
  "Help me plan a showroom visit route across the Bay Area",
  "Summarize our budget breakdown and biggest cost drivers",
  "What Cloudflare Workers features should we use for the next feature?",
];

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function UserBubble() {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[80%] rounded-xl bg-sky-600/15 px-3 py-2 text-sm text-foreground ring-1 ring-sky-500/20">
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
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-950 ring-1 ring-sky-500/30">
        <Bot className="size-3.5 text-sky-400" />
      </div>
      <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-sm leading-relaxed text-foreground/90 ring-1 ring-border/40">
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model Selector
// ---------------------------------------------------------------------------

function ModelSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = MODELS.find((m) => m.key === value) ?? MODELS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs font-medium text-foreground/80 ring-1 ring-border/40 transition hover:ring-border"
      >
        <span>{current.label}</span>
        <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[9px] font-normal uppercase tracking-widest text-muted-foreground">
          {current.tag}
        </Badge>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-md bg-popover p-1 shadow-lg ring-1 ring-border/40">
          {MODELS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                onChange(m.key);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition ${
                m.key === value
                  ? "bg-sky-500/10 text-sky-400"
                  : "text-foreground/80 hover:bg-muted/60"
              }`}
            >
              <span className="flex-1">{m.label}</span>
              <Badge
                variant="outline"
                className="px-1 py-0 text-[9px] font-normal uppercase tracking-widest text-muted-foreground"
              >
                {m.tag}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AdminChatPanel() {
  const [model, setModel] = useState(MODELS[0].key);
  const [chatId, setChatId] = useState(() => `admin-chat-${Date.now()}`);

  const agent = useAgent({ agent: "AdminChatAgent", name: chatId });
  const chat = useAgentChat({ agent, options: { model } as any });
  const runtime = useAISDKRuntime(chat);

  const handleNewChat = useCallback(() => {
    setChatId(`admin-chat-${Date.now()}`);
  }, []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="mx-auto flex h-[calc(100vh-180px)] max-h-[800px] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-background ring-1 ring-border/40">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <Bot className="size-4" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">Admin Assistant</h2>
            <p className="text-[11px] text-muted-foreground">General-purpose AI chat</p>
          </div>
          <ModelSelector value={model} onChange={setModel} />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleNewChat}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New Chat
          </Button>
        </div>

        {/* Thread */}
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <ThreadPrimitive.Empty>
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
                  <Sparkles className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    How can I help?
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Ask me anything about the renovation, showrooms, budget, permits, or the platform itself.
                  </p>
                </div>
                <div className="mt-2 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <ThreadPrimitive.Suggestion
                      key={s}
                      prompt={s}
                      method="replace"
                      autoSend
                      className="cursor-pointer rounded-lg bg-card px-3 py-2.5 text-left text-xs text-foreground/80 ring-1 ring-border/40 transition hover:ring-border"
                    >
                      {s}
                    </ThreadPrimitive.Suggestion>
                  ))}
                </div>
              </div>
            </ThreadPrimitive.Empty>

            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserBubble,
                AssistantMessage: AssistantBubble,
              }}
            />
          </ThreadPrimitive.Viewport>

          {/* Composer */}
          <div className="border-t border-border/40 p-3">
            <ComposerPrimitive.Root className="flex items-end gap-2">
              <ComposerPrimitive.Input
                rows={1}
                placeholder="Ask anything…"
                className="flex-1 resize-none rounded-lg bg-card px-3 py-2.5 text-sm text-foreground ring-1 ring-border/40 outline-none placeholder:text-muted-foreground focus:ring-sky-500/40"
              />
              <ComposerPrimitive.Send asChild>
                <Button
                  size="icon-sm"
                  aria-label="Send"
                  className="size-9 shrink-0 bg-sky-600 text-white hover:bg-sky-600/90"
                >
                  <Send className="size-4" />
                </Button>
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}
