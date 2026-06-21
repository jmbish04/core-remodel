import { app as hono } from "./hono";

const HONO_PREFIXES = ["/api", "/openapi.json", "/scalar", "/swagger"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApi = HONO_PREFIXES.some((p) => url.pathname.startsWith(p));
    if (isApi) {
      return hono.fetch(request, env, ctx);
    }
    // Everything else → static SPA (the cold-calling machine).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
