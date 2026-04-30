/**
 * @fileoverview Cloudflare Workers entry point
 *
 * This file integrates the Hono API with Astro SSR.
 */

import type { ExportedHandler } from '@cloudflare/workers-types';
import { app as honoApp } from './backend/api/index';
import type { Bindings } from './backend/api/index';

const handler: ExportedHandler<Bindings> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle API routes with Hono
    if (url.pathname.startsWith('/api/') ||
        url.pathname === '/openapi.json' ||
        url.pathname === '/swagger' ||
        url.pathname === '/scalar' ||
        url.pathname === '/docs') {
      return honoApp.fetch(request, env, ctx);
    }

    // Let Astro handle everything else via the ASSETS binding
    return env.ASSETS.fetch(request);
  },
};

export default handler;
