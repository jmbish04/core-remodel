/**
 * @fileoverview Provider registry — what each metered provider IS, in human terms.
 *
 * `METERED_PROVIDERS` is a flat list of SCREAMING_SNAKE enum values, which is
 * right for a database column and wrong for a page a person reads. Rendering
 * `CF_IMAGES` to a human is a leaked implementation detail, and listing a
 * Cloudflare binding beside a model vendor beside a maps API implies they are
 * the same kind of thing with the same failure modes. They are not.
 *
 * One source of truth, shared by the API and the UI, so a label can never drift
 * between the two.
 */

/** How a provider is billed and reasoned about. Drives the table grouping. */
export const PROVIDER_GROUPS = [
  "cloudflare-bindings",
  "ai-providers",
  "integrations",
] as const;
export type ProviderGroup = (typeof PROVIDER_GROUPS)[number];

export const GROUP_META: Record<ProviderGroup, { label: string; blurb: string; order: number }> = {
  "ai-providers": {
    label: "AI Providers",
    blurb: "Token-billed model vendors — where the money actually goes",
    order: 1,
  },
  "cloudflare-bindings": {
    label: "Cloudflare Bindings",
    blurb: "Platform primitives billed per request, image or vector",
    order: 2,
  },
  integrations: {
    label: "Integrations",
    blurb: "Third-party APIs with their own quotas",
    order: 3,
  },
};

export interface ProviderDef {
  /** The enum value stored in `gemini_usage_log.provider`. */
  id: string;
  /** What a person should read. */
  label: string;
  /** Compact label for narrow columns. */
  short: string;
  group: ProviderGroup;
  /** Billing unit, so the table never implies token pricing for an image API. */
  unit: "tokens" | "requests" | "images" | "vectors" | "duration";
  /** Whether prices for this provider come from the weekly catalog. */
  priced: boolean;
}

/**
 * Every provider that can appear in the usage ledger.
 *
 * OPENAI and ANTHROPIC are declared here before anything writes them: the price
 * catalog fetches their rates weekly, and a provider with prices but no
 * registry entry would render as a raw enum the day it is first used.
 */
export const PROVIDERS: ProviderDef[] = [
  // ── AI providers ───────────────────────────────────────────────────────────
  { id: "WORKERS_AI", label: "Workers AI", short: "Workers AI", group: "ai-providers", unit: "tokens", priced: true },
  { id: "GEMINI", label: "Google Gemini", short: "Gemini", group: "ai-providers", unit: "tokens", priced: true },
  { id: "OPENAI", label: "OpenAI", short: "OpenAI", group: "ai-providers", unit: "tokens", priced: true },
  { id: "ANTHROPIC", label: "Anthropic Claude", short: "Claude", group: "ai-providers", unit: "tokens", priced: true },

  // ── Cloudflare bindings ────────────────────────────────────────────────────
  {
    id: "BROWSER_RENDERING",
    label: "Browser Rendering",
    short: "Browser",
    group: "cloudflare-bindings",
    unit: "requests",
    priced: false,
  },
  { id: "CF_IMAGES", label: "Cloudflare Images", short: "Images", group: "cloudflare-bindings", unit: "images", priced: false },
  { id: "VECTORIZE", label: "Vectorize", short: "Vectorize", group: "cloudflare-bindings", unit: "vectors", priced: false },
  {
    id: "DURABLE_OBJECT",
    label: "Durable Objects",
    short: "Durable Objects",
    group: "cloudflare-bindings",
    unit: "duration",
    priced: false,
  },

  // ── Integrations ───────────────────────────────────────────────────────────
  { id: "GOOGLE_PLACES", label: "Google Places", short: "Places", group: "integrations", unit: "requests", priced: false },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/**
 * Look up a provider.
 *
 * An unknown id still renders — as a title-cased version of itself in the
 * Integrations group — rather than vanishing. A provider that starts appearing
 * in the ledger before someone adds it here must be visible, not silently
 * dropped from the spend table.
 */
export function providerDef(id: string): ProviderDef {
  const known = BY_ID.get(id);
  if (known) return known;
  return {
    id,
    label: id
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    short: id,
    group: "integrations",
    unit: "requests",
    priced: false,
  };
}

export function providerLabel(id: string): string {
  return providerDef(id).label;
}

/** Groups in display order, each with its providers. */
export function groupedProviders(): Array<{ group: ProviderGroup; label: string; blurb: string; providers: ProviderDef[] }> {
  return PROVIDER_GROUPS.map((g) => ({
    group: g,
    label: GROUP_META[g].label,
    blurb: GROUP_META[g].blurb,
    providers: PROVIDERS.filter((p) => p.group === g),
  })).sort((a, b) => GROUP_META[a.group].order - GROUP_META[b.group].order);
}

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * Per-provider health, derived from the ledger rather than asserted.
 *
 * OFFLINE means NO TRAFFIC in the window — which is not the same as "down". An
 * idle provider rendered in red would train people to ignore the colour, so it
 * is styled neutrally and the tooltip says why.
 */
export const PROVIDER_HEALTH = ["SUCCESS", "PARTIAL", "FAILURE", "OFFLINE"] as const;
export type ProviderHealth = (typeof PROVIDER_HEALTH)[number];

export function healthFrom(calls: number, errors: number): ProviderHealth {
  if (calls === 0) return "OFFLINE";
  if (errors === 0) return "SUCCESS";
  if (errors >= calls) return "FAILURE";
  return "PARTIAL";
}
