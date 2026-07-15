/**
 * Shared secret helpers for Cloudflare Images credentials.
 *
 * Priority order for Images token selection:
 * 1) CLOUDFLARE_IMAGES_STREAM_TOKEN
 * 2) CLOUDFLARE_API_TOKEN (legacy fallback)
 * 3) CLOUDFLARE_WORKER_ADMIN_TOKEN (legacy fallback)
 * 4) CLOUDFLARE_WRANGLER_API_TOKEN (last-resort fallback)
 */

const IMAGE_TOKEN_BINDINGS = [
  "CLOUDFLARE_IMAGES_STREAM_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_WORKER_ADMIN_TOKEN",
  "CLOUDFLARE_WRANGLER_API_TOKEN",
] as const;

type ImageTokenBindingName = (typeof IMAGE_TOKEN_BINDINGS)[number];

type EnvWithOptionalImageBindings = Env &
  Partial<Record<ImageTokenBindingName, SecretsStoreSecret>>;

async function readSecretValue(secret: SecretsStoreSecret | null | undefined): Promise<string> {
  if (!secret) {
    return "";
  }

  try {
    return (await secret.get())?.trim() || "";
  } catch {
    return "";
  }
}

function getOptionalBinding(
  env: Env,
  binding: ImageTokenBindingName,
): SecretsStoreSecret | undefined {
  return (env as EnvWithOptionalImageBindings)[binding];
}

export async function getCloudflareAccountId(env: Env): Promise<string | null> {
  const value = await readSecretValue(env.CLOUDFLARE_ACCOUNT_ID);
  return value.length > 0 ? value : null;
}

export async function getCloudflareImagesTokenCandidates(env: Env): Promise<string[]> {
  const values = await Promise.all(
    IMAGE_TOKEN_BINDINGS.map(async (binding) => readSecretValue(getOptionalBinding(env, binding))),
  );

  return Array.from(new Set(values.filter((value): value is string => value.length > 0)));
}

export async function getCloudflareImagesToken(env: Env): Promise<string> {
  const [firstToken] = await getCloudflareImagesTokenCandidates(env);
  if (!firstToken) {
    throw new Error(
      "Cloudflare Images token not configured. Expected CLOUDFLARE_IMAGES_STREAM_TOKEN (or fallback token).",
    );
  }
  return firstToken;
}

export async function resolveCloudflareImagesCredentials(env: Env): Promise<{
  accountId: string | null;
  apiTokens: string[];
}> {
  const [accountId, apiTokens] = await Promise.all([
    getCloudflareAccountId(env),
    getCloudflareImagesTokenCandidates(env),
  ]);

  return { accountId, apiTokens };
}


/**
 * Helper to fetch the Google Maps API Key.
 * Maps to GOOGLE_MAPS_API in this worker secret binding.
 */
export async function getGoogleMapsApiKey(env: Env): Promise<string> {
  if (env.GOOGLE_MAPS_API) {
    return typeof env.GOOGLE_MAPS_API === "string"
      ? env.GOOGLE_MAPS_API
      : await (env.GOOGLE_MAPS_API as any).get();
  }
  throw new Error("Missing env.GOOGLE_MAPS_API in Worker Secret Bindings");
}

/**
 * Helper to fetch the Google Search API Key.
 * Maps to GOOGLE_SEARCH_API_KEY in this worker secret binding.
 */
export async function getGoogleSearchApiKey(env: Env): Promise<string> {
  if (env.GOOGLE_SEARCH_API_KEY) {
    return typeof env.GOOGLE_SEARCH_API_KEY === "string"
      ? env.GOOGLE_SEARCH_API_KEY
      : await (env.GOOGLE_SEARCH_API_KEY as any).get();
  }
  throw new Error("Missing env.GOOGLE_SEARCH_API_KEY in Worker Secret Bindings");
}

/**
 * Helper to fetch the Google Photos OAuth 2.0 client credentials.
 *
 * These back the 3-legged OAuth flow used by the Google Photos Picker API
 * (see `src/backend/services/google-photos/`). Populate the underlying
 * Secrets Store secrets with `pnpm run secrets:google-photos`, which parses the
 * client-secret JSON downloaded from the Google Cloud Console.
 *
 * Maps to GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET in the worker's
 * Secrets Store bindings.
 *
 * @throws if either secret is missing/empty.
 */
