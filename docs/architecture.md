# Architecture

[← Back to Index](./README.md)

## Overview

**core-remodel** is built as a highly interactive, server-side rendered application utilizing modern web and edge technologies.

### Frontend
- **Framework:** [Astro](https://astro.build/) using `@astrojs/cloudflare` for deployment.
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **UI Components:** [shadcn/ui](https://ui.shadcn.com/) utilizing React for interactive islands.

### Backend & Infrastructure
The application is deployed on **Cloudflare Workers**.
- **Database:** Cloudflare D1 (SQLite at the edge), managed via Drizzle ORM.
- **State & Real-time:** Cloudflare Durable Objects. (Note: using `this.schedule()` is explicitly banned; native alarms via `ctx.storage.setAlarm()` must be used).
- **Other Services:** Incorporates MCP tools, Vectorize, and AI governance elements.

### Build and Deployment
Deployments are handled via GitHub Actions. Branch deploys use per-branch preview workers (`wcrp-<branch-slug>`) to prevent collisions and unintended production deployments.

See the `AGENTS.md` file for full deployment, isolation, and configuration constraints.
[Return to Index](README.md)

This project is a monorepo that serves as the mission control for remodeling projects.

## Key Components

- **Frontend:** Built with Astro, utilizing Tailwind CSS for styling and shadcn/ui for components.
- **Backend/Platform:** Deployed on Cloudflare Workers.
- **Database:** Uses Cloudflare D1 for relational data storage, managed with Drizzle ORM.
- **State Management:** Employs Cloudflare Durable Objects for coordinating state.
- **AI & MCP:** Integrates AI tools and Model Context Protocol (MCP) servers for advanced capabilities.

*(This page is a placeholder and should be expanded with detailed diagrams and deeper architectural explanations.)*
