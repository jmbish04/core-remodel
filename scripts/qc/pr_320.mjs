#!/usr/bin/env node
/**
 * QC for the Vendor Guest Portal — PR #320 (0043 P0+P1+P2).
 * Run: node scripts/qc/pr_320.mjs --preview   (or bare for prod)
 *
 * Covers the guest identity API + the security boundary:
 *   1. GET /api/guest/me with no cookie → { guest: null }
 *   2. POST /api/guest/register with missing fields → 400
 *   3. POST /api/guest/register valid → 200, sets remodel_guest cookie, never echoes cookieId
 *   4. reuse the cookie → GET /api/guest/me returns the same guest
 *   5. re-register the SAME email (returning guest) → 200, same id, NO error (silent pass-through)
 *   6. SECURITY: the guest cookie must NOT satisfy homeowner auth — a homeowner
 *      endpoint still returns 401 when presented the remodel_guest cookie.
 *
 * Page rendering (chrome-less shell + registration wall via ?_portal=1) is verified in-browser.
 */
import { execFileSync } from "node:child_process";
import { createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const { ok: check, info, summary } = createChecks();
const EMAIL = "qc-guest-portal@example.test";
console.log(`QC guest-portal P1 against ${BASE}\n`);

function d1(sql) {
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "core-remodel", "--remote", "--command", sql],
      { encoding: "utf8", stdio: "pipe" },
    );
  } catch {
    /* cleanup is best-effort */
  }
}

function setCookieValue(res, name) {
  // Node fetch exposes multiple Set-Cookie via getSetCookie().
  const all = res.headers.getSetCookie?.() ?? [];
  for (const c of all) {
    const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

async function req(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { res, status: res.status, json, text };
}

async function run() {
  // Clean any prior test row so the "new guest" path is exercised.
  d1(`DELETE FROM guest_contacts WHERE email = '${EMAIL}';`);

  // 1. No cookie → null guest.
  const me0 = await req("GET", "/api/guest/me");
  check("GET /me anonymous → guest null", me0.status === 200 && me0.json?.guest === null, `status=${me0.status} guest=${JSON.stringify(me0.json?.guest)}`);

  // 2. Invalid registration → 400.
  const bad = await req("POST", "/api/guest/register", { body: { firstName: "", email: "nope" } });
  check("register invalid → 400", bad.status === 400, `status=${bad.status}`);

  // 2b. A non-http(s) company URL (e.g. javascript:) must be rejected (stored-XSS guard).
  const badUrl = await req("POST", "/api/guest/register", {
    body: { firstName: "X", lastName: "Y", email: "qc-badurl@example.test", phone: "5", companyWebsiteUrl: "javascript:alert(1)" },
  });
  check("register rejects non-http(s) website → 400", badUrl.status === 400, `status=${badUrl.status}`);

  // 3. Valid registration → 200 + cookie, no cookieId echoed.
  const reg = await req("POST", "/api/guest/register", {
    body: { firstName: "QC", lastName: "Vendor", email: EMAIL, phone: "555-0100", companyWebsiteUrl: "https://example.test" },
  });
  check("register valid → 200 + success", reg.status === 200 && reg.json?.success === true, `status=${reg.status} ${reg.text?.slice(0, 120)}`);
  check("register does not echo cookieId", reg.json?.guest && !("cookieId" in reg.json.guest), `keys=${Object.keys(reg.json?.guest || {}).join(",")}`);
  const guestCookie = setCookieValue(reg.res, "remodel_guest");
  check("register sets remodel_guest cookie", !!guestCookie, `cookie=${guestCookie ? "present" : "missing"}`);
  const firstId = reg.json?.guest?.id;

  // 4. Reuse cookie → /me returns the same guest.
  if (guestCookie) {
    const me1 = await req("GET", "/api/guest/me", { cookie: guestCookie });
    check("GET /me with cookie → same guest", me1.status === 200 && me1.json?.guest?.id === firstId, `id=${me1.json?.guest?.id} expected=${firstId}`);
  }

  // 5. Returning guest (same email) → 200, same id, no error.
  const reg2 = await req("POST", "/api/guest/register", {
    body: { firstName: "QC2", lastName: "Vendor", email: EMAIL, phone: "555-0100", companyWebsiteUrl: "https://example.test" },
  });
  check("re-register same email → 200 (silent pass-through)", reg2.status === 200 && reg2.json?.success === true, `status=${reg2.status}`);
  check("re-register keeps the same guest id (upsert, not duplicate)", reg2.json?.guest?.id === firstId, `id=${reg2.json?.guest?.id} expected=${firstId}`);

  // 6. SECURITY: guest cookie must NOT unlock a homeowner endpoint.
  if (guestCookie) {
    const priv = await req("GET", "/api/budget-tracker/overview", { cookie: guestCookie });
    check("guest cookie is NOT homeowner auth (401 on homeowner endpoint)", priv.status === 401, `status=${priv.status}`);
  }

  info(`test guest id=${firstId}`);
  d1(`DELETE FROM guest_contacts WHERE email = '${EMAIL}';`);
}

try {
  await run();
} catch (err) {
  console.error("QC crashed:", err instanceof Error ? err.message : err);
  d1(`DELETE FROM guest_contacts WHERE email = '${EMAIL}';`);
  process.exit(1);
}

process.exit(summary().failed === 0 ? 0 : 1);
