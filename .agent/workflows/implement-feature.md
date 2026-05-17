# Feature: Multi-Turn Image Editing Revision Tree

## Objective
Implement a robust image editing pipeline utilizing Gemini 3 Pro Image Preview routed entirely through Cloudflare AI Gateway. This pipeline must support a localized multi-turn revision tree (forking) backed by D1, and multi-image compositing (up to 14 references).

## Steps
1. **Schema Generation:**
   - Create/Update `src/backend/db/schema/images/image_edit_revisions.ts`.
   - Run `pnpm run db:generate` followed by `pnpm run migrate:local` / `migrate:remote`.
2. **Service Layer Implementation:**
   - Create `src/backend/services/image-processor.ts`.
   - Ensure the `@google/genai` dependency is installed (`npm install @google/genai`).
   - Validate `baseUrl` logic targeting the Cloudflare AI Gateway `google-ai-studio` endpoint.
3. **API Route Implementation:**
   - Create/Update `src/backend/api/routes/photo-edits.ts`.
   - Implement the `zValidator` to enforce up to 14 multi-modal image arrays.
   - Implement the direct `fetch()` call to the Cloudflare Images API using the output base64 data.
   - Insert the resulting D1 revision record.
4. **Environment Check:**
   - Ensure `src/env.d.ts` correctly registers `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `AI_GATEWAY_ID`, and `CF_IMAGES_TOKEN`.
