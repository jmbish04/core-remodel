#!/usr/bin/env node
/**
 * Bundles `scout_smoke.ts` for Node so the live smoke test can run outside the
 * Worker. Exists because esbuild's `--alias` is prefix-based and cannot express
 * the tsconfig's exact-match `@backend/db` → `schema/index.ts` rule, which
 * collides with the `@backend/db/*` prefix rule.
 *
 * Output lands inside `node_modules/.cache/` on purpose: node_modules packages
 * stay external (bundling CJS like `debug` into ESM breaks on `require("tty")`),
 * so the bundle must sit somewhere Node can resolve them from.
 *
 * Usage: node scripts/tests/build_scout_smoke.mjs && node node_modules/.cache/scout-smoke/run.mjs
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const OUTFILE = path.join(root, "node_modules/.cache/scout-smoke/run.mjs");

const EXTS = [".ts", ".tsx", ".mjs", ".js", ".json"];

/**
 * Returning a path from onResolve marks it fully resolved, so esbuild skips its
 * own extension probing — we have to do it here.
 */
function resolveFile(abs) {
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  for (const ext of EXTS) if (fs.existsSync(abs + ext)) return abs + ext;
  for (const ext of EXTS) {
    const idx = path.join(abs, `index${ext}`);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

/** Mirrors tsconfig `paths`, longest/exact match first. */
const tsconfigPaths = {
  plugin: {
    name: "tsconfig-paths",
    setup(b) {
      b.onResolve({ filter: /^@(backend|frontend)?(\/|$)/ }, (args) => {
        const p = args.path;
        let rel;
        if (p === "@backend/db") rel = "src/backend/db/schema/index.ts";
        else if (p.startsWith("@backend/db/")) rel = `src/backend/db/${p.slice("@backend/db/".length)}`;
        else if (p.startsWith("@backend/")) rel = `src/backend/${p.slice("@backend/".length)}`;
        else if (p.startsWith("@frontend/")) rel = `src/frontend/${p.slice("@frontend/".length)}`;
        else if (p.startsWith("@/")) rel = `src/${p.slice(2)}`;
        else return null;
        const resolved = resolveFile(path.resolve(root, rel));
        if (!resolved) return { errors: [{ text: `tsconfig-paths could not resolve ${p}` }] };
        return { path: resolved, namespace: "file" };
      });
    },
  },
};

await build({
  entryPoints: [path.join(root, "scripts/tests/scout_smoke.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: OUTFILE,
  plugins: [tsconfigPaths.plugin],
  // Keep npm packages external — bundling CJS deps (debug → require("tty"))
  // into an ESM output throws "Dynamic require is not supported" at runtime.
  packages: "external",
  external: ["cloudflare:*"],
  logLevel: "error",
  // `@/*` also maps to src/frontend and src/backend in tsconfig; resolving to
  // src/* covers every import this entrypoint actually reaches.
  resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
});

console.log(`built ${OUTFILE}`);
