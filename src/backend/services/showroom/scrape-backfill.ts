/**
 * @fileoverview Self-healing re-scrape for showrooms whose website scrape never
 * ran or failed.
 *
 * Why this exists: `scrapeUrl` read `result.html` while Browser Rendering returns
 * the page under `result.content`, so every scrape captured an EMPTY page —
 * silently. 57 stores were marked "complete" having stored nothing but a
 * screenshot (no brands, no socials, no hours text, empty RAG corpus,
 * accessLevel stuck UNKNOWN), and 73 more were never scraped at all.
 *
 * With the scraper fixed, this cron drains the backlog: any store that has a
 * WEBSITE link and an `idle`/`failed` scrape gets its workflow kicked. Kicking
 * flips the store to `pending`, so a store is never picked twice — that also
 * means a genuinely content-free site can't put us in a re-scrape loop (it ends
 * at complete/failed and stays there).
 *
 * To replay the "complete but captured nothing" victims, reset them once:
 *   UPDATE showroom_stores SET scrape_status='idle' WHERE id IN (...)
 * and this drains them on the next ticks.
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { showroomStoreLinks, showroomStores } from "@backend/db/schema/showroom/index";

import { kickShowroomScrape } from "./onboarding";

/**
 * KILL SWITCH — the bulk backfill is OFF unless `SHOWROOM_SCRAPE_BACKFILL_ENABLED`
 * is explicitly true (see wrangler.jsonc `vars`).
 *
 * This drain was written while every scrape no-op'd on a blank page in
 * milliseconds and cost ~nothing. Fixing the scraper (see `scrapeUrl`:
 * gotoOptions/waitUntil) turned each store into up to MAX_PAGES REAL browser
 * renders plus Workers AI extraction plus Vectorize embedding — so the same
 * "3 per minute" that was free is now genuinely expensive, and it stacked 54
 * scrapes in flight before anyone had verified a single store end-to-end.
 *
 * Leave it off until ONE store has been verified start-to-finish (real markdown,
 * socials, favicon, brands, accessLevel). Then re-enable deliberately — ideally
 * after the Browser-Run-budget queue lands, since Browser Run's real ceiling is
 * 10 req/s and 120 concurrent browsers ACCOUNT-WIDE, shared with brand-research
 * and product-research.
 *
 * Single stores can still be scraped on demand via
 * `POST /api/showroom-stores/:id/scrape` — that path is unaffected by this flag.
 *
 * Accepts BOTH a real boolean and the string "true": wrangler.jsonc vars are JSON
 * so they can be a genuine `true`, but the dashboard and `.dev.vars` can only ever
 * produce strings. Handling one and not the other is how a flag ends up enabled on
 * one surface and silently disabled on another. Anything else — absent, "false",
 * "", 0, junk — is OFF. Fail-safe by construction: this drain never runs by
 * accident, only by decision.
 */
function isBackfillEnabled(env: Env): boolean {
  const flag = (env as { SHOWROOM_SCRAPE_BACKFILL_ENABLED?: unknown })
    .SHOWROOM_SCRAPE_BACKFILL_ENABLED;
  if (typeof flag === "boolean") return flag;
  if (typeof flag === "string") return flag.trim().toLowerCase() === "true";
  return false;
}

/** Stores kicked per tick, when enabled. */
const BATCH = 3;

export async function reScrapeStaleShowrooms(
  env: Env,
): Promise<{ kicked: number; remaining: number }> {
  if (!isBackfillEnabled(env)) return { kicked: 0, remaining: -1 };

  const db = drizzle(env.DB);

  // Candidates: a WEBSITE link to crawl + a scrape that never ran or failed.
  const candidates = await db
    .select({ id: showroomStores.id, url: showroomStoreLinks.url })
    .from(showroomStores)
    .innerJoin(
      showroomStoreLinks,
      and(
        eq(showroomStoreLinks.storeId, showroomStores.id),
        eq(showroomStoreLinks.type, "WEBSITE"),
      ),
    )
    .where(inArray(showroomStores.scrapeStatus, ["idle", "failed"]))
    .limit(BATCH + 1)
    .all();

  const batch = candidates.slice(0, BATCH);
  if (batch.length === 0) return { kicked: 0, remaining: 0 };

  let kicked = 0;
  for (const store of batch) {
    try {
      // kickShowroomScrape sets scrape_status='pending' + a fresh ragUuid, which
      // is what removes it from this query's candidate set on the next tick.
      await kickShowroomScrape(env, store.id, store.url);
      kicked++;
    } catch (err) {
      console.error(`[scrape-backfill] kick failed for showroom ${store.id}:`, err);
    }
  }

  return { kicked, remaining: Math.max(0, candidates.length - batch.length) };
}
