/**
 * @fileoverview Health probes for the Hono API surface itself.
 *
 * The module under test here is not a feature — it is the plumbing every feature
 * rides on: the route registry in src/backend/api/index.ts, the OpenAPI document
 * served at /openapi.json, the `remodel_access` cookie gate in
 * src/backend/utils/access.ts, and the ASSETS binding that serves the built Astro
 * frontend. When any of these break, the symptom is site-wide rather than local.
 *
 * NOTE: the Hono app is pulled in with a dynamic `import()` inside each probe.
 * src/backend/api/index.ts mounts routes/health.ts, which reaches back into the
 * health registry — a static import here would close that cycle at module-load
 * time. Deferring it to probe-run time keeps the graph acyclic and turns any
 * module-load throw into a reportable FAILURE instead of a dead worker.
 *
 * Cost discipline: no network egress. The OpenAPI probe dispatches one in-process
 * request through the app's own router; nothing leaves the isolate.
 */
import {
  defineProbe,
  degraded,
  failure,
  ok,
  readSecret,
  type HealthProbe,
} from "@backend/services/health/types";
import { requireAccessAuth } from "@backend/utils/access";

const FILE = "src/backend/api/health.ts";

/**
 * Fewer distinct mount prefixes than this means the MOUNTS table in
 * src/backend/api/index.ts did not fully load. It is a floor, not the exact
 * count, so adding or removing one router does not turn the probe red.
 */
