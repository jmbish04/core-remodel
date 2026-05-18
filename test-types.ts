/// <reference path="./worker-configuration.d.ts" />
export const handler: ExportedHandler<Cloudflare.Env> = {
  fetch(req, env) {
    env.DB; // Should be D1Database
    env.ASSETS; // Should be Fetcher
    return new Response();
  },
};
