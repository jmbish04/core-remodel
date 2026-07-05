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
 * Helper to fetch the  AI Gateway token.
 * Used as the `Authorization: Bearer <token>` credential for Cloudflare AI
 * Gateway's provider path. Maps to CLOUDFLARE_AI_GATEWAY_TOKEN.
 */
export async function getCloudflareAiGatewayToken(env: Env): Promise<string> {
  if (env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
    return typeof env.CLOUDFLARE_AI_GATEWAY_TOKEN === "string"
      ? env.CLOUDFLARE_AI_GATEWAY_TOKEN
      : await (env.CLOUDFLARE_AI_GATEWAY_TOKEN as any).get();
  }
  throw new Error("Missing env.CLOUDFLARE_AI_GATEWAY_TOKEN in Worker Secret Bindings");
}

/**
 * Helper to fetch NotebookLM cookies.
 * Maps to NOTEBOOKLM_COOKIES if present in env.
 */
// export async function getNotebookLMCookies(env: Env): Promise<string> {
//   const cookies = (env as any).NOTEBOOKLM_COOKIES;
//   if (cookies) {
//     return typeof cookies === "string"
//       ? cookies
//       : await cookies.get();
//   }
//   throw new Error("Missing env.NOTEBOOKLM_COOKIES in Worker Secret Bindings");
// }