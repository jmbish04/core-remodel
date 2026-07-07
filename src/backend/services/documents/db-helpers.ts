/**
 * Shared D1 query helpers for the Documents system routers.
 *
 * Two Cloudflare-D1 realities live here so the routers don't re-learn them:
 * - D1 caps a single query at 100 bound parameters, so any `inArray` over a
 *   caller-controlled id list must be chunked (`selectDocumentsByIds`).
 * - SQLite's `LIKE` has no default escape character, so escaping `%`/`_` in a
 *   search term does nothing unless the query declares `ESCAPE` explicitly
 *   (`likeEscaped`).
 */

import { inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { supportingDocuments } from "@backend/db";

/** D1's hard limit on bound parameters per statement. */
const D1_MAX_BOUND_PARAMS = 100;

/**
 * Fetch supporting_documents rows for an arbitrary-length id list, chunked to
 * respect D1's 100-bound-parameter limit. Order of the returned rows follows
 * chunk order, not the input order — callers that care re-sort.
 */
export async function selectDocumentsByIds(
  db: ReturnType<typeof drizzle>,
  ids: string[],
): Promise<(typeof supportingDocuments.$inferSelect)[]> {
  const rows: (typeof supportingDocuments.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
    const chunk = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
    const chunkRows = await db
      .select()
      .from(supportingDocuments)
      .where(inArray(supportingDocuments.id, chunk))
      .all();
    rows.push(...chunkRows);
  }
  return rows;
}

/**
 * Escape a raw search term for use inside a LIKE pattern built with
 * `likeEscaped` (backslash-escapes `%`, `_`, and `\` itself).
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * `column LIKE pattern ESCAPE '\'` — SQLite ignores backslash escapes in LIKE
 * unless the ESCAPE clause is declared, which drizzle's `like()` cannot emit.
 */
export function likeEscaped(column: SQLWrapper, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
