/**
 * @fileoverview Role hireability analysis pipeline — multi-step AI task
 * that evaluates a candidate's fit for a role using NotebookLM evidence
 * and gpt-oss-120b structured output.
 *
 * Pipeline steps:
 *  1. Load role context (job posting, instructions, scraped content)
 *  2. Parse requirements into categorized arrays
 *  3. Query NotebookLM for evidence on each category
 *  4. Score with gpt-oss-120b structured output (128k context)
 *  5. Persist to D1: role_analyses + role_alignment_scores
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db";
import { globalConfig, roleAlignmentScores, roleAnalyses, roles } from "../../db/schema";
import { generateStructuredOutput } from "../providers";
import { consultNotebook } from "../tools/notebooklm";
import { getActiveBullets } from "./draft";

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

/** Schema for the extracted job posting requirements, used in step 2. */
const JobRequirementsSchema = z.object({
  requirements: z.array(z.string()).describe("Mandatory qualifications and requirements"),
  skills: z.array(z.string()).describe("Technical and soft skills listed"),
  desired_traits: z.array(z.string()).describe("Preferred or nice-to-have qualifications"),
  responsibilities: z.array(z.string()).describe("Key job responsibilities"),
});

/** Schema for the full hireability analysis result, used in step 4. */
const RoleAnalysisSchema = z.object({
  hire_likelihood: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Overall likelihood-to-hire score (0–100)"),
  hire_score_rationale: z
    .string()
    .describe("Detailed rationale for the hire score, referencing specific evidence"),
  compensation_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Score comparing role compensation against candidate baseline (0–100)"),
  compensation_score_rationale: z
    .string()
    .describe("Rationale for compensation comparison, factoring base, stock, benefits, bonus"),
  alignment_scores: z.array(
    z.object({
      type: z.enum(["requirement", "skill", "desired_trait", "responsibility"]),
      content: z.string().describe("The requirement/skill text from the job posting"),
      score: z.number().int().min(0).max(100).describe("Alignment score (0–100)"),
      rationale: z.string().describe("Evidence-based explanation of the alignment score"),
    }),
  ),
});

export type RoleAnalysisResult = z.infer<typeof RoleAnalysisSchema>;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Perform a comprehensive hireability analysis for a role.
 *
 * Orchestrates the full pipeline: context loading → requirement extraction →
 * NotebookLM evidence gathering → structured scoring → D1 persistence.
 *
 * @param env - Worker environment bindings
 * @param roleId - The role to analyze
 * @returns The persisted analysis ID
 */
export async function analyzeRole(env: Env, roleId: string): Promise<string> {
  const db = getDb(env);

  // Step 1: Load role context
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) {
    throw new Error(`Role not found: ${roleId}`);
  }

  const jobContent = extractJobContent(role);
  if (!jobContent) {
    throw new Error(`Role ${roleId} has no job posting content to analyze`);
  }

  // Step 2: Extract categorized requirements
  const parsed = await generateStructuredOutput(env, {
    messages: [
      {
        role: "system",
        content:
          "You are a job posting analyzer. Extract all requirements, skills, desired traits, and responsibilities from the job posting below. Be thorough — include every distinct item mentioned.",
      },
      {
        role: "user",
        content: jobContent,
      },
    ],
    schema: JobRequirementsSchema,
    schemaName: "JobRequirements",
    temperature: 0,
  });

  // Step 3: Query NotebookLM for evidence
  const allItems = [
    ...parsed.requirements.map((c) => ({ type: "requirement" as const, content: c })),
    ...parsed.skills.map((c) => ({ type: "skill" as const, content: c })),
    ...parsed.desired_traits.map((c) => ({ type: "desired_trait" as const, content: c })),
    ...parsed.responsibilities.map((c) => ({ type: "responsibility" as const, content: c })),
  ];

  // Step 2b: Fetch configuration keys
  const configRows = await db
    .select({ key: globalConfig.key, value: globalConfig.value })
    .from(globalConfig);

  const defaultsUsed: string[] = [];
  const getConfig = (key: string, fallback: string): string => {
    const row = configRows.find((r) => r.key === key);
    const hasUserValue = typeof row?.value === "string" && row.value.trim() !== "";
    if (!hasUserValue) {
      defaultsUsed.push(key);
    }
    return hasUserValue ? (row!.value as string) : fallback;
  };

  const notebookLmPrompt = getConfig(
    "notebooklm_prompt",
    "Based on my 13 years of performance reviews, accomplishments, and career history, what specific evidence supports my qualification for the following {{label}}s?\n\n{{itemsList}}\n\nFor each item, cite specific examples, metrics, or achievements from my career history. If there is no direct evidence, note the gap honestly.",
  );
  const compensationBaseline = getConfig(
    "compensation_baseline",
    "Previous role at Google: $176,000 base salary",
  );
  const careerStories = getConfig("career_stories", "");

  // Batch queries to NotebookLM — group by type to reduce API calls
  const evidenceByType: Record<string, string> = {};
  const typeGroups = groupBy(allItems, (item) => item.type);

  for (const [type, items] of Object.entries(typeGroups)) {
    const query = buildNotebookQuery(
      type,
      items.map((i) => i.content),
      notebookLmPrompt,
    );
    try {
      const consultation = await consultNotebook(env, query);
      evidenceByType[type] = consultation.answer;
    } catch {
      evidenceByType[type] = "(NotebookLM unavailable — scoring based on resume bullets only)";
    }
  }

  // Step 4: Load resume bullets

  const bullets = await getActiveBullets(env);
  const bulletsContext =
    bullets.length > 0
      ? bullets.map((b) => `[${b.category}] ${b.content}`).join("\n")
      : "(No resume bullets available)";

  // Step 5: Score with gpt-oss-120b
  const analysis = await generateStructuredOutput(env, {
    messages: [
      {
        role: "system",
        content: buildScoringSystemPrompt(compensationBaseline),
      },
      {
        role: "user",
        content: buildScoringUserPrompt(
          jobContent,
          allItems,
          evidenceByType,
          bulletsContext,
          role,
          careerStories,
        ),
      },
    ],
    schema: RoleAnalysisSchema,
    schemaName: "RoleAnalysis",
    temperature: 0,
    max_tokens: 8000,
  });

  // Step 6: Compute version number (count existing analyses for this role + 1)
  const existingAnalyses = await db
    .select({ id: roleAnalyses.id })
    .from(roleAnalyses)
    .where(eq(roleAnalyses.roleId, roleId));
  const nextVersion = existingAnalyses.length + 1;

  // Step 7: Persist to D1
  const analysisId = crypto.randomUUID();

  await db.insert(roleAnalyses).values({
    id: analysisId,
    roleId,
    version: nextVersion,
    hireScore: analysis.hire_likelihood,
    hireRationale: analysis.hire_score_rationale,
    compensationScore: analysis.compensation_score,
    compensationRationale: analysis.compensation_score_rationale,
    configNotebooklmPrompt: notebookLmPrompt,
    configCompensationBaseline: compensationBaseline,
    configCareerStories: careerStories,
    usedDefaults: defaultsUsed.length > 0,
  });

  if (analysis.alignment_scores.length > 0) {
    await db.insert(roleAlignmentScores).values(
      analysis.alignment_scores.map((score) => ({
        id: crypto.randomUUID(),
        analysisId,
        roleId,
        type: score.type,
        content: score.content,
        score: score.score,
        rationale: score.rationale,
      })),
    );
  }

  return analysisId;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract job posting text from the role's metadata or roleInstructions.
 */
