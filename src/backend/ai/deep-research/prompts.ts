/**
 * @fileoverview Prompt builders for the deep-research engine.
 *
 * Faithful TypeScript ports of the Google ADK deep-research agent prompts
 * (`plan_generator`, `section_planner`, `section_researcher`,
 * `research_evaluator`, `enhanced_search_executor`, `report_composer`),
 * adapted to non-interactive use: there is no user in the loop, so the
 * interactive-planner refinement rules and the QNA stage are dropped and the
 * plan is auto-approved as written.
 *
 * House rule: every prompt is an ES6 backtick template literal with real
 * newlines — never `.join("\n")` or string concatenation. List blocks are
 * built with the {@link bulletLines} loop-template-literal pattern (the same
 * pattern `ShowroomResearchAgent/methods/deep-sweep.ts` uses).
 */

/** Render values as a markdown bullet list without `.join()` / concatenation. */
function bulletLines(values: string[]): string {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  if (clean.length === 0) return "- none";

  let output = "";
  for (const value of clean) {
    output = `${output}- ${value}
`;
  }
  return output.trimEnd();
}

/** Optional domain-guidance block woven into plan + research prompts. */
function guidanceBlock(guidance: string | undefined): string {
  if (!guidance?.trim()) return "";
  return `
**DOMAIN GUIDANCE (weave these priorities into your work):**
${guidance.trim()}
`;
}

// ---------------------------------------------------------------------------
// 1. plan_generator — 5 [RESEARCH] goals + [DELIVERABLE][IMPLIED] extras
// ---------------------------------------------------------------------------

/**
 * Port of the ADK `plan_generator` instruction. Non-interactive adaptation:
 * the "RESEARCH PLAN (SO FAR)" refinement rules are dropped (no user feedback
 * exists) and the plan is auto-approved, so the model is told to output only
 * the plan with no questions back.
 */
export function planGeneratorPrompt(args: {
  topic: string;
  guidance?: string;
  maxGoals: number;
  currentDate: string;
}): string {
  return `You are a research strategist. Your job is to create a high-level RESEARCH PLAN, not a summary. The plan will be executed automatically by downstream research agents with no human in the loop, so it must stand entirely on its own.

RESEARCH TOPIC:
${args.topic}
${guidanceBlock(args.guidance)}
**GENERAL INSTRUCTION: CLASSIFY TASK TYPES**
Your plan must clearly classify each goal for downstream execution. Each bullet point must start with a task-type prefix:
- **[RESEARCH]**: for goals that primarily involve information gathering, investigation, analysis, or data collection (e.g., "[RESEARCH] Analyze historical trends in...").
- **[DELIVERABLE]**: for goals that involve synthesizing collected information, creating structured outputs, or compiling final artifacts (e.g., "[DELIVERABLE] Create a comparison table of...").

**INITIAL RULE: Your output MUST start with a bulleted list of ${args.maxGoals} action-oriented research goals or key questions, followed by any *inherently implied* deliverables.**
- All initial ${args.maxGoals} goals must be classified as [RESEARCH].
- A good [RESEARCH] goal starts with a verb like "Analyze," "Identify," "Investigate."
- A goal that is *inherently implied* by the research topic (e.g., producing a comparison table when the topic asks to compare options) must be appended after the research goals and prefixed **[DELIVERABLE][IMPLIED]**.

**TOOL USE IS STRICTLY PROHIBITED:**
Your goal is to create a generic, high-quality plan *without searching the web*. Work only from the research topic and guidance above. Do not use any tools.

**OUTPUT:** Output only the bulleted plan. No preamble, no commentary, and no questions back to the user — the plan is auto-approved exactly as written.

Current date: ${args.currentDate}`;
}

// ---------------------------------------------------------------------------
// 2. section_planner — 4-6 section markdown outline
// ---------------------------------------------------------------------------

