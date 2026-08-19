/**
 * @fileoverview Make `registration_client_uri` absolute on the DCR response.
 *
 * `@cloudflare/workers-oauth-provider@0.8.1` builds that field by concatenating
 * the `clientRegistrationEndpoint` option verbatim:
 *
 *   registration_client_uri: `${this.options.clientRegistrationEndpoint}/${clientId}`
 *
 * We configure that option as the PATH `/oauth/register` (so the provider serves
 * the endpoint on this worker at any hostname), which means the field ships as
 * `/oauth/register/<id>` — a relative URI. RFC 7591 §3.2.1 requires a fully
 * qualified URL there, and a client that does `new URL(registration_client_uri)`
 * on it throws. claude.ai surfaces that as:
 *
 *   "Couldn't register with core-remodel's sign-in service. You can try again,
 *    or add an OAuth Client ID in the connector settings."
 *
 * — i.e. dynamic client registration failed, so it falls back to asking for a
 * pre-registered client id. The registration itself SUCCEEDS server-side (201,
 * `client:<id>` written to OAUTH_KV); only the client's parse of the response
 * fails, which is why the worker's own logs and a curl probe both look healthy.
 *
 * Rather than hardcode the production origin into the provider options — which
 * would make every branch preview advertise the production host — this rewrites
 * the field per request, resolving it against the origin the request actually
 * arrived on. A response that already carries an absolute URI is left alone, so
 * this becomes a no-op if the library is ever fixed upstream.
 */

/** The DCR endpoint this worker serves. Matches the OAuthProvider option. */
const REGISTRATION_PATH = "/oauth/register";

/** True when `value` is already a fully qualified URL. */
function isAbsolute(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap a fetch handler so a successful `POST /oauth/register` response gets an
 * absolute `registration_client_uri`. Every other request passes straight
 * through untouched.
 */
export function withAbsoluteRegistrationUri(
  fetchHandler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>,
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const isRegistration = request.method === "POST" && url.pathname === REGISTRATION_PATH;

    const response = await fetchHandler(request, env, ctx);
    if (!isRegistration || !response.ok) return response;

    // Only touch JSON. A non-JSON body here would mean the provider changed
    // shape, and rewriting it blind would do more harm than leaving it.
    if (!response.headers.get("content-type")?.includes("application/json")) return response;

    let body: Record<string, unknown>;
    try {
      body = (await response.clone().json()) as Record<string, unknown>;
    } catch {
      return response;
    }

    const current = body.registration_client_uri;
    if (typeof current !== "string" || isAbsolute(current)) return response;

    body.registration_client_uri = new URL(current, url.origin).toString();

    // Preserve the provider's status (201) and headers (it sets no-cache).
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