function extractJobContent(role: typeof roles.$inferSelect): string | null {
  const meta = role.metadata;

  // Try metadata.jobDescription first, then metadata.rawHtml/rawText
  if (meta) {
    if (typeof meta.jobDescription === "string" && meta.jobDescription.length > 0) {
      return meta.jobDescription;
    }
    if (typeof meta.rawText === "string" && meta.rawText.length > 0) {
      return meta.rawText;
    }
    if (typeof meta.rawHtml === "string" && meta.rawHtml.length > 0) {
      return meta.rawHtml;
    }
  }

  // Fall back to roleInstructions if it contains a pasted job posting
  if (role.roleInstructions && role.roleInstructions.length > 100) {
    return role.roleInstructions;
  }

  return null;
}

/**
 * Build a targeted NotebookLM query for a specific category of requirements.
 */
function buildNotebookQuery(type: string, items: string[], promptTemplate: string): string {
  const label = type.replace(/_/g, " ");
  const itemsList = items.map((item, i) => `${i + 1}. ${item}`).join("\n");

  return promptTemplate.replace("{{label}}", label).replace("{{itemsList}}", itemsList);
}

/**
 * Build the system prompt for the scoring step.
 */
function buildScoringSystemPrompt(compensationBaseline: string): string {
  return [
    "You are an expert career analyst performing a hireability assessment.",
    "",
    "You will receive:",
    "1. A job posting with requirements, skills, desired traits, and responsibilities",
    "2. Evidence from the candidate's 13-year career history (via NotebookLM)",
    "3. The candidate's verified resume accomplishments",
    "",
    "Score each item individually (0–100) based on evidence strength:",
    "- 75–100 (Strong Alignment): Direct, verifiable evidence of capability",
    "- 40–74 (Moderate Alignment): Partial evidence or transferable experience",
    "- 0–39 (Gap Identified): Little to no evidence; candidate needs to position differently",
    "",
    `Compensation baseline for comparison: ${compensationBaseline}`,
    "",
    "Be honest and evidence-based. Cite specific examples in your rationale.",
    "For the overall hire_likelihood, weight requirements and responsibilities more heavily than desired_traits.",
    "For compensation_score, 50 = equivalent, >50 = role pays more, <50 = role pays less.",
  ].join("\n");
}

/**
 * Build the user prompt with all context for the scoring step.
 */
function buildScoringUserPrompt(
  jobContent: string,
  allItems: Array<{ type: string; content: string }>,
  evidenceByType: Record<string, string>,
  bulletsContext: string,
  role: typeof roles.$inferSelect,
  careerStories: string,
): string {
  const sections = [
    `## Job Posting: ${role.jobTitle} at ${role.companyName}`,
    jobContent,
    "",
    "## Categorized Requirements",
    ...allItems.map((item) => `- [${item.type}] ${item.content}`),
    "",
    "## Evidence from Career History (NotebookLM)",
    ...Object.entries(evidenceByType).map(
      ([type, evidence]) => `### ${type.replace(/_/g, " ")}\n${evidence}`,
    ),
    "",
  ];

  if (careerStories) {
    sections.push("## Career Stories", careerStories, "");
  }

  sections.push("## Verified Resume Accomplishments", bulletsContext);

  if (role.salaryMin || role.salaryMax) {
    sections.push(
      "",
      "## Salary Information",
      `Range: ${role.salaryCurrency ?? "USD"} ${role.salaryMin ?? "?"} – ${role.salaryMax ?? "?"}`,
    );
  }

  return sections.join("\n");
}

/**
 * Group an array by a key function.
 */
function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    (groups[key] ??= []).push(item);
  }
  return groups;
}
