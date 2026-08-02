#!/usr/bin/env node
/**
 * QC for PR #336 — 0042 P4: showroom pending-quote panel.
 * Run: node scripts/qc/pr_336.mjs --preview   or bare (prod, regression)
 *
 * New surface: GET /api/showroom-stores/:id/pending-quotes (draft quotes
 * resolved to a store). Regression: GET /api/alerts still returns the
 * aggregated feed and its invoice_review rows carry a route string.
 */
import { accessCookie, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();
const cookie = accessCookie();
console.log(`QC 0042 P4 pending-quotes against ${BASE}\n`);

try {
  // ── Regression: alerts aggregator still works (exists on prod) ────────────
  const alerts = await c.req("GET", "/api/alerts", { headers: { cookie } });
  check("GET /api/alerts 200", alerts.status === 200, `status=${alerts.status}`);
  const feed = alerts.json?.alerts ?? [];
  check("alerts payload has counts + array", Array.isArray(feed) && !!alerts.json?.counts, "shape");
  const invoiceAlerts = feed.filter((a) => a.kind === "invoice_review");
  check(
    "every invoice_review alert carries a route string",
    invoiceAlerts.every((a) => typeof a.route === "string" && a.route.length > 0),
    `n=${invoiceAlerts.length}`,
  );
  // When a quote resolved to a store, its alert deep-links into the viewport.
  const scoped = invoiceAlerts.filter((a) => /\/admin\/shopping\/store\/\d+\//.test(a.route));
  info(`invoice_review alerts: ${invoiceAlerts.length} (store-scoped: ${scoped.length})`);

  // ── New endpoint: pending-quotes for a real store ─────────────────────────
  const stores = await c.req("GET", "/api/showroom-stores?limit=1", { headers: { cookie } });
  const first = (stores.json?.stores ?? stores.json?.data ?? stores.json ?? [])[0];
  const storeId = first?.id;
  if (!storeId) {
    info("no store to probe pending-quotes against — skipping endpoint shape check.");
    finish();
  }

  const pq = await c.req("GET", `/api/showroom-stores/${storeId}/pending-quotes`, {
    headers: { cookie },
  });
  if (pq.status === 404) {
    console.log(`\n⚠️  /pending-quotes 404 on ${BASE} — endpoint pending merge/deploy.\n`);
    finish();
  }
  check(`GET /:id/pending-quotes 200 (store ${storeId})`, pq.status === 200, `status=${pq.status}`);
  const quotes = pq.json?.quotes;
  check("response is { quotes: [...] }", Array.isArray(quotes), typeof quotes);
  if (Array.isArray(quotes) && quotes.length > 0) {
    const q = quotes[0];
    check(
      "quote row shape (id/kind/status/lineItems[])",
      typeof q.id === "number" && typeof q.kind === "string" && Array.isArray(q.lineItems),
      JSON.stringify(Object.keys(q)),
    );
    check("only draft quotes returned", quotes.every((x) => x.status === "draft"), "non-draft leaked");
  } else {
    info("store has no pending quotes — empty array is the correct healthy state.");
  }

  // Bad id → 400, not a 500.
  const bad = await c.req("GET", "/api/showroom-stores/not-a-number/pending-quotes", {
    headers: { cookie },
  });
  check("invalid store id → 400", bad.status === 400, `status=${bad.status}`);
} catch (err) {
  check("QC ran without throwing", false, String(err?.stack || err));
}

finish();