/** Port of the ADK `section_planner` instruction (unchanged semantics). */
export function sectionPlannerPrompt(args: {
  topic: string;
  plan: string;
}): string {
  return `You are an expert report architect. Using the research topic and the research plan below, design a logical structure for the final report.

Note: Ignore all tag names ([RESEARCH], [DELIVERABLE], [IMPLIED]) in the research plan — they are execution metadata, not content.

RESEARCH TOPIC:
${args.topic}

RESEARCH PLAN:
${args.plan}

Your task is to create a markdown outline with 4-6 distinct sections that cover the topic comprehensively without overlap.

You can use any markdown format you prefer, but here is a suggested structure:

# Section Name

A brief overview of what this section covers.

Feel free to add subsections or bullet points if needed to better organize the content. Make sure your outline is clear and easy to follow.

Do not include a "References" or "Sources" section in your outline. Citations will be handled in-line.

Output only the outline.`;
}

// ---------------------------------------------------------------------------
// 3. section_researcher — grounded two-phase research + synthesis
// ---------------------------------------------------------------------------

/**
 * Port of the ADK `section_researcher` instruction. A single grounded call
 * executes both phases: the `googleSearch` tool lets the model run its own
 * 4-5 targeted queries per [RESEARCH] goal in Phase 1, then Phase 2
 * synthesizes the [DELIVERABLE] goals with no new searches.
 */
export function sectionResearcherPrompt(args: {
  topic: string;
  plan: string;
  guidance?: string;
  currentDate: string;
}): string {
  return `You are a highly capable and diligent research and synthesis agent. Your comprehensive task is to execute the research plan below with **absolute fidelity**: first gather the necessary information, then synthesize it into the specified outputs.

Current date: ${args.currentDate}

RESEARCH TOPIC:
${args.topic}
${guidanceBlock(args.guidance)}
RESEARCH PLAN (each goal is prefixed [RESEARCH] or [DELIVERABLE]):
${args.plan}

Your execution process must strictly adhere to these two distinct and sequential phases:

---

**Phase 1: Information Gathering ([RESEARCH] tasks)**

- **Execution Directive:** You MUST systematically process every single goal prefixed with [RESEARCH].
- **Query Generation:** For each [RESEARCH] goal, formulate a comprehensive set of 4-5 targeted search queries designed to cover the goal from multiple angles.
- **Execution:** Use your Google Search tool to execute all generated queries.
- **Summarization:** Synthesize the search results into a detailed, coherent summary for each goal, grounded strictly in the sources you actually retrieved — never your internal knowledge.

**Phase 2: Synthesis and Output Creation ([DELIVERABLE] tasks)**

- **Execution Directive:** Once ALL [RESEARCH] goals are complete, you MUST address every goal prefixed with [DELIVERABLE]. Do NOT run any new searches in this phase — work only from the Phase 1 summaries.
- **Instruction Adherence:** Treat each [DELIVERABLE] goal's description as precise, non-negotiable instructions.
- **Data Integration:** Explicitly and accurately use the summarized information gathered in Phase 1.
- **Output Generation:** Produce the specified deliverable artifacts (detailed summaries, comparison tables, timelines, etc.).

---

**FINAL OUTPUT:** One complete markdown document containing the Phase 1 research summaries (organized per goal) followed by the Phase 2 deliverables. Present only grounded, verifiable findings — no meta-commentary about your process.`;
}

// ---------------------------------------------------------------------------
// 4. research_evaluator — critic returning the Feedback JSON
// ---------------------------------------------------------------------------

/**
 * Port of the ADK `research_evaluator` instruction. This step needs no search
 * grounding, so the caller uses `responseMimeType: "application/json"`
 * (Gemini cannot combine `googleSearch` grounding with structured output) and
 * the expected output shape is described in the prompt body.
 */
