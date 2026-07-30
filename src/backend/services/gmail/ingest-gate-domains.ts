/**
 * @fileoverview Pure domain-matching logic for the Gmail ingest gate (0039).
 *
 * Deliberately dependency-free (no D1, no env, no `@backend/*` imports) so the
 * risk-bearing parsing/exclusion logic is unit-testable in isolation — see
 * `ingest-gate-domains.test.ts`. `ingest-gate.ts` re-exports these.
 */

/**
 * Domains that are OURS — never a match even though they're on every thread.
 * Matched by suffix (the address's domain equals or ends in one of these).
 */
export const EXCLUDED_DOMAINS = new Set<string>(["126colby.com", "hacolby.app"]);

/**
 * Personal addresses on PUBLIC providers we can't domain-exclude (excluding
 * `gmail.com` wholesale would drop every vendor on Gmail). Matched exactly.
 */
export const EXCLUDED_EXACT_ADDRESSES = new Set<string>([
  "jmbish04@gmail.com",
  "jasonowyong87@gmail.com",
]);

/**
 * Normalize a website URL (or bare host / full email) to a lowercased host:
 * strip scheme, `www.`, any path/query/fragment, a leading `mailto:`, and any
 * `local@` part. Returns null for anything that doesn't yield a host with a dot.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  host = host.replace(/^mailto:/, "");
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  host = host.split("/")[0].split("?")[0].split("#")[0]; // path/query/fragment
  host = host.split("@").pop() ?? host; // drop any local@ part
  host = host.replace(/^www\./, "");
  host = host.replace(/\.$/, "");
  if (!host.includes(".")) return null;
  return host;
}

/**
 * Is this a domain the gate is allowed to search on? False for our own domains
 * and for public providers (domain-searching a public provider fans out to the
 * whole mailbox). `publicProviders` is injected so this stays dependency-free.
 */
export function isGatedDomain(domain: string, publicProviders: ReadonlySet<string>): boolean {
  if (EXCLUDED_DOMAINS.has(domain)) return false;
  if (publicProviders.has(domain)) return false;
  return true;
}

/**
 * Is this sender US — our own domain or one of our personal addresses — and so
 * must NEVER be auto-registered as a vendor/showroom contact? (justin@126colby.com
 * sits on every vendor thread; without this it gets added as a "contact" under
 * whatever showroom the thread matched.) Matches `EXCLUDED_DOMAINS` by suffix and
 * `EXCLUDED_EXACT_ADDRESSES` exactly.
 */
export function isExcludedSender(email: string | null | undefined): boolean {
  if (!email) return false;
  // Sender may arrive as a raw `Name <addr>` header — pull the bracketed address
  // when present, else use the whole string. Then strip any stray angle bracket.
  const raw = email.trim().toLowerCase();
  const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).replace(/[<>]/g, "").trim();
  if (EXCLUDED_EXACT_ADDRESSES.has(addr)) return true;
  const domain = addr.split("@").pop();
  if (!domain) return false;
  for (const own of EXCLUDED_DOMAINS) {
    if (domain === own || domain.endsWith(`.${own}`)) return true;
  }
  return false;
}
