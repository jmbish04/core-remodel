# Architecture

[← Back to Index](README.md)

## Overview

**core-remodel** is built as a highly interactive, server-side rendered application utilizing modern web and edge technologies. It serves as a mission control platform for remodeling projects, integrating inputs from contractors, designers, and homeowners.

## Key Components

### Frontend
- **Framework:** [Astro](https://astro.build/) using `@astrojs/cloudflare` for edge deployment.
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **UI Components:** [shadcn/ui](https://ui.shadcn.com/) utilizing React for interactive islands.
- **Convention:** Every Astro page must be a thin shell mounting one React island, wrapped in `<BaseLayout>`, and must include an icon.

### Backend & Infrastructure
The application is deployed as a single unified Worker on **Cloudflare Workers**.
- **Database:** Cloudflare D1 (SQLite at the edge), schema managed and queried via Drizzle ORM.
- **State & Real-time:** Cloudflare Durable Objects.
  - *Important Constraint:* The use of `this.schedule()` is explicitly banned to prevent runaway billing. Native alarms via `ctx.storage.setAlarm()` must be used instead.
- **AI & Integrations:** Incorporates Workers AI, Vectorize for embeddings, and Google Apps Script integrations (located in `src/appscript/`).
- **MCP Tools:** Implements Model Context Protocol (MCP) servers. The transport/router is `mcp/tools/index.ts`, and individual tool logic is strictly separated into `tools/<tool_name>.ts` exporting a `ToolDef`.

### Build and Deployment
Deployments are handled automatically via GitHub Actions. Branch deploys use per-branch preview workers (`wcrp-<branch-slug>`) to prevent collisions and unintended production deployment. Refer to [Deployment](deployment.md) for more details.

[← Back to Index](README.md)
