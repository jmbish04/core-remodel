/**
 * @fileoverview Per-line-item material-linking control for the HITL inbox.
 *
 * Resolves one invoice/receipt line item against the materials schedule:
 *   - search + link to an existing material_schedule_item
 *   - create a new material from the line item
 *   - skip (not a trackable material)
 *
 * Linking marks the material purchased server-side (see the worker-emails
 * /line-items endpoints). Read/writes go through /api/worker-emails and
 * /api/materials (both credentialed, admin-gated).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Link2, Loader2, Plus, SearchIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LineItem {
  id: number;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  matchStatus: string;
  materialScheduleItemId: number | null;
}

interface MaterialOption {
  id: number;
  title: string;
  roomName: string | null;
  isPurchased: boolean | null;
}

const RESOLVED = new Set(["matched", "created"]);

export function LineItemMaterialLink({
  emailId,
  invoiceId,
  lineItem,
  onUpdate,
}: {
  emailId: number;
  invoiceId: number;
  lineItem: LineItem;
  onUpdate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MaterialOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isResolved = RESOLVED.has(lineItem.matchStatus);
  const isSkipped = lineItem.matchStatus === "skipped";

  // Debounced search against the materials schedule.
  useEffect(() => {
    if (!picking) return;
    // `active` guards against a slow earlier request resolving after a faster
    // later one (stale results) and against setState after unmount.
    let active = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = query.trim()
          ? `/api/materials?search=${encodeURIComponent(query.trim())}`
          : "/api/materials";
        const res = await fetch(url, { credentials: "include" });
        const json = (await res.json()) as { materials?: MaterialOption[] };
        if (active) setResults((json.materials ?? []).slice(0, 8));
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, picking]);

  const post = useCallback(
    async (path: string, body?: unknown, method: "POST" | "PATCH" = "POST") => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/worker-emails/${emailId}/invoices/${invoiceId}/line-items/${lineItem.id}/${path}`,
          {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            credentials: "include",
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Request failed (${res.status})`);
        }
        setPicking(false);
        onUpdate();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(false);
      }
    },
    [emailId, invoiceId, lineItem.id, onUpdate],
  );

  // ── Resolved / skipped state ───────────────────────────────────────────────
  if (isResolved) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <Badge className="gap-1 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
          <Check className="size-3" />
          {lineItem.matchStatus === "created" ? "Material created" : "Linked to material"}
          {lineItem.materialScheduleItemId ? ` #${lineItem.materialScheduleItemId}` : ""}
        </Badge>
        <span className="text-muted-foreground">· marked purchased</span>
      </div>
    );
  }

  if (isSkipped && !picking) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <Badge variant="outline" className="text-muted-foreground">
          Skipped
        </Badge>
        <button
          type="button"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setPicking(true)}
        >
          link anyway
        </button>
      </div>
    );
  }

  // ── Unmatched: closed → show the resolve trigger ──────────────────────────
  if (!picking) {
    return (
      <div className="mt-1.5 flex items-center gap-2">
        <Badge className="gap-1 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 text-[10px]">
          Pending material link
        </Badge>
        <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setPicking(true)}>
          <Link2 className="size-3.5" />
          Resolve
        </Button>
      </div>
    );
  }

  // ── Unmatched: open picker ────────────────────────────────────────────────
  return (
    <div className="mt-2 rounded-md bg-muted/30 p-2.5 ring-1 ring-border/40">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          Link “{lineItem.description ?? "item"}” to a material
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setPicking(false)}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search materials schedule…"
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto">
        {searching ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Searching…
          </div>
        ) : results.length > 0 ? (
          results.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => post("link", { materialScheduleItemId: m.id }, "PATCH")}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/5 disabled:opacity-50"
            >
              <span className="min-w-0 truncate">
                <span className="text-foreground">{m.title}</span>
                {m.roomName ? (
                  <span className="ml-2 text-xs text-muted-foreground">{m.roomName}</span>
                ) : null}
              </span>
              {m.isPurchased ? (
                <span className="shrink-0 text-[10px] text-emerald-400">purchased</span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No matching materials.
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={busy}
          onClick={() =>
            post("create-material", {
              title: lineItem.description ?? "Untitled material",
            })
          }
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Create new material
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground"
          disabled={busy}
          onClick={() => post("skip")}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}
