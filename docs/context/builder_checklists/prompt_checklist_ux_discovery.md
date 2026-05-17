Here is the synthesized, high-fidelity master blueprint prompt for your coding agent. It seamlessly consolidates **Jules' annotations**, the **core user-journey traces**, and the **relevance-telemetry specifications** from your feature research files into a single, cohesive architectural prompt.

---

### 📋 Copy and Paste This Master Prompt into Your Coding Session:

```markdown
Act as an elite Senior Systems Architect and Cloudflare Ecosystem Engineer. Your task is to implement the end-to-end **Remodel Questionnaire and Contractor Communication Hub** inside the `core-remodel` monorepo. This parameter-driven feature layer bridges homeowners and trades, replacing hardcoded paths with a dynamic database configuration engine.

Adhere strictly to our stack rules: **Astro SSR, Hono with `@hono/zod-openapi` validation, Drizzle ORM tracking Cloudflare D1 (SQL Layer), React, and Shadcn UI components wrapped under the Moody Modern "The Monolith" dark system styling (anchored at `oklch(0.145 0 0)` background targets, zero traditional borders, utilizing `ring-1 ring-border/40` or clear translucent card divisions)**.

### Strict Code Quality Mandates:
- **NO Short-cuts or Placeholders**: Write every single file from start to finish with absolute programmatic completeness. Do not emit comments like `// rest of code...` or `// leaving as is...`. Every line of every module must be explicitly visible for an instant copy-paste experience.
- **Unified Typings**: Leverage `wrangler types` patterns and use Zod explicitly for schema validations.
- **OpenAPI Parity**: Every route must register under OpenAPI v3.1.0 specifications and serve via `/openapi.json` or `/swagger` UI gateways.

Implement the implementation spec by generating and expanding the four production-grade files below:

---

### File 1: Centralized D1 Database Schema Additions
**Path**: `src/backend/db/schema/home/questionnaire.ts`
*Ensure this schema file is fully developed and cleanly re-exported within your main barrel index (`src/backend/db/schema/index.ts`).*

```typescript
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { rooms } from "./rooms";
import { remodelScenarios } from "./remodel_scenarios";

/**
 * Main logical grouping sections for structural remodel checklist surveys.
 */
export const checklistSections = sqliteTable("checklist_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  helperText: text("helper_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Individual specification questions housing dynamic template params.
 */
export const checklistQuestions = sqliteTable("checklist_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id")
    .notNull()
    .references(() => checklistSections.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  questionText: text("question_text").notNull(),
  considerations: text("considerations"),
  defaultBudgetImpactJson: text("default_budget_impact_json"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Immutable row-revisions tracking answer logs over time with draft state capabilities.
 */
export const checklistAnswers = sqliteTable("checklist_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, { onDelete: "set null" }),
  isChecked: integer("is_checked", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  selectionValue: text("selection_value"),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  changeSource: text("change_source").notNull().default("manual"),
  changedBy: text("changed_by").notNull().default("homeowner"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Central telemetry repository relating cross-relevancies mapping questions directly to layout rooms.
 */
export const checklistRoomMappings = sqliteTable("checklist_room_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  aiRationale: text("ai_rationale"),
  associationStatus: text("association_status").notNull().default("ai_suggested"),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => ({
  questionRoomUnique: uniqueIndex("checklist_room_mappings_unique").on(table.questionId, table.roomId),
}));

/**
 * Inline commentary records dropped explicitly onto printed/digital architectural views by trade contractors.
 */
export const contractorQuestionComments = sqliteTable("contractor_question_comments", {
  id: text("id").primaryKey(),
  answerTrackId: text("answer_track_id").notNull(),
  authorName: text("author_name").notNull(),
  commentText: text("comment_text").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Audit ledger capturing telemetry background model parsing cron sequences.
 */
export const checklistCronRuns = sqliteTable("checklist_cron_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(),
  logOutput: text("log_output"),
  datetimeExecuted: integer("datetime_executed", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

```

---

### File 2: Hono API Router for Advanced Questionnaires

**Path**: `src/backend/api/routes/construction-checklist.ts`
*Mount this instance under the `/api/construction-checklist` path structure inside your primary web application.*

