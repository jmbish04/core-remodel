import { changelogBranches, changelogEntries } from "@backend/db/schema/changelog/changelog";

import type { ToolDef } from "../types";

export const createChangelogEntry: ToolDef = {
  name: "create_changelog_entry",
  description:
    "Record a change in the persistent changelog (shown at /admin/changelog, grouped by branch/PR). Upserts the branch and one entry. Every branch/PR of work should call this so the record accumulates in D1 forever. Pass a scorched-earth `detail` object (problem, approach, apiChanges[], mcpChanges[], filesTouched[], migrations[], code[], diagrams[]) for a full detail page.",
  inputSchema: {
    type: "object",
    properties: {
      branch: { type: "string", description: "Git branch name (grouping key)." },
      branchTitle: { type: "string", description: "Human title for the branch/PR." },
      branchSummary: { type: "string" },
      prNumber: { type: "number" },
      prUrl: { type: "string" },
      status: { type: "string", enum: ["shipped", "staged"], description: "Entry status (branch inherits 'staged'/'shipped')." },
      date: { type: "string", description: "ISO date YYYY-MM-DD." },
      slug: { type: "string", description: "Stable unique slug (detail page URL)." },
      tag: { type: "string", description: "e.g. 'Phase 1'." },
      area: { type: "string", description: "Product area, e.g. 'Showrooms'." },
      title: { type: "string" },
      summary: { type: "string" },
      changes: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["added", "changed", "removed", "migration", "fixed"] }, text: { type: "string" } } } },
      migrations: { type: "array", items: { type: "string" } },
      detail: { type: "object", description: "Scorched-earth PhaseDetail (problem, approach, apiChanges, mcpChanges, filesTouched, migrations, code, diagrams)." },
      diagrams: { type: "array", description: "Branch-level diagrams [{caption, code}].", items: { type: "object" } },
    },
    required: ["branch", "branchTitle", "date", "slug", "area", "title", "summary"],
  },
  handler: async ({ db, args }) => {
    const status = (args.status === "shipped" ? "shipped" : "staged") as "shipped" | "staged";
    await db
      .insert(changelogBranches)
      .values({
        branch: String(args.branch),
        title: String(args.branchTitle),
        summary: args.branchSummary ? String(args.branchSummary) : null,
        date: String(args.date),
        status,
        prNumber: typeof args.prNumber === "number" ? args.prNumber : null,
        prUrl: args.prUrl ? String(args.prUrl) : null,
        diagramsJson: Array.isArray(args.diagrams) ? (args.diagrams as any) : null,
      })
      .onConflictDoUpdate({
        target: changelogBranches.branch,
        set: {
          title: String(args.branchTitle),
          ...(args.branchSummary ? { summary: String(args.branchSummary) } : {}),
          date: String(args.date),
          ...(typeof args.prNumber === "number" ? { prNumber: args.prNumber } : {}),
          ...(args.prUrl ? { prUrl: String(args.prUrl) } : {}),
          ...(Array.isArray(args.diagrams) ? { diagramsJson: args.diagrams as any } : {}),
          updatedAt: new Date(),
        },
      });
    await db
      .insert(changelogEntries)
      .values({
        slug: String(args.slug),
        branch: String(args.branch),
        tag: args.tag ? String(args.tag) : null,
        area: String(args.area),
        title: String(args.title),
        summary: String(args.summary),
        status,
        date: String(args.date),
        changesJson: Array.isArray(args.changes) ? (args.changes as any) : [],
        migrationsJson: Array.isArray(args.migrations) ? (args.migrations as string[]) : [],
        detailJson: args.detail ? (args.detail as Record<string, unknown>) : null,
      })
      .onConflictDoUpdate({
        target: changelogEntries.slug,
        set: {
          branch: String(args.branch),
          tag: args.tag ? String(args.tag) : null,
          area: String(args.area),
          title: String(args.title),
          summary: String(args.summary),
          status,
          date: String(args.date),
          changesJson: Array.isArray(args.changes) ? (args.changes as any) : [],
          migrationsJson: Array.isArray(args.migrations) ? (args.migrations as string[]) : [],
          ...(args.detail ? { detailJson: args.detail as Record<string, unknown> } : {}),
          updatedAt: new Date(),
        },
      });
    return JSON.stringify({ ok: true, branch: args.branch, slug: args.slug });
  },
};
