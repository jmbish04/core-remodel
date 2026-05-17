# Rule: Gemini 3 Image Editing & Cloudflare Infrastructure

## AI Gateway Usage
- All Google Gen AI (Gemini) API calls MUST route through Cloudflare AI Gateway.
- Base URL format: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio`.

## SDK & Authentication
- ALWAYS use the `@google/genai` SDK for image interactions.
- ALWAYS authenticate using `env.GEMINI_API_KEY`. NEVER use `GOOGLE_GENERATIVE_AI_API_KEY`.

## Image Storage & Database
- Output images must always be piped to Cloudflare Images / R2 immediately upon generation.
- The system of record for the history/tree is D1 (`image_edit_revisions`). A `parentId` must be utilized to maintain the forkable revision tree.
