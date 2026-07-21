import { Devtools12 } from "../../../components/beste/block/devtools12";

/**
 * Integration usage viewport.
 *
 * NOTE: the registry block ships with its own sample dataset. The page and
 * route are real; the numbers are not yet read from `gemini_usage_log` /
 * `mcp_tool_invocations`. Wiring those is separate work.
 */
export function IntegrationUsageApp() {
  return <Devtools12 />;
}
