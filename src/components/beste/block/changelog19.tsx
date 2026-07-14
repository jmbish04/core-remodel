"use client";

import { Badge } from "src/frontend/components/ui/badge";
import { cn } from "src/frontend/lib/utils";

interface CodeBlock {
  title?: string;
  code: string;
}

interface ReleaseEntry {
  version: string;
  date: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading: string;
  description?: string;
  codeBlock?: CodeBlock;
  changes?: string[];
}

interface Changelog19Props {
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  entries?: ReleaseEntry[];
  className?: string;
}

export const changelog19Demo: Changelog19Props = {
  badge: { label: "API Changelog", variant: "secondary" },
  heading: "Developer Changelog",
  description: "Breaking changes, new endpoints, and migration guides.",
  entries: [
    {
      version: "v3.0.0",
      date: "March 2025",
      badge: { label: "Breaking", variant: "default" },
      heading: "New Authentication Model",
      description:
        "We have replaced API key authentication with short-lived tokens and refresh flows. All existing API keys will continue to work until June 2025, but we strongly recommend migrating to the new model for improved security and granular scoping.",
      codeBlock: {
        title: "Migration example",
        code: `// Before (v2.x)
const client = createClient({
  apiKey: "sk_live_..."
});

// After (v3.0)
const client = createClient({
  token: await getToken({
    clientId: "cl_...",
    clientSecret: "cs_...",
    scopes: ["read", "write"]
  })
});`,
      },
      changes: [
        "API keys deprecated in favor of OAuth2 tokens",
        "New /auth/token endpoint for token exchange",
        "Scoped permissions per token",
        "Refresh token rotation with 7-day expiry",
      ],
    },
    {
      version: "v2.12.0",
      date: "February 2025",
      badge: { label: "Feature", variant: "secondary" },
      heading: "Batch Operations Endpoint",
      description:
        "Process up to 1,000 operations in a single request with transaction-safe batch endpoints. Supports creates, updates, and deletes with atomic rollback on failure.",
      codeBlock: {
        title: "Usage",
        code: `const result = await client.batch({
  operations: [
    { method: "POST", path: "/users", body: { name: "Alice" } },
    { method: "PATCH", path: "/users/42", body: { role: "admin" } },
    { method: "DELETE", path: "/users/17" }
  ],
  atomic: true
});

// result.results: [{ status: 201 }, { status: 200 }, { status: 204 }]`,
      },
      changes: [
        "New POST /batch endpoint",
        "Atomic mode with full rollback on error",
        "Up to 1,000 operations per request",
        "Mixed HTTP methods in a single batch",
      ],
    },
    {
      version: "v2.11.0",
      date: "January 2025",
      badge: { label: "Feature", variant: "secondary" },
      heading: "Server-Sent Events for Resources",
      description:
        "Subscribe to real-time changes on any resource collection using Server-Sent Events. No more polling — get instant updates pushed to your client as they happen.",
      codeBlock: {
        title: "Example",
        code: `const stream = client.subscribe("/users", {
  events: ["created", "updated", "deleted"]
});

stream.on("created", (user) => {
  console.log("New user:", user.name);
});

stream.on("error", (err) => {
  console.error("Stream error:", err.message);
});`,
      },
      changes: [
        "SSE support on all resource endpoints",
        "Event filtering by type",
        "Automatic reconnection with last-event-id",
        "Backpressure handling for high-throughput streams",
      ],
    },
  ],
};

export function Changelog19({
  badge,
  heading,
  description,
  entries = [],
  className,
}: Changelog19Props) {
  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        {(badge || heading || description) && (
          <div className="mb-12">
            {badge && (
              <div className="mb-4">
                <Badge variant={badge.variant ?? "secondary"}>
                  {badge.label}
                </Badge>
              </div>
            )}
            {heading && (
              <h2 className="text-2xl font-semibold tracking-tight md:text-4xl">
                {heading}
              </h2>
            )}
            {description && (
              <p className="mt-4 text-base text-muted-foreground md:text-lg">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="space-y-0">
          {entries.map((entry, index) => (
            <article
              key={index}
              className={cn("pb-12", index > 0 && "border-t pt-12")}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {entry.version}
                </span>
                {entry.badge && (
                  <Badge variant={entry.badge.variant ?? "secondary"}>
                    {entry.badge.label}
                  </Badge>
                )}
              </div>
              <p className="mb-3 text-xs text-muted-foreground/60">
                {entry.date}
              </p>

              <h3 className="text-lg font-semibold">{entry.heading}</h3>

              {entry.description && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              )}

              {entry.codeBlock && (
                <div className="mt-5 overflow-hidden rounded-md border">
                  {entry.codeBlock.title && (
                    <div className="border-b bg-muted/60 px-4 py-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {entry.codeBlock.title}
                      </p>
                    </div>
                  )}
                  <pre className="overflow-x-auto bg-muted/30 p-4">
                    <code className="text-xs leading-relaxed">
                      {entry.codeBlock.code}
                    </code>
                  </pre>
                </div>
              )}

              {entry.changes && entry.changes.length > 0 && (
                <ul className="mt-5 space-y-1.5">
                  {entry.changes.map((change, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-foreground/80"
                    >
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                      {change}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
