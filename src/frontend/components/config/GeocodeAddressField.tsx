/**
 * @fileoverview Address field that resolves to coordinates (0032 C1).
 *
 * A text input with Google Places typeahead (via the `/api/places` proxy):
 * type → pick a suggestion → the parent gets the label + lat/lng. Reused by the
 * Tesla config Home & Work cards so home/work addresses become the coordinates
 * the park detector (L1) compares against. Never geocodes on its own — the
 * parent owns the value; this only surfaces suggestions and resolved coords.
 *
 * Async safety: every autocomplete request is sequenced (a slow earlier response
 * can't overwrite a newer one) and aborted on cleanup; no state is set after
 * unmount; a resolve failure is surfaced rather than silently leaving an address
 * with no coordinates.
 */
import { Loader2, MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Suggestion {
  placeId: string;
  text: string;
}

/** Result returned when a Places suggestion resolves to coordinates. */
export interface GeocodeResult {
  address: string;
  latitude: number;
  longitude: number;
}

export function GeocodeAddressField({
  value,
  latitude,
  longitude,
  onTextChange,
  onResolved,
  placeholder = "Start typing an address…",
}: {
  value: string;
  latitude: number | null;
  longitude: number | null;
  /** Free-text edits (before a suggestion is chosen). */
  onTextChange: (text: string) => void;
  /** A suggestion was picked and its coordinates resolved. */
  onResolved: (result: GeocodeResult) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const sessionToken = useRef<string>(cryptoToken());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const reqSeq = useRef(0);
  const listboxId = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (debounce.current) clearTimeout(debounce.current);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  // Debounced, sequenced autocomplete as the user types.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!value || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    debounce.current = setTimeout(() => {
      void (async () => {
        const seq = ++reqSeq.current;
        setLoading(true);
        try {
          const res = await fetch(
            `/api/places/autocomplete?q=${encodeURIComponent(value)}&sessionToken=${sessionToken.current}`,
            { credentials: "include", signal: controller.signal },
          );
          if (!res.ok) return;
          const data = (await res.json()) as { suggestions?: Suggestion[] };
          // Ignore a stale response (a newer request started) or a post-unmount one.
          if (!alive.current || seq !== reqSeq.current) return;
          setSuggestions(data.suggestions ?? []);
          setOpen(true);
        } catch {
          // Aborted or network error — the user can still type a raw address.
        } finally {
          if (alive.current && seq === reqSeq.current) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      controller.abort();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [value]);

  async function pick(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    onTextChange(s.text);
    setResolving(true);
    try {
      const res = await fetch(
        `/api/places/details/${encodeURIComponent(s.placeId)}?sessionToken=${sessionToken.current}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`details ${res.status}`);
      const d = (await res.json()) as {
        latitude?: number | null;
        longitude?: number | null;
        location?: { latitude?: number | null; longitude?: number | null } | null;
        formattedAddress?: string | null;
      };
      const lat = d.latitude ?? d.location?.latitude ?? null;
      const lng = d.longitude ?? d.location?.longitude ?? null;
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        if (alive.current) onResolved({ address: d.formattedAddress ?? s.text, latitude: lat, longitude: lng });
      } else {
        toast.error("Couldn't resolve coordinates for that address — pick another.");
      }
      // Fresh session token for the next address (Google bills per session).
      sessionToken.current = cryptoToken();
    } catch {
      toast.error("Address lookup failed — coordinates not set.");
    } finally {
      if (alive.current) setResolving(false);
    }
  }

  const resolved = latitude != null && longitude != null;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => alive.current && setOpen(false), 150);
          }}
          placeholder={placeholder}
          className="pr-8"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          {loading || resolving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPin className={cn("size-4", resolved ? "text-emerald-400" : "text-muted-foreground/40")} />
          )}
        </div>
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {suggestions.map((s) => (
            <li key={s.placeId} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(s)}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {resolved && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </p>
      )}
    </div>
  );
}

/** A random session-token-ish string. Not crypto-critical — just groups keystrokes. */
function cryptoToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sess-${Date.now().toString(36)}`;
  }
}
