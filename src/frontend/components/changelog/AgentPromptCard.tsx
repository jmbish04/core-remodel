import { useState } from "react";
import { Copy, Check, Terminal, FileCode2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface AgentPromptCardProps {
  /** Header title. */
  title?: string;
  /** The prompt text — rendered verbatim in a monospace frame (paste-ready). */
  prompt: string;
  /** Optional one-line subtitle. */
  description?: string;
  className?: string;
}

/**
 * Framed, copy-able monospace card for a coding-agent PROMPT. The prompt is a
 * paste-verbatim artifact, so it is intentionally NOT markdown-rendered — it is
 * shown pre-wrapped in a bordered frame with a copy button and a character
 * count, instead of a bare unframed `<pre>` blob.
 */
export function AgentPromptCard({
  title = "Agent prompt",
  prompt,
  description,
  className,
}: AgentPromptCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy prompt:", err);
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
    >
      {/* Frame header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-foreground/80">
            <Terminal className="size-3.5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold tracking-tight text-foreground">
              {title}
            </span>
            {description ? (
              <span className="truncate text-[11px] text-muted-foreground">{description}</span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Copy prompt to clipboard"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
              <span className="text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Copy prompt</span>
            </>
          )}
        </button>
      </div>

      {/* Prompt body — verbatim, wrapped, scrollable */}
      <div className="overflow-x-auto bg-background/50 p-4">
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
          <code>{prompt}</code>
        </pre>
      </div>

      {/* Frame footer */}
      <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileCode2 className="size-3" aria-hidden="true" /> Coding-agent prompt
        </span>
        <span className="tabular-nums">{prompt.length.toLocaleString()} characters</span>
      </div>
    </div>
  );
}
