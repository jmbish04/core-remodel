/**
 * @fileoverview `apiChanges[]` rendered as REST API documentation.
 *
 * Entries are authored as free text — `"POST /api/changelog/proposals — upsert
 * by slug"` — and were previously rendered as an undifferentiated bullet list,
 * which buries the two things a reader is scanning for: the verb and the path.
 *
 * This parses the conventional `METHOD /path — description` shape into a proper
 * documentation row with a color-coded method chip. A line that does not match
 * (a prose note about the API rather than an endpoint) is passed through
 * unchanged rather than being dropped or mangled into a fake endpoint.
 *
 * No hydration: this is presentational, so Astro renders it server-side.
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];

/**
 * Method → chip color. Follows the convention every REST doc uses, so the
 * meaning is readable without a legend: green reads, blue writes, amber
 * mutations, red deletions.
 */
const METHOD_STYLE: Record<Method, string> = {
  GET: "bg-emerald-500/12 text-emerald-300 ring-emerald-500/25",
  POST: "bg-sky-500/12 text-sky-300 ring-sky-500/25",
  PUT: "bg-violet-500/12 text-violet-300 ring-violet-500/25",
  PATCH: "bg-amber-500/12 text-amber-300 ring-amber-500/25",
  DELETE: "bg-rose-500/12 text-rose-300 ring-rose-500/25",
  HEAD: "bg-muted text-muted-foreground ring-border/40",
  OPTIONS: "bg-muted text-muted-foreground ring-border/40",
};

interface ParsedEndpoint {
  method: Method | null;
  path: string;
  description: string;
}

/**
 * `"GET /api/foo — does bar"` → its parts.
 *
 * The separator is whichever of em dash / en dash / hyphen-with-spaces / colon
 * appears FIRST after the path, because paths themselves contain hyphens
 * (`/api/mcp-ops`) and splitting on a bare hyphen would cut them in half.
 */
export function parseEndpoint(line: string): ParsedEndpoint {
  const trimmed = line.trim();
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s*(.*)$/i.exec(trimmed);
  if (!match) return { method: null, path: "", description: trimmed };

  const [, rawMethod, path, rest] = match;
  const description = rest.replace(/^\s*(?:[—–]|-\s|:)\s*/, "").trim();
  return { method: rawMethod.toUpperCase() as Method, path, description };
}

export function ApiEndpoints({ changes }: { changes: string[] }) {
  if (changes.length === 0) return null;

  const parsed = changes.map(parseEndpoint);
  const endpoints = parsed.filter((p) => p.method !== null);
  const notes = parsed.filter((p) => p.method === null);

  return (
    <div className="space-y-3">
      {endpoints.length > 0 ? (
        <div className="divide-y divide-border/40 overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          {endpoints.map((e) => (
            <div
              key={`${e.method} ${e.path}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
            >
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ring-1 ${
                  METHOD_STYLE[e.method as Method]
                }`}
              >
                {e.method}
              </span>
              <code className="font-mono text-xs text-foreground">{e.path}</code>
              {e.description ? (
                <span className="min-w-[12rem] flex-1 text-xs leading-relaxed text-muted-foreground">
                  {e.description}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.description} className="text-xs leading-relaxed text-muted-foreground">
              {n.description}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