const MOUNT_PREFIX_FLOOR = 60;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "api_worker_api_key_readable",
    displayName: "WORKER_API_KEY readable",
    description:
      "Reads WORKER_API_KEY out of the Secrets Store. The `remodel_access` cookie is the SHA-256 of this " +
      "value, so it is the root of the entire admin auth gate. The value itself is never logged.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "The secret resolves to a non-empty value, so `requireAccessAuth` can compute the expected cookie hash " +
      "and every /api/admin/* route (plus the ~40 other guarded prefixes mounted in src/backend/api/index.ts) " +
      "can authorize a request. The MCP OAuth consent screen can also issue the same cookie.",
    whatFailureMeans:
      "getAccessCookieHash returns an empty string, so no request can ever satisfy the gate: every authed route " +
      "rejects or 500s, the admin UI appears logged out and un-loginable, and the MCP consent screen cannot mint " +
      "a session. This is a total, site-wide admin outage with no partial degradation.",
    troubleshootingSteps:
      "1. Confirm the secret exists: `npx wrangler secrets-store secret list`, and confirm the name matches the " +
      "`secrets_store_secrets` binding for WORKER_API_KEY in wrangler.jsonc. " +
      "2. A binding declared for a secret that does not exist fails the DEPLOY with error 10182 — if the last " +
      "deploy failed, start there. 3. This binding is `remote: true` with NO local fallback, so a local " +
      "`wrangler dev` cannot verify it; QC must run against the deployed worker (`pnpm run test:pr <n>`). " +
      "4. After re-creating or rotating the secret, redeploy: `pnpm run deploy` from `main`. " +
      "5. Confirm the gate works: `curl -sI https://core-remodel.hacolby.workers.dev/api/admin/config` should be " +
      "401/403 without a cookie and 200 with one. 6. Never print the value — not in logs, PRs, or this probe.",
    devOpsPlaybook:
      "Page-worthy. Fix the secret, redeploy, then verify the newest entry is yours with " +
      "`npx wrangler deployments list | tail -20` and tail live traffic with `npx wrangler tail`. Rotating this " +
      "secret invalidates every issued `remodel_access` cookie, so expect every device to need re-authorization — " +
      "tell the user before rotating, not after.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const key = await readSecret(env.WORKER_API_KEY);
      if (!key) {
        return failure(
          'WORKER_API_KEY is unreadable or empty. The access-cookie hash resolves to "", so EVERY authed route ' +
            "is unreachable and the admin UI cannot be logged into. Check the secrets_store_secrets binding in " +
            "wrangler.jsonc and `npx wrangler secrets-store secret list`.",
        );
      }
      return ok(
        `WORKER_API_KEY resolved to a non-empty value (${key.length} chars; value not logged). The access-cookie ` +
          "gate can compute its hash.",
      );
    },
  }),

  defineProbe({
    name: "api_assets_binding",
    displayName: "ASSETS binding present",
    description:
      "Asserts the ASSETS fetcher is bound. The built Astro frontend is served through it — this Worker uses " +
      "Workers static assets, not Pages.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["assets"],
    whatSuccessMeans:
      "ASSETS is bound, so the Worker can serve the compiled Astro output: every admin page, every React island " +
      "bundle, and every static file. The API can be perfectly healthy and the site still be blank without this.",
    whatFailureMeans:
      "The API answers but the site does not render. Page requests fall through to whatever the router does with " +
      "an unmatched path, so users see a blank page or a JSON 404 where the UI should be, while /api/ping still " +
      "returns ok — which is exactly why a plain API ping is not a sufficient health check.",
    troubleshootingSteps:
      "1. Confirm the `assets` block in wrangler.jsonc names a `directory` that the build actually produces, and " +
      'declares `binding: "ASSETS"`. 2. Confirm the build ran: `pnpm run build` and check the output directory ' +
      "exists and is non-empty before deploying — `pnpm run deploy` runs build first for this reason. " +
      "3. Redeploy: `pnpm run deploy` from `main`. " +
      "4. Verify a real page loads: `curl -sI https://core-remodel.hacolby.workers.dev/admin/system/health`. " +
      "5. If pages 404 but the API works, this binding (or an empty assets directory) is the cause.",
    devOpsPlaybook:
      "Deploy fault. Never hand-patch the live worker; fix the config or the build, then `pnpm run deploy` and " +
      "confirm with `npx wrangler deployments list | tail -20`. Note that `pnpm run build` is esbuild and does NOT " +
      "type-check — a page that fails to render for a type reason will still have built cleanly, so check the " +
      "browser console before blaming this binding.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!env.ASSETS) {
        return failure(
          "ASSETS binding is absent. The built Astro frontend cannot be served — the API will answer while every " +
            "page renders blank. Check the `assets` block in wrangler.jsonc.",
        );
      }
      return ok("ASSETS fetcher is bound; the built Astro frontend can be served.");
    },
  }),

  defineProbe({
    name: "api_route_registry",
    displayName: "Hono route registry populated",
    description:
      "Imports src/backend/api/index.ts, then FORCES EVERY lazily-mounted router to import and merge " +
      `(loadAllMounts) and reports any that threw. Also asserts at least ${MOUNT_PREFIX_FLOOR} mount prefixes are ` +
      "dispatched, /api/ping is registered, and requireAccessAuth itself is registered on /api/admin/*.",
    healthTsFilepath: FILE,
    bindingTypesTested: [],
    whatSuccessMeans:
      "Every entry in the MOUNTS table imported and merged without throwing, the full complement of prefixes is " +
      "dispatched, and requireAccessAuth is registered on /api/admin/*. The API surface is intact and gated.",
    whatFailureMeans:
      "A router module threw at import (a bad top-level statement, a circular import, a missing export). Routers " +
      "are mounted LAZILY, so this no longer takes the whole app down loudly — it 500s only that one prefix, and " +
      "only once a request reaches it. That is precisely why this probe loads them all itself rather than counting " +
      "app.routes: the count cannot see a sub-router's routes any more, so it could never notice a broken one. " +
      "A missing auth middleware registration would mean admin routes are being served UNGATED.",
    troubleshootingSteps:
      "1. Read the details string — it reports the count and names what was missing. " +
      "2. Reproduce the import locally: `npx tsc --noEmit` catches missing exports that the esbuild build does not. " +
      "3. `npx wrangler tail` and hit any route; a module-load throw prints on every request with the offending file. " +
      "4. If a prefix is named as failing, import that router module directly — the message carries the throw. " +
      "If the prefix COUNT is low, diff the MOUNTS table in src/backend/api/index.ts against the routers under " +
      "src/backend/api/routes/ — a router that exists but is never mounted is a silent 404. " +
      "5. If an auth middleware line is missing, treat it as a security defect: fix and deploy before anything else. " +
      "6. Verify: `curl -s https://core-remodel.hacolby.workers.dev/api/ping`.",
    devOpsPlaybook:
      "Code defect. Fix on a branch, deploy a preview with `pnpm run deploy:preview` and QC it with " +
      "`pnpm run test:pr <n> -- --preview`, then merge and `pnpm run deploy`. An ungated admin prefix is a " +
      "hotfix-now item — do not batch it with other work.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async () => {
      let app: (typeof import("./index"))["app"];
      let MOUNT_PREFIXES: (typeof import("./index"))["MOUNT_PREFIXES"];
      let loadAllMounts: (typeof import("./index"))["loadAllMounts"];
      try {
        ({ app, MOUNT_PREFIXES, loadAllMounts } = await import("./index"));
      } catch (e) {
        return failure(
          `The Hono app failed to load: ${e instanceof Error ? e.message : String(e)}. A router module threw at ` +
            "import — every API request is 500ing until this is fixed.",
        );
      }

      const routes = app.routes;
      const paths = new Set(routes.map((r) => r.path));
      const problems: string[] = [];
      if (!paths.has("/api/ping")) problems.push("/api/ping is not registered");

      // Identity check on the MIDDLEWARE ITSELF, not on "something is registered
      // under /api/admin". Since routers are mounted lazily, the dispatcher
      // registers `app.all("/api/admin/*", …)` — which satisfies any
      // path-and-method test, so a path/method check would stay green even if
      // `app.use("/api/admin/*", requireAccessAuth)` were deleted outright.
      // Comparing the handler reference is the only form that cannot be
      // accidentally satisfied.
      const guardsAdmin = routes.some(
        (r) => r.path === "/api/admin/*" && r.handler === requireAccessAuth,
      );
      if (!guardsAdmin) {
        problems.push(
          "requireAccessAuth is NOT registered on /api/admin/* — admin routes are being served UNGATED",
        );
      }

      // Every prefix must have a dispatcher, and every router behind it must
      // actually import. This is the part that replaces counting app.routes.
      const dispatched = MOUNT_PREFIXES.filter((prefix) => paths.has(`${prefix}/*`));
      const undispatched = MOUNT_PREFIXES.filter((prefix) => !paths.has(`${prefix}/*`));
      if (undispatched.length > 0) {
        problems.push(`no dispatcher registered for: ${undispatched.join(", ")}`);
      }

      const failures = await loadAllMounts();
      if (failures.length > 0) {
        problems.push(
          `router import failed for ${failures.length} prefix(es): ` +
            failures.map((f) => `${f.prefix} (${f.error})`).join("; "),
        );
      }

      const details =
        `${MOUNT_PREFIXES.length} mount prefix(es), all imported cleanly; ` +
        `${routes.length} route(s)/middleware on the parent app across ${paths.size} distinct paths.`;
      if (problems.length > 0) {
        return failure(`${details} Problems: ${problems.join("; ")}.`);
      }
      if (dispatched.length < MOUNT_PREFIX_FLOOR) {
        return degraded(
          `${details} Below the expected floor of ${MOUNT_PREFIX_FLOOR} mount prefixes — routers were probably ` +
            "removed from the MOUNTS table, which shows up as 404s on a subset of the API.",
        );
      }
      return ok(details);
    },
  }),

  defineProbe({
    name: "api_openapi_document",
    displayName: "OpenAPI document builds and serves",
    description:
      "Dispatches one in-process request to GET /openapi.json through the app's own router and asserts the " +
      "response is 200 JSON with an `openapi` version and a non-empty `paths` map. No network egress.",
    healthTsFilepath: FILE,
    bindingTypesTested: [],
    whatSuccessMeans:
      "/openapi.json, /scalar and /swagger all render, so the API is discoverable and the `/context` endpoint " +
      "that agents read has a valid document behind it.",
    whatFailureMeans:
      "The API reference pages are broken. Because this document is hand-maintained in " +
      "src/backend/api/routes/openapi.ts rather than generated from route registrations, the usual cause is a " +
      "syntax or structural error introduced while adding a path by hand — which takes down the whole document, " +
      "not just the new entry. An empty `paths` map means the spec object loaded but lost its contents.",
    troubleshootingSteps:
      "1. Fetch it directly: `curl -s https://core-remodel.hacolby.workers.dev/openapi.json | jq '.paths | keys | length'`. " +
      '2. If it 404s, the openapiRouter is no longer mounted at `/` — check the last `app.route("/", openapiRouter)` ' +
      "line in src/backend/api/index.ts. 3. If it 500s, `npx tsc --noEmit` over src/backend/api/routes/openapi.ts. " +
      "4. Remember this document is hand-maintained: routes added under src/backend/api/routes/ are ABSENT from it " +
      "until mirrored in openapi.ts, so a route missing from the spec is a docs gap, not an outage. " +
      "5. Confirm the rendered pages: /scalar and /swagger.",
    devOpsPlaybook:
      "Low blast radius — the API keeps serving while its documentation is broken — but fix it in the same PR that " +
      "broke it, because a stale or dead spec is how agents start guessing at endpoints. Deploy with " +
      "`pnpm run deploy` from `main` and re-run this probe from /admin/system/health.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      let app: (typeof import("./index"))["app"];
      try {
        ({ app } = await import("./index"));
      } catch (e) {
        return failure(
          `The Hono app failed to load, so /openapi.json cannot be served: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const res = await app.request("http://health.probe/openapi.json", {}, env);
      if (!res.ok) {
        return failure(
          `GET /openapi.json returned ${res.status}. The API reference pages (/scalar, /swagger) and /context are broken.`,
        );
      }
      let doc: { openapi?: string; paths?: Record<string, unknown> };
      try {
        doc = await res.json();
      } catch (e) {
        return failure(
          `GET /openapi.json returned 200 but the body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const pathCount = Object.keys(doc.paths ?? {}).length;
      if (!doc.openapi || pathCount === 0) {
        return failure(
          `OpenAPI document is structurally invalid — openapi version: ${doc.openapi ?? "MISSING"}, ` +
            `paths documented: ${pathCount}.`,
        );
      }
      return ok(`OpenAPI ${doc.openapi} document served with ${pathCount} documented path(s).`);
    },
  }),

  defineProbe({
    name: "api_session_kv_reachable",
    displayName: "Session + cache KV reachable",
    description:
      "Asserts the SESSIONS and CACHE KV namespaces are bound and answer a read. One `get` each of a key that " +
      "need not exist; nothing is written.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["kv"],
    whatSuccessMeans:
      "Both namespaces are bound and reachable, so anything the API keeps out of D1 — session state, cached " +
      "lookups — can be read and written on the request path.",
    whatFailureMeans:
      "Requests that touch KV throw. Depending on the caller this surfaces as a 500 or as a silent cache miss on " +
      "every request, which quietly multiplies D1 and upstream load. A missing binding is a config fault; a bound " +
      "namespace that errors on read usually means the namespace id in wrangler.jsonc points at something that was " +
      "deleted from the account.",
    troubleshootingSteps:
      "1. Confirm both `kv_namespaces` entries (bindings SESSIONS and CACHE) exist in wrangler.jsonc. " +
      "2. Confirm the ids still exist: `npx wrangler kv namespace list`. " +
      "3. If an id is not in that list, the namespace was deleted — recreate it, update the id, and expect the " +
      "cached/session contents to be gone. 4. Redeploy: `pnpm run deploy` from `main`. " +
      "5. Re-run this probe from https://core-remodel.hacolby.workers.dev/admin/system/health and tail live traffic with " +
      "`npx wrangler tail` if requests are still erroring.",
    devOpsPlaybook:
      "Config/deploy fault. Previews share these namespaces by id, so a preview failing here means the config is " +
      "wrong rather than the preview being isolated. Losing CACHE is survivable (cold caches, higher D1 read " +
      "volume); losing SESSIONS logs devices out. Say which one is affected when reporting.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const missing: string[] = [];
      if (!env.SESSIONS) missing.push("SESSIONS");
      if (!env.CACHE) missing.push("CACHE");
      if (missing.length > 0) {
        return failure(
          `KV binding(s) absent: ${missing.join(", ")}. Check \`kv_namespaces\` in wrangler.jsonc.`,
        );
      }
      // Reads of keys that need not exist: proves reachability, writes nothing.
      await env.SESSIONS.get("health:probe");
      await env.CACHE.get("health:probe");
      return ok("SESSIONS and CACHE are both bound and answered a read.");
    },
  }),
];
