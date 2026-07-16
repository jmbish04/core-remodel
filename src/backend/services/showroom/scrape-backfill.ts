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
 * Stores kicked per tick. Browser Rendering crawls up to MAX_PAGES per store and
 * is concurrency-limited, so this stays deliberately small — the cron runs every
 * minute, which drains ~130 stores in under an hour without a thundering herd.
 */
const BATCH = 3;

export async function reScrapeStaleShowrooms(
  env: Env,
): Promise<{ kicked: number; remaining: number }> {
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