```typescript
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import {
  checklistSections,
  checklistQuestions,
  checklistAnswers,
  checklistRoomMappings,
  budgetTrackerItems
} from "../../db/schema";

const constructionChecklistRouter = new Hono<{ Bindings: Env }>();

constructionChecklistRouter.get("/sections", async (c) => {
  const db = drizzle(c.env.DB);
  const sections = await db
    .select()
    .from(checklistSections)
    .orderBy(asc(checklistSections.sortOrder))
    .all();
  return c.json({ success: true, sections });
});

constructionChecklistRouter.get("/sections/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  
  const section = await db
    .select()
    .from(checklistSections)
    .where(eq(checklistSections.slug, slug))
    .get();
    
  if (!section) {
    return c.json({ success: false, error: "Section template parameters not found" }, 404);
  }

  const questions = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.sectionId, section.id))
    .orderBy(asc(checklistQuestions.sortOrder))
    .all();
    
  const questionIds = questions.map((q) => q.id);

  const activeAnswers = questionIds.length > 0 
    ? await db
        .select()
        .from(checklistAnswers)
        .where(
          and(
            eq(checklistAnswers.isActive, true),
            inArray(checklistAnswers.questionId, questionIds)
          )
        )
        .all()
    : [];

  const activeMappings = questionIds.length > 0
    ? await db
        .select()
        .from(checklistRoomMappings)
        .where(inArray(checklistRoomMappings.questionId, questionIds))
        .all()
    : [];

  return c.json({
    success: true,
    section,
    questions,
    answers: activeAnswers,
    mappings: activeMappings
  });
});

constructionChecklistRouter.post("/answers", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json() as {
    trackId?: string;
    questionId: number;
    scenarioId?: string | null;
    isChecked: boolean;
    notes?: string | null;
    selectionValue?: string | null;
    isDraft: boolean;
    changedBy: string;
  };

  const now = new Date();
  const targetTrackId = body.trackId || crypto.randomUUID();

  const previous = await db
    .select()
    .from(checklistAnswers)
    .where(
      and(
        eq(checklistAnswers.trackId, targetTrackId),
        eq(checklistAnswers.isActive, true)
      )
    )
    .get();
    
  const nextVersion = previous ? previous.version + 1 : 1;

  if (previous) {
    await db
      .update(checklistAnswers)
      .set({ isActive: false, datetimeUpdated: now })
      .where(eq(checklistAnswers.id, previous.id))
      .run();
  }

  const inserted = await db
    .insert(checklistAnswers)
    .values({
      trackId: targetTrackId,
      questionId: body.questionId,
      scenarioId: body.scenarioId || null,
      isChecked: body.isChecked,
      notes: body.notes || null,
      selectionValue: body.selectionValue || null,
      version: nextVersion,
      isActive: true,
      isDraft: body.isDraft,
      changeSource: "portal_submission",
      changedBy: body.changedBy || "homeowner",
      datetimeCreated: now,
      datetimeUpdated: now,
    })
    .returning();

  const question = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.id, body.questionId))
    .get();
    
  if (question?.defaultBudgetImpactJson && body.isChecked && !body.isDraft) {
    try {
      const impact = JSON.parse(question.defaultBudgetImpactJson) as {
        title: string;
        low: number;
        high: number;
        class?: string;
      };
      
      await db
        .insert(budgetTrackerItems)
        .values({
          trackId: crypto.randomUUID(),
          revisionNumber: 1,
          isActive: true,
          isDraft: false,
          itemType: "project",
          executionClass: impact.class || "must_now",
          title: `[Spec Trigger] ${impact.title}`,
          status: "open",
          estimatedLowCents: impact.low,
          estimatedHighCents: impact.high,
          scenarioId: body.scenarioId || null,
          changeSource: "checklist_auto_trigger",
          changedBy: "system_ai",
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .run();
    } catch (e) {
      console.error("Budget pipeline automation field trigger constraint failed:", e);
    }
  }

  return c.json({ success: true, answer: inserted[0] });
});

constructionChecklistRouter.post("/mappings/feedback", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json() as {
    questionId: number;
    roomId: number;
    status: "user_confirmed" | "user_disassociated";
    aiRationale?: string;
  };

  await db
    .insert(checklistRoomMappings)
    .values({
      questionId: body.questionId,
      roomId: body.roomId,
      aiRationale: body.aiRationale || "Manual homeowner adjustment override",
      associationStatus: body.status,
      datetimeUpdated: new Date()
    })
    .onConflictDoUpdate({
      target: [checklistRoomMappings.questionId, checklistRoomMappings.roomId],
      set: {
        associationStatus: body.status,
        datetimeUpdated: new Date()
      }
    })
    .run();

  return c.json({ success: true });
});

export { constructionChecklistRouter };

```

