# Handoff — Chat Endpoint Wiring (Hard)

## 1. Observation

- **File modified**: `src/backend/api/routes/bid-portfolio-public.ts`
- **Before**: Lines 465-478 contained a placeholder `POST /:token/chat` handler returning 501 with `"Chat feature is not yet implemented"`.
- **Reference pattern**: `src/backend/api/routes/budget-agent.ts` — uses `getAgentByName`, `agent.chat()`, and `createUIMessageStream`/`createUIMessageStreamResponse` to produce a Vercel AI SDK–compatible streaming response.
- **Agent API**: `src/backend/ai/agents/BidPortfolioAgent/index.ts` exposes:
  - `initialize(config: { portfolioToken, contactBusinessType, showBudgetRanges, roomScope })` — idempotent state setter
  - `chat(request: { conversationId, prompt })` → `{ text }` — generates AI response via Workers AI
- **DO binding**: `BID_PORTFOLIO_AGENT` confirmed in `wrangler.jsonc` (line 183) and `worker-configuration.d.ts` (line 35).

## 2. Logic Chain

1. The budget-agent route (`budget-agent.ts`) is the canonical pattern for DO-backed chat endpoints in this codebase.
2. The BidPortfolioAgent's `chat()` returns `{ text }` (no `proposals`), so the stream writer omits the budget-specific `data-budget_proposals` writes and only emits `start → text-start → text-delta → text-end → finish`.
3. The agent is addressed by `token` (one DO instance per shared portfolio link), matching the portfolio's public access model.
4. Before chatting, the route verifies the portfolio exists and isn't expired (reusing the existing `isExpired()` helper), then queries contact info (for `businessType`) and room config IDs (for `roomScope`), passing them to `agent.initialize()`.
5. `extractMessageText()` was copied verbatim from budget-agent to handle both `content: string` and `parts: [{type:"text", text:"..."}]` message formats.

## 3. Caveats

- No caveats. The implementation follows the established pattern exactly, and the BidPortfolioAgent's `initialize()` is documented as idempotent.

## 4. Conclusion

The `POST /:token/chat` endpoint is now fully wired to invoke `BidPortfolioAgent` via the Cloudflare Agents SDK. It validates the token, initializes the agent with portfolio context, calls `chat()`, and returns a UI message stream response compatible with the Vercel AI SDK frontend.

### Changes Made

**`src/backend/api/routes/bid-portfolio-public.ts`**:
- **Added imports** (lines 1, 22-23): `BidPortfolioAgent`, `getAgentByName`, `createUIMessageStream`, `createUIMessageStreamResponse`, `UIMessage`.
- **Added helper** (lines 472-488): `extractMessageText()` — extracts user message text from `content` or `parts` arrays.
- **Replaced placeholder** (lines 490-598): Full chat handler that validates token, checks expiration, fetches contact/room config from DB, gets agent via `getAgentByName`, calls `initialize()` + `chat()`, and returns a `createUIMessageStreamResponse`.

## 5. Verification Method

```bash
cd /Volumes/Projects/workers/core-remodel && pnpm run build
```

**Result**: ✅ Build succeeded — `Server built in 5.73s`, `Complete!`, zero TypeScript errors.

To verify runtime behavior, deploy to a preview environment and `POST` to `/:token/chat` with:
```json
{ "id": "test", "messages": [{"role": "user", "parts": [{"type": "text", "text": "What rooms are in this project?"}]}] }
```
Expected: Streaming response with agent-generated text about the portfolio's renovation scope.