export async function getGooglePhotosOAuthClient(
  env: Env,
): Promise<{ clientId: string; clientSecret: string }> {
  const [clientId, clientSecret] = await Promise.all([
    readSecretValue(env.GOOGLE_PHOTOS_CLIENT_ID),
    readSecretValue(env.GOOGLE_PHOTOS_CLIENT_SECRET),
  ]);

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Photos OAuth client not configured. Expected GOOGLE_PHOTOS_CLIENT_ID and " +
        "GOOGLE_PHOTOS_CLIENT_SECRET secret bindings (run `pnpm run secrets:google-photos`).",
    );
  }

  return { clientId, clientSecret };
}

/**
 * Helper to fetch the Fal AI API key.
 * Used as the `Authorization: Key <token>` credential for Fal models routed through
 * Cloudflare AI Gateway's native `/fal` provider path. Maps to FAL_API_KEY in this
 * worker secret binding.
 */
export async function getFalApiKey(env: Env): Promise<string> {
  if (env.FAL_API_KEY) {
    return typeof env.FAL_API_KEY === "string"
      ? env.FAL_API_KEY
      : await (env.FAL_API_KEY as any).get();
  }
  throw new Error("Missing env.FAL_API_KEY in Worker Secret Bindings");
}

/**
 * Helper to fetch the Replicate API token.
 * Used as the `Authorization: Bearer <token>` credential for Black Forest Labs
 * Pro/Max models (flux-depth-pro, flux-kontext-max) routed through Cloudflare AI
 * Gateway's native `/replicate` provider path. Maps to REPLICATE_API_TOKEN.
 */
export async function getReplicateApiToken(env: Env): Promise<string> {
  if (env.REPLICATE_API_TOKEN) {
    return typeof env.REPLICATE_API_TOKEN === "string"
      ? env.REPLICATE_API_TOKEN
      : await (env.REPLICATE_API_TOKEN as any).get();
  }
  throw new Error("Missing env.REPLICATE_API_TOKEN in Worker Secret Bindings");
}

/**
 * Generic reader for a Cloudflare Secrets Store binding.
 *
 * Resolves the named binding on `env` to its trimmed string value. Handles both
 * the Secrets Store binding shape (`.get()`) and a plain-string Worker secret
 * (so a binding can be migrated between the two without touching callers).
 *
 * @param env     Worker env.
 * @param binding The binding name as declared in `wrangler.jsonc`.
 * @returns The secret value, or `""` when the binding is absent/empty/errored.
 *          Callers that require the value should check for empty and throw.
 */
export async function getSecretStoreBinding(
  env: Env,
  binding: keyof Env & string,
): Promise<string> {
  const value = (env as unknown as Record<string, unknown>)[binding];
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  try {
    return (await (value as SecretsStoreSecret).get())?.trim() || "";
  } catch {
    return "";
  }
}

/**
 * Tessie hosted Fleet API bearer token (`TESSIE_API_TOKEN`).
 * Empty string when unconfigured — the Tesla features stay dormant.
 */
export async function getTessieToken(env: Env): Promise<string> {
  return getSecretStoreBinding(env, "TESSIE_API_TOKEN");
}

/**
 * VIN of the vehicle ("Betsy") that Tessie commands/queries target
 * (`TESLA_BETSY_VIN`). Empty string when unconfigured.
 */
export async function getTeslaVin(env: Env): Promise<string> {
  return getSecretStoreBinding(env, "TESLA_BETSY_VIN");
}

/**
 * Shared `WORKER_API_KEY` used to authenticate inbound Tesla webhook /
 * fleet-telemetry POSTs (no dedicated Tesla webhook secret). Empty string when
 * unconfigured — the webhook then rejects everything.
 */
export async function getWorkerApiKey(env: Env): Promise<string> {
  return getSecretStoreBinding(env, "WORKER_API_KEY");
}