# API Endpoints

[← Back to API Overview](../api.md)

This document describes the API structure for `core-remodel`.

## Overview
The application uses Hono to serve a REST API under the `/api` prefix, and serves an OpenAPI v3.1.0 document.

## Key Services
- **Changelog API:** Provides endpoints to seed, read, and write changelog entries.
- **MCP API:** Exposes MCP tool logic over HTTP.
- **Tesla Integrations:** Provides endpoints for fetching and controlling telemetry.