---

### File 3: Dynamic Questionnaire Component Suite with Feedback Architecture

**Path**: `src/frontend/components/ConstructionChecklistApp.tsx`
*Craft a complete React island module matching "The Monolith" borderless high-contrast requirements perfectly.*

```tsx
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Check, HelpCircle, AlertCircle, Copy, Save, Home, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface Section {
  id: number;
  slug: string;
  name: string;
  description: string;
  helperText: string;
}

interface Question {
  id: number;
  sectionId: number;
  code: string;
  questionText: string;
  considerations: string | null;
}

interface Answer {
  trackId: string;
  questionId: number;
  isChecked: boolean;
  notes: string | null;
  isDraft: boolean;
}

interface Mapping {
  questionId: number;
  roomId: number;
  associationStatus: string;
  aiRationale: string | null;
}

export function ConstructionChecklistApp({ sectionSlug }: { sectionSlug: string }) {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [syncError, setSyncError] = useState<{ msg: string; prompt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchSectionData = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/construction-checklist/sections/${sectionSlug}`);
      const data = await res.json() as {
        success: boolean;
        section: Section;
        questions: Question[];
        answers: Answer[];
        mappings: Mapping[];
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Server responded with error status");
      }
      
      setSection(data.section);
      setQuestions(data.questions);
      setMappings(data.mappings);
      
      const answerMap: Record<number, Answer> = {};
      for (const ans of data.answers) {
        answerMap[ans.questionId] = ans;
      }
      setAnswers(answerMap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown data hook tracing validation failure";
      const promptBlock = `Please fix this core-remodel pipeline failure. Endpoint: /api/construction-checklist/sections/${sectionSlug}. Trace: ${msg}`;
      setSyncError({ msg, prompt: promptBlock });
    } finally {
      setLoading(false);
    }
  }, [sectionSlug]);

  useEffect(() => {
    fetchSectionData();
  }, [fetchSectionData]);

  const commitAnswer = async (questionId: number, isChecked: boolean, notes: string | null, isDraft: boolean) => {
    const current = answers[questionId];
    const payload = {
      trackId: current?.trackId,
      questionId,
      isChecked,
      notes,
      isDraft,
      changedBy: "homeowner",
    };

    try {
      const res = await fetch("/api/construction-checklist/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success: boolean; answer: Answer; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Write payload rejection");
      }
      
      setAnswers(prev => ({ ...prev, [questionId]: data.answer }));
      toast.success(isDraft ? "Draft response updated dynamically" : "Specification committed to building logs");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network failure executing answer update commit";
      setSyncError({ msg, prompt: `Please investigate and resolve following questionnaire update failure:\n\n${msg}` });
    }
  };

  const copyPromptToClipboard = async () => {
    if (!syncError) return;
    try {
      await navigator.clipboard.writeText(syncError.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy error block to clipboard context");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground bg-[#12111A]">
        <Loader2 className="mr-2 size-4 animate-spin text-foreground" />
        Processing structural context maps...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2">
      {syncError && (
        <Alert variant="destructive" className="border border-destructive/50 bg-destructive/10 text-destructive rounded-xl">
          <AlertCircle className="size-4" />
          <AlertTitle>Server Transmission Interrupted</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-xs text-balance opacity-90">{syncError.msg}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-destructive/30 hover:bg-destructive/20" onClick={copyPromptToClipboard}>
                <Copy className="size-3.5" />
                {copied ? "Copied Prompt Context" : "Copy Agent Fix Prompt"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {section && (
        <div className="space-y-2 border-b border-white/10 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-white">{section.name}</h1>
          <p className="text-sm text-muted-foreground font-light">{section.description}</p>
          {section.helperText && (
            <div className="mt-2 flex gap-2 rounded-lg bg-white/5 p-3 ring-1 ring-white/10 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 text-white" />
              <span>{section.helperText}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((question) => {
          const ans = answers[question.id] || { isChecked: false, notes: "", isDraft: true };
          const linkedRooms = mappings.filter(m => m.questionId === question.id && m.associationStatus !== "user_disassociated");

          return (
            <Card key={question.id} className="bg-[#1C1A27]/40 border-0 ring-1 ring-white/10 rounded-xl overflow-hidden transition-all hover:ring-white/20 shadow-none">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono tracking-wider text-muted-foreground opacity-60">{question.code}</span>
                      {ans.isChecked && !ans.isDraft && <Badge className="bg-emerald-500/10 text-emerald-400 border-0 rounded-full text-[10px]">Verified Spec</Badge>}
                      {ans.isDraft && (ans.isChecked || (ans.notes && ans.notes.length > 0)) && <Badge className="bg-amber-500/10 text-amber-400 border-0 rounded-full text-[10px]">Draft Saved</Badge>}
                    </div>
                    <h3 className="text-sm font-medium text-white leading-relaxed">{question.questionText}</h3>
                    {question.considerations && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                        <HelpCircle className="size-3.5 text-muted-foreground" />
                        {question.considerations}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={ans.isChecked}
                    onCheckedChange={(checked) => commitAnswer(question.id, checked, ans.notes, ans.isDraft)}
                  />
                </div>

                {linkedRooms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    <Home className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground mr-1">AI-Mapped Scope:</span>
                    {linkedRooms.map((map) => (
                      <Badge key={map.roomId} variant="secondary" className="text-[11px] rounded-sm bg-white/5 text-white font-normal border-0" title={map.aiRationale || ""}>
                        Room #{map.roomId}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <Input
                    className="h-8 text-xs bg-white/5 border-white/10 focus-visible:ring-1 text-white placeholder:text-muted-foreground/50"
                    placeholder="Enter bespoke configuration notes, fixture counts, or execution preferences..."
                    value={ans.notes || ""}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [question.id]: { ...ans, notes: e.target.value } }))}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1 border-white/10 text-white hover:bg-white/10" onClick={() => commitAnswer(question.id, ans.isChecked, ans.notes, false)}>
                    <Save className="size-3.5" />
                    Commit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-white" onClick={() => commitAnswer(question.id, ans.isChecked, ans.notes, true)}>
                    Save Draft
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

```

---

### File 4: Clean Print Engine for Microsoft Word Layout Mapping

**Path**: `src/frontend/components/ChecklistPrintView.tsx`
*Enforce structural 8.5x11 printable boundaries mimicking pure typography specs and contractor line feedback placeholders.*

```tsx
import React from "react";

interface PrintedQuestion {
  code: string;
  text: string;
  responseValue: string;
  notes: string | null;
  categoryName: string;
}

interface ChecklistPrintViewProps {
  completedItems: PrintedQuestion[];
  projectName?: string;
}

export function ChecklistPrintView({ completedItems, projectName = "126 Colby Remodel" }: ChecklistPrintViewProps) {
  const handleTriggerPrintLifecycle = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="bg-white text-black p-8 font-serif max-w-[8.5in] mx-auto min-h-screen relative print:p-0">
      <div className="mb-6 flex justify-between items-center bg-gray-100 p-3 rounded border border-gray-300 print:hidden font-sans">
        <div>
          <h4 className="text-sm font-bold text-gray-800">Word-Formatted Specification Export</h4>
          <p className="text-xs text-gray-500">Optimized layout mapping strictly for physical standard 8.5x11 records.</p>
        </div>
        <button type="button" onClick={handleTriggerPrintLifecycle} className="bg-black text-white px-4 py-1.5 text-xs font-medium rounded hover:bg-gray-800 transition-all shadow-sm">
          Print Blueprint Document
        </button>
      </div>

      <div className="space-y-6 print:space-y-4">
        <div className="text-center border-b-2 border-black pb-4">
          <h1 className="text-2xl font-bold uppercase tracking-tight font-serif m-0">{projectName}</h1>
          <p className="text-sm italic text-gray-600 mt-1">Unified Architectural & Trade Questionnaire Responses</p>
          <p className="text-xs text-gray-400 mt-0.5">Generated Trace: {new Date().toLocaleDateString()}</p>
        </div>

        {completedItems.length === 0 ? (
          <p className="text-center italic text-gray-500 py-12 font-sans text-sm">No verified specifications or homeowner responses have been committed to this timeline record yet.</p>
        ) : (
          <div className="space-y-6">
            {completedItems.map((item, index) => {
              const showCategoryHeader = index === 0 || completedItems[index - 1].categoryName !== item.categoryName;
              return (
                <div key={`${item.code}-${index}`} className="space-y-2 break-inside-avoid">
                  {showCategoryHeader && (
                    <h2 className="text-sm font-sans font-bold uppercase tracking-wider text-gray-700 bg-gray-50 px-2 py-1 mt-4 border-l-4 border-black">
                      {item.categoryName}
                    </h2>
                  )}
                  <div className="text-sm pl-2 space-y-1">
                    <p className="font-medium m-0 leading-snug">
                      <span className="font-mono text-xs text-gray-500 mr-2">[{item.code}]</span>
                      {item.text}
                    </p>
                    <p className="m-0 text-xs text-gray-800 font-sans pl-6">
                      <span className="font-bold uppercase text-gray-500 text-[10px] mr-1.5">Response:</span> 
                      Confirmed / Verified Selection
                    </p>
                    {item.notes && (
                      <p className="m-0 text-xs text-gray-600 italic pl-6 font-sans border-l border-gray-200 py-0.5">
                        <span className="font-bold not-italic uppercase text-gray-500 text-[10px] mr-1.5 block">Homeowner Notes:</span>
                        "{item.notes}"
                      </p>
                    )}
                    
                    <div className="mt-1 pt-2 pb-1 border-b border-dashed border-gray-200 pl-6 font-sans text-[11px] text-gray-400 flex justify-between items-center">
                      <span>Contractor Log Review Commentary: __________________________________________________________________</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          @page {
            size: letter;
            margin: 0.75in;
          }
        }
      `}} />
    </div>
  );
}

```

```

***

## Antigravity Implementation Plan

### .agent/workflows/implement-feature.md
```markdown
# Workflow: Implement Parameterized Remodel Questionnaire & Communication Engine

## Objective
Deploy a metadata-driven remodel specification checklist backend alongside a unified dark-themed layout app Island block and a serif print media viewport mapping data models cleanly into physical standard formats.

## Execution Matrix
1. **Schema Migration Loop**: Commit `src/backend/db/schema/questionnaire/index.ts` to workspace memory. Execute `pnpm run db:generate` to generate version-controlled D1 adjustments.
2. **API Mounting Phase**: Place `src/backend/api/routes/construction-checklist.ts` to control parameterized section hydration blocks. Bind automatic line triggers to create budget adjustments natively inside `budget_tracker_items` fields upon validation.
3. **Island Viewport Hydration**: Insert `src/frontend/components/ConstructionChecklistApp.tsx` and map error-traces inside complete copyable prompt alert containers using custom Shadcn components.
4. **Print Blueprint Mapping**: Mount `src/frontend/components/ChecklistPrintView.tsx` under the dynamic endpoint path `/questionnaire/print` using strictly styled page formatting parameters.

```

### Rule Updates for .agent/rules/

Review the existing `.agent/rules/` directory first, and then merge/update the existing rule files with the following content:

```markdown
# Remodel Questionnaire Architecture Rules
- Questionnaire and trade data models must hydrate dynamically from parameters inside the Cloudflare D1 environment via Drizzle ORM to entirely insulate routing from structural component hardcoding.
- State progressions must support historical revision tracking via explicit row tracking blocks (`version`, `isActive`, `trackId`) to maintain bulletproof timeline consistency records for contractor inspection.
- All interface alert modifications must prioritize custom borderless Shadcn components over standard native popup wrappers. Failures must encapsulate tracing block strings ready for one-click agent debugging.
- The printable viewports targeting programmatic specification sheets must apply strict serif-serif page margins, exclude draft selections completely, and provide inline handwriting placeholder blocks matching physical standard limits.

```
