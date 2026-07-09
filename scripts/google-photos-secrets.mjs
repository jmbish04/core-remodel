#!/usr/bin/env node
/**
 * @fileoverview Populate the Google Photos Picker OAuth secrets in the
 * Cloudflare Secrets Store from a client-secret JSON downloaded from the
 * Google Cloud Console.
 *
 * What it does:
 *   1. Asks for the location of the OAuth client-secret JSON (Enter accepts the
 *      default path below).
 *   2. Parses it — supports both the "web" and "installed" client shapes — and
 *      extracts `client_id` + `client_secret`.
 *   3. Reads the Secrets Store `store_id` straight out of `wrangler.jsonc` (so
 *      the store is never hardcoded here and stays in sync with the worker).
 *   4. Writes two secrets — GOOGLE_PHOTOS_CLIENT_ID and
 *      GOOGLE_PHOTOS_CLIENT_SECRET — via `wrangler secrets-store secret`. It
 *      tries `create` first and transparently falls back to `update` if the
 *      secret already exists.
 *   5. Prints the redirect URIs to register + the scope + the API to enable.
 *
 * Security note: the secret VALUES are passed to wrangler as discrete argv
 * elements via execFileSync (no shell), so they never land in your shell
 * history. They are briefly visible to `ps` while wrangler runs — acceptable
 * for a local, developer-run provisioning script.
 *
 * Usage:
 *   pnpm run secrets:google-photos
 *   pnpm run secrets:google-photos -- /path/to/client-secret.json   (skip prompt)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// Default location of the downloaded OAuth client-secret JSON. This is the
// repo owner's canonical path; override per-machine with the
// GOOGLE_PHOTOS_CLIENT_SECRET_PATH env var or by passing a path argument.
const DEFAULT_SECRET_PATH =
  process.env.GOOGLE_PHOTOS_CLIENT_SECRET_PATH ||
  "/Users/126colby/Developer/api_secrets/google/google-photos-client-secret-oauth.json";

const WRANGLER_CONFIG = "wrangler.jsonc";
const SCOPES = "workers";

/** Names of the two secrets we manage (bindings share these names). */
const SECRET_CLIENT_ID = "GOOGLE_PHOTOS_CLIENT_ID";
const SECRET_CLIENT_SECRET = "GOOGLE_PHOTOS_CLIENT_SECRET";

/**
 * Extract the Secrets Store id from wrangler.jsonc without a full JSONC parse.
 * Every `secrets_store_secrets[]` entry in this project shares one store id, so
 * the first match is authoritative.
 */
function readStoreId() {
  const raw = readFileSync(WRANGLER_CONFIG, "utf8");
  const match = raw.match(/"store_id"\s*:\s*"([a-f0-9]+)"/i);
  if (!match) {
    throw new Error(
      `Could not find a "store_id" in ${WRANGLER_CONFIG}. Is there a secrets_store_secrets block?`,
    );
  }
  return match[1];
}

/**
 * Parse the downloaded client-secret JSON and pull out the OAuth client id +
 * secret. Google emits either { "web": {...} } (Web application) or
 * { "installed": {...} } (Desktop app) — handle both.
 */
function parseClientSecret(path) {
  if (!existsSync(path)) {
    throw new Error(`Client-secret file not found: ${path}`);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse JSON at ${path}: ${err.message}`);
  }

  const cfg = json.web ?? json.installed;
  if (!cfg) {
    throw new Error(
      `Unexpected client-secret shape at ${path}: expected a top-level "web" or "installed" key.`,
    );
  }
  const clientId = cfg.client_id;
  const clientSecret = cfg.client_secret;
  if (!clientId || !clientSecret) {
    throw new Error(
      `client_id / client_secret missing from ${path}. Re-download the OAuth client credentials.`,
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUris: Array.isArray(cfg.redirect_uris) ? cfg.redirect_uris : [],
    projectId: cfg.project_id ?? null,
  };
}

/**
 * Write one secret to the Secrets Store. Tries `create`; if the secret already
 * exists (create errors), retries with `update`. Value is passed as an argv
 * element (no shell interpolation).
 */
function putSecret(storeId, name, value) {
  const base = (verb) => [
    "wrangler",
    "secrets-store",
    "secret",
    verb,
    storeId,
    "--name",
    name,
    "--scopes",
    SCOPES,
    "--remote",
    "--value",
    value,
  ];

  const run = (verb) =>
    execFileSync("npx", base(verb), { stdio: ["ignore", "inherit", "pipe"] });

  try {
    run("create");
    console.log(`  ✓ created ${name}`);
  } catch (createErr) {
    const stderr = createErr.stderr?.toString?.() ?? "";
    const alreadyExists = /already exists|duplicate|conflict/i.test(stderr);
    if (!alreadyExists) {
      if (stderr) process.stderr.write(stderr);
      throw new Error(`Failed to create secret ${name} (see wrangler output above).`);
    }
    console.log(`  • ${name} exists — updating…`);
    run("update");
    console.log(`  ✓ updated ${name}`);
  }
}

async function main() {
  // Path can come from argv (after `--`) or the interactive prompt.
  const argPath = process.argv[2];
  let secretPath = argPath;
  if (!secretPath) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `Path to the Google Photos client-secret JSON\n  [${DEFAULT_SECRET_PATH}]: `,
    );
    rl.close();
    secretPath = answer.trim() || DEFAULT_SECRET_PATH;
  }

  console.log(`\nReading ${secretPath} …`);
  const { clientId, clientSecret, redirectUris, projectId } = parseClientSecret(secretPath);
  const storeId = readStoreId();

  console.log(`Google project: ${projectId ?? "(unknown)"}`);
  console.log(`Client ID:      ${clientId.slice(0, 24)}…`);
  console.log(`Secrets Store:  ${storeId}\n`);

  console.log("Writing secrets to the Cloudflare Secrets Store…");
  putSecret(storeId, SECRET_CLIENT_ID, clientId);
  putSecret(storeId, SECRET_CLIENT_SECRET, clientSecret);

  console.log("\n✅ Done.\n");
  console.log("Next steps in the Google Cloud Console:");
  console.log('  1. Enable the "Photos Picker API" for this project.');
  console.log("  2. On the OAuth client, register these Authorized redirect URIs:");
  const suggested = new Set([
    "http://localhost:8788/api/google-photos/auth/callback",
    "http://localhost:4321/api/google-photos/auth/callback",
    "https://<your-worker-domain>/api/google-photos/auth/callback",
  ]);
  for (const uri of redirectUris) suggested.add(uri);
  for (const uri of suggested) console.log(`       ${uri}`);
  console.log(
    "  3. Ensure the OAuth consent screen requests scope:\n" +
      "       https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
  );
  console.log(
    "\nThen deploy (`pnpm run deploy`) so the worker picks up the new secret bindings.",
  );
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
