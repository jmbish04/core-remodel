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
