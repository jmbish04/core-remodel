#!/usr/bin/env node
/**
 * @fileoverview Read the MCP agent backlog from D1 (0017 §7).
 *
 * A convenience read-only query so a coding agent that ISN'T chatting over the
 * MCP connector can still see the backlog Claude wrote during chats:
 *   - open `mcp_agent_issues` (bugs to fix), and
 *   - `mcp_feature_requests` that are still `requested` (to plan with the user).
 *
 * Uses `wrangler d1 execute DB --remote` with plain SELECTs — no mutation, so
 * it's safe to run anytime (unlike migrations, which must go through
 * `pnpm run migrate:remote`).
 *
 * Usage:
 *   pnpm run mcp:issues              # open bugs + requested features
 *   node scripts/mcp-issues.mjs --status=all
 */
import { execFileSync } from "node:child_process";

const BINDING = "DB";

const statusArg = process.argv.find((a) => a.startsWith("--status="));
const status = statusArg ? statusArg.split("=")[1] : "open";

/** Run a read-only SELECT against remote D1 and return parsed result rows. */
function query(sql) {
  const args = ["wrangler", "d1", "execute", BINDING, "--remote", "--json", `--command=${sql}`];
  const out = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
  const parsed = JSON.parse(json);
  return parsed?.[0]?.results ?? [];
}

const issueWhere = status === "all" ? "" : `WHERE status = '${status.replace(/'/g, "")}'`;

const bugs = query(
  `SELECT id, tool_name, summary, severity, status, fixed_by_pr, created_at ` +
    `FROM mcp_agent_issues ${issueWhere} ORDER BY created_at DESC LIMIT 100`,
);

const features = query(
  `SELECT id, title, status, plan_ref, pr_number, created_at ` +
    `FROM mcp_feature_requests ` +
    `${status === "all" ? "" : "WHERE status = 'requested'"} ` +
    `ORDER BY created_at DESC LIMIT 100`,
);

console.log(`\n🐛 MCP agent issues (${status})— ${bugs.length}`);
for (const b of bugs) {
  console.log(
    `  #${b.id} [${b.severity}/${b.status}]${b.tool_name ? ` (${b.tool_name})` : ""}: ${b.summary}` +
      `${b.fixed_by_pr ? ` — fixed by PR #${b.fixed_by_pr}` : ""}`,
  );
}

console.log(`\n💡 MCP feature requests — ${features.length}`);
for (const f of features) {
  console.log(
    `  #${f.id} [${f.status}]: ${f.title}` +
      `${f.plan_ref ? ` — plan: ${f.plan_ref}` : ""}${f.pr_number ? ` — PR #${f.pr_number}` : ""}`,
  );
}

console.log("");