export function researchEvaluatorPrompt(args: {
  topic: string;
  findings: string;
  currentDate: string;
}): string {
  return `You are a meticulous quality assurance analyst evaluating the research findings below for the given topic.

Current date: ${args.currentDate}

RESEARCH TOPIC:
${args.topic}

RESEARCH FINDINGS TO EVALUATE:
${args.findings}

**CRITICAL RULES:**
1. Assume the given research topic is correct. Do not question or try to verify the subject itself.
2. Your ONLY job is to assess the quality, depth, and completeness of the research provided *for that topic*.
3. Focus on evaluating: comprehensiveness of coverage, logical flow and organization, use of credible sources, depth of analysis, and clarity of explanations.
4. Do NOT fact-check or question the fundamental premise or timeline of the topic.
5. If suggesting follow-up queries, they must dive deeper into the existing topic, not question its validity.

Be very critical about the QUALITY of the research. If you find significant gaps in depth or coverage, assign a grade of "fail", write a detailed comment about what is missing, and generate 5-7 specific follow-up queries to fill those gaps. If the research thoroughly covers the topic, grade "pass".

Your response must be a single, raw JSON object with exactly these keys:
{
  "grade": "pass" or "fail",
  "comment": "detailed explanation of the evaluation, highlighting specific strengths and gaps",
  "follow_up_queries": ["specific query 1", "specific query 2"] or null
}

"follow_up_queries" MUST be null when the grade is "pass", and MUST contain 5-7 specific search queries when the grade is "fail". Output only the JSON object — no markdown fences, no other text.`;
}

// ---------------------------------------------------------------------------
// 5. enhanced_search_executor — grounded refinement pass
// ---------------------------------------------------------------------------

/**
 * Port of the ADK `enhanced_search_executor` instruction: executes every
 * follow-up query from the failed evaluation, then outputs a complete,
 * improved findings set that REPLACES the previous one.
 */
export function enhancedSearchPrompt(args: {
  topic: string;
  comment: string;
  followUpQueries: string[];
  findings: string;
  currentDate: string;
}): string {
  return `You are a specialist researcher executing a refinement pass. You have been activated because the previous research was graded as "fail".

Current date: ${args.currentDate}

RESEARCH TOPIC:
${args.topic}

EVALUATOR FEEDBACK (what is missing and must be fixed):
${args.comment}

FOLLOW-UP QUERIES:
${bulletLines(args.followUpQueries)}

EXISTING RESEARCH FINDINGS:
${args.findings}

Your process:
1. Review the evaluator feedback above to understand the required fixes.
2. Execute EVERY query listed under FOLLOW-UP QUERIES using your Google Search tool.
3. Synthesize the new findings and COMBINE them with the existing research findings.
4. Your output MUST be the new, complete, and improved set of research findings — a single markdown document that fully REPLACES the previous findings. Do not output a delta or commentary; output the entire improved findings document.`;
}

// ---------------------------------------------------------------------------
// 6. report_composer — final report with <cite source="src-N" /> tags
// ---------------------------------------------------------------------------

/**
 * Port of the ADK `report_composer_with_citations` instruction
 * (`include_contents="none"` equivalent: the prompt itself carries the plan,
 * findings, outline, and a rendered `src-N: title (url)` source list rather
 * than relying on conversation history).
 */
export function reportComposerPrompt(args: {
  topic: string;
  plan: string;
  outline: string;
  findings: string;
  sourceList: string;
  currentDate: string;
}): string {
  return `Transform the provided research data into a polished, professional, and meticulously cited research report.

Current date: ${args.currentDate}

---
### INPUT DATA

**Research Topic:**
${args.topic}

**Research Plan:**
${args.plan}

**Report Structure (outline — follow it strictly):**
${args.outline}

**Research Findings:**
${args.findings}

**Citation Sources (each line is "shortId: title (url)"):**
${args.sourceList}

---
### CRITICAL: Citation System
To cite a source, you MUST insert a special citation tag directly after the claim it supports.

**The ONLY correct format is:** <cite source="src-ID_NUMBER" />

Example: The company's profits grew by 15 percent last year <cite source="src-1" />.

Do NOT use markdown links, footnotes, numeric brackets, or any other citation style. Only cite short ids that appear in the Citation Sources list above.

---
### Final Instructions
Generate a comprehensive markdown report using ONLY the <cite source="src-N" /> tag system for all citations.
The report must strictly follow the structure provided in the Report Structure outline — same sections, same order, no additions or removals.
Every distinct factual claim from the Research Findings should appear in the report, cited where a supporting source exists.
Do not include a "References" or "Sources" section; all citations must be in-line.
Output only the finished markdown report.`;
}
