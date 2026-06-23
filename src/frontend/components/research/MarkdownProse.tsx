/**
 * @fileoverview Render markdown with shadcn-style typography.
 *
 * The repo doesn't ship the @tailwindcss/typography plugin, so `prose` classes
 * are no-ops. Instead we map each markdown element to a Tailwind-styled
 * component (the shadcn "Typography" approach) for clean, dark-Monolith reading.
 * Used for the research document and the plan markdown.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-3 scroll-m-20 text-2xl font-bold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 scroll-m-20 border-b border-border/40 pb-1.5 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 scroll-m-20 text-base font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 scroll-m-20 text-sm font-semibold tracking-tight text-foreground">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="leading-7 text-foreground/80 [&:not(:first-child)]:mt-4">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-sky-400 underline-offset-4 hover:underline"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-4 ml-5 list-disc space-y-1.5 text-foreground/80">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 ml-5 list-decimal space-y-1.5 text-foreground/80">{children}</ol>,
  li: ({ children }) => <li className="leading-7 pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border/40" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return <code className={cn("font-mono text-[0.85em] text-foreground/90", className)}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/90">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-muted/40 p-4 ring-1 ring-border/40">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg ring-1 ring-border/40">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/80">{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-4 rounded-lg ring-1 ring-border/40" />
  ),
};

export function MarkdownProse({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
