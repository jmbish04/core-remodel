#!/usr/bin/env node
/**
 * @fileoverview Thin wrapper over the local `tokens` CLI, which is synced to the
 * Cloudflare secret store — so a value read here is the SAME value the deployed
 * worker's secrets-store bindings resolve. Used by local scripts (e.g.
 * test_sales.mjs) that need to authenticate against the live worker, since those
 * secrets are `remote: true` and never present in `wrangler dev`.
 *
 * Reads only; never sets or logs values. `tokens show <name> --value-only`
 * prints the decrypted value to stdout with nothing else.
 *
 * Usage (as a module):
 *   import { getToken } from "./tokens.mjs";
 *   const key = getToken("WORKER_API_KEY");
 *
 * Usage (as a CLI, prints the value — pipe to something, don't paste it):
 *   node scripts/tokens.mjs WORKER_API_KEY
 */
import { execFileSync } from "node:child_process";

/**
 * Read one token's decrypted value from the `tokens` CLI.
 *
 * @param {string} name           The token name, e.g. "WORKER_API_KEY".
 * @param {object} [opts]
 * @param {boolean} [opts.optional]  Return null instead of throwing when the
 *                                    token is missing/empty or the CLI is absent.
 * @returns {string|null}
 */
export function getToken(name, { optional = false } = {}) {
  if (!name || typeof name !== "string") {
    throw new Error("getToken(name): a non-empty token name is required");
  }

  let raw;
  try {
    raw = execFileSync("tokens", ["show", name, "--value-only"], {
      encoding: "utf8",
      // Inherit nothing on stdin; capture stdout; capture stderr for errors.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (optional) return null;
    if (err && err.code === "ENOENT") {
      throw new Error(
        "`tokens` CLI not found on PATH. This script reads secrets from your " +
          "local tokens manager; install/authenticate it first.",
      );
    }
    const detail = (err && err.stderr ? String(err.stderr) : err?.message || "").trim();
    throw new Error(`tokens show ${name} failed: ${detail || "unknown error"}`);
  }

  const value = (raw ?? "").trim();
  if (!value) {
    if (optional) return null;
    throw new Error(`tokens returned an empty value for "${name}"`);
  }
  return value;
}

// CLI mode: `node scripts/tokens.mjs <NAME>` prints the value (for piping).
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: node scripts/tokens.mjs <TOKEN_NAME>");
    process.exit(2);
  }
  try {
    process.stdout.write(getToken(name));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
