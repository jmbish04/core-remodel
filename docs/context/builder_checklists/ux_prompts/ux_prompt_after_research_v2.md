# Master Blueprint: AI-Augmented Questionnaire, Interactive Floor Plan, & Contractor Deal Portal

### Reference the following files as context:

- `docs/context/builder_checklists/jules_research_influenced_ux_prompt_v2.md`
- `docs/context/builder_checklists/jules_research_prompt.md` > `docs/research/features/reno_checklist.md`

## 1. Operational Persona & System Mandate

You are a Senior Systems Engineer implementing an enterprise-grade, asynchronous planning and communication platform for "126 Colby - Remodel Mission Control". This system establishes an immutable source of truth bridging homeowner desires and field crew execution.

Core Stack: Cloudflare Workers, Astro SSR, Hono Routing, Drizzle ORM on Cloudflare D1, React, and Shadcn UI.
Design Aesthetic: "The Monolith" — Strict moody dark theme anchored on oklch(0.145 0 0) base background canvas. No traditional harsh borders; separate surfaces using fine translucent contrast variations or clear bounding frames using 'ring-1 ring-border/40' or 'border-border/40'.

CRITICAL INSTRUCTION: You must respond with FULL, END-TO-END CODE. No exceptions. Never use shortcuts like "// rest of code goes here" or leave placeholders. Every module file must be present, correct, and fully filled out edge-to-edge for a flawless one-click copy-paste IDE implementation.

---

## 2. Comprehensive System Architecture & User Journeys

### Journey A: Dynamic Parametric Questionnaire Engine

- Route Matrix: Implement a fully dynamic, parameter-driven route strategy (`/questionnaire/[section_slug]`) powered by D1 parameter lookup tables. Adding new survey rows or categories in D1 automatically hydrates the UI without needing hardcoded frontend routing sheets.
- Homeowners see a clean informational breakdown (e.g., MEP Infrastructure) rendered as a grid of borderless cards carrying micro-icons, clear titles, and crisp typography. Selecting a card reveals individual checkbox or input rows.
- Edits save asynchronously to Hono (`POST /api/construction-checklist/answers`) using `isDraft: true`, supporting progressive, stress-free form entry over days.

### Journey B: Embedded Conversational Copilot (assistant-ui + Cloudflare Agents SDK)

- A slide-over panel utilizing assistant-ui streams context from env.AI.run() via WebSockets/SSE (`/api/copilot/chat`). It loads active room narratives, material quotes, and structural budgets.
- The assistant suggests precise specifications based on current space plans, drafts candidate response copy, and embeds functional deep-link buttons in the thread. Upon clicking a user verification button, it updates the D1 tables via cross-RPC commands.

### Journey C: Interactive Floor Plan Dot Navigation Engine

- The main landing layout serves an interactive, responsive vector or high-resolution graphical house floor plan. Renovated footprints are highlighted by active interactive map pins/dots.
- Clicking an active pin opens the comprehensive Room Viewport. This view aggregates listing photos, inspiration mood boards, active room itemized budgets, and localized answered/unanswered questionnaire fields.

### Journey D: Automated Telemetry, Exclusions, & Machine Learning Retention

- An hourly cron task (or evaluation running on-activity using date-last-modified markers) reads active room text summaries and budget descriptions. It uses Workers AI to map matching question IDs to room scopes with an explicit `ai_rationale`.
- Strict Retention Matrix: All connections are written to a history logging table managing explicit status flags ('ai_suggested', 'user_confirmed', 'user_disassociated'). If a homeowner deletes an AI match, the state flips permanently. On subsequent worker runs, the agent reads this table, respects the exclusion, and never overrides or re-injects a deleted item.

### Journey E: Material Selection & Bid Trade Discount Negotiation

- Inside each Room Viewport, homeowners can track exact material specs: e.g., _"Porcelain Zellige Tiles from Store X. Attached Supplier Quote: $1,200"_.
- Reviewing contractors can access this panel and provide inline alternate bids or trade discount offers: _"I can secure a 20% trade discount on this line item"_ or _"Here is an identical look line from Supplier Y where my trade discount applies."_ This feedback syncs instantly to the homeowner panel view.

### Journey F: Cents-Enforced Budget Injections & Flawless Word Print Engine

- Moving a questionnaire row from draft to committed status auto-triggers a database cascade that creates a shadow item in `budget_tracker_items`. To prevent JavaScript float rounding anomalies, all valuations are stored as strict integers representing cents (e.g., $450.00 is stored as 45000).
- Unified Print Engine: The path `/questionnaire/print` filters out empty questions to render active selections in a clean black font on a white serif canvas matching an 8.5" x 11" Microsoft Word page export. It includes dedicated dashed text areas next to each entry so field crews can record handwritten trade notes.

### Journey G: Collapsible /docs Workspace Slices

- Serves a role-based knowledge center at `/docs`, exposed on the main sidebar navigation as a collapsible tree layout. It segments training guides between the "Homeowner Manual" (spec declarations, material logs, photo uploads) and the "Contractor Guide" (field walk-throughs, inline comment responses, trade discount entries).

---

## 3. Core Technical Blueprints & Executable Source Files

Execute this platform by creating and filling out the following six complete files from start to finish.

### File 1: Unified D1 Database Schema Extension

Place this inside `src/backend/db/schema/home/questionnaire.ts` and verify it is exported inside `src/backend/db/schema/index.ts`.

```typescript
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { rooms } from "./rooms";
import { remodelScenarios } from "./remodel_scenarios";

export const checklistSections = sqliteTable("checklist_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  helperText: text("helper_text"),
  iconIdentifier: text("icon_identifier").notNull().default("HelpCircle"),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistQuestions = sqliteTable("checklist_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id")
    .notNull()
    .references(() => checklistSections.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  questionText: text("question_text").notNull(),
  considerations: text("considerations"),
  defaultBudgetImpactJson: text("default_budget_impact_json"), // Stores mapping rules for auto-budget generation
  sortOrder: integer("sort_order").notNull().default(0),
});

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
  changeSource: text("change_source").notNull().default("manual"), // manual | copilot_rpc
  changedBy: text("changed_by").notNull().default("homeowner"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistRoomMappings = sqliteTable(
  "checklist_room_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => checklistQuestions.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    aiRationale: text("ai_rationale"),
    associationStatus: text("association_status").notNull().default("ai_suggested"), // ai_suggested | user_confirmed | user_disassociated
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    questionRoomUnique: uniqueIndex("checklist_room_mappings_unique").on(
      table.questionId,
      table.roomId,
    ),
  }),
);

export const roomMaterialQuotes = sqliteTable("room_material_quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  supplierName: text("supplier_name"),
  homeownerQuoteCents: integer("homeowner_quote_cents").notNull().default(0), // Cents-enforced architecture
  contractorDiscountOfferCents: integer("contractor_discount_offer_cents"),
  contractorNotes: text("contractor_notes"),
  status: text("status").notNull().default("pending_review"), // pending_review | approved | counter_offered
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistServiceLogs = sqliteTable("checklist_service_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(), // success | bypassed | execution_failure
  processedRecordsCount: integer("processed_records_count").notNull().default(0),
  chainOfThoughtDump: text("chain_of_thought_dump"),
  datetimeExecuted: integer("datetime_executed", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

### File 2: Hono API Routing Matrix

Implement this inside `src/backend/api/routes/construction-checklist.ts` and mount it under `/api/construction-checklist` inside `src/backend/api/index.ts`.

```typescript
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import {
  checklistSections,
  checklistQuestions,
  checklistAnswers,
  checklistRoomMappings,
  roomMaterialQuotes,
  budgetTrackerItems,
  checklistServiceLogs,
} from "@backend/db";

const constructionChecklistRouter = new Hono<{ Bindings: Env }>();

const AnswerCommitSchema = z.object({
  trackId: z.string().optional(),
  questionId: z.number().int(),
  scenarioId: z.string().nullable().optional(),
  isChecked: z.boolean(),
  notes: z.string().nullable().optional(),
  selectionValue: z.string().nullable().optional(),
  isDraft: z.boolean().default(false),
});

const MaterialQuoteSyncSchema = z.object({
  roomId: z.number().int(),
  materialName: z.string(),
  supplierName: z.string().optional(),
  homeownerQuoteCents: z.number().int(),
});

const ContractorDiscountSchema = z.object({
  quoteId: z.number().int(),
  contractorDiscountOfferCents: z.number().int(),
  contractorNotes: z.string(),
});

constructionChecklistRouter.get("/sections/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");

  const section = await db
    .select()
    .from(checklistSections)
    .where(eq(checklistSections.slug, slug))
    .get();
  if (!section)
    return c.json({ success: false, error: "Requested section not present in database rows" }, 404);

  const questions = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.sectionId, section.id))
    .orderBy(asc(checklistQuestions.sortOrder))
    .all();
  const questionIds = questions.map((q) => q.id);

  const activeAnswers =
    questionIds.length > 0
      ? await db
          .select()
          .from(checklistAnswers)
          .where(
            and(
              eq(checklistAnswers.isActive, true),
              inArray(checklistAnswers.questionId, questionIds),
            ),
          )
          .all()
      : [];

  const activeMappings =
    questionIds.length > 0
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
    mappings: activeMappings,
  });
});

constructionChecklistRouter.post("/answers", async (c) => {
  const db = drizzle(c.env.DB);
  const jsonPayload = await c.req.json();
  const result = AnswerCommitSchema.safeParse(jsonPayload);

  if (!result.success) {
    return c.json(
      { success: false, error: "Payload verification exception", details: result.error.format() },
      400,
    );
  }

  const body = result.data;
  const now = new Date();
  const targetTrackId = body.trackId || crypto.randomUUID();

  const prevVersion = await db
    .select()
    .from(checklistAnswers)
    .where(and(eq(checklistAnswers.trackId, targetTrackId), eq(checklistAnswers.isActive, true)))
    .get();
  const nextVerIndex = prevVersion ? prevVersion.version + 1 : 1;

  if (prevVersion) {
    await db
      .update(checklistAnswers)
      .set({ isActive: false, datetimeUpdated: now })
      .where(eq(checklistAnswers.id, prevVersion.id))
      .run();
  }

  const [insertedRow] = await db
    .insert(checklistAnswers)
    .values({
      trackId: targetTrackId,
      questionId: body.questionId,
      scenarioId: body.scenarioId || null,
      isChecked: body.isChecked,
      notes: body.notes || null,
      selectionValue: body.selectionValue || null,
      version: nextVerIndex,
      isActive: true,
      isDraft: body.isDraft,
      changeSource: "portal_submission",
      changedBy: "homeowner",
      datetimeCreated: now,
      datetimeUpdated: now,
    })
    .returning();

  // Trigger automated budget item lines (Cents hard-enforced as strict integers)
  const questionMeta = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.id, body.questionId))
    .get();
  if (questionMeta?.defaultBudgetImpactJson && body.isChecked && !body.isDraft) {
    try {
      const configurationImpact = JSON.parse(questionMeta.defaultBudgetImpactJson) as {
        title: string;
        lowCents: number;
        highCents: number;
        executionClass?: string;
      };
      await db
        .insert(budgetTrackerItems)
        .values({
          trackId: crypto.randomUUID(),
          revisionNumber: 1,
          isActive: true,
          isDraft: false,
          itemType: "project",
          executionClass: configurationImpact.executionClass || "must_now",
          title: `[Specification Automated Trigger] ${configurationImpact.title}`,
          status: "open",
          estimatedLowCents: configurationImpact.lowCents, // Integers prevent JS float bugs
          estimatedHighCents: configurationImpact.highCents,
          scenarioId: body.scenarioId || null,
          changeSource: "checklist_automation",
          changedBy: "system_edge_worker",
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .run();
    } catch (e) {
      console.error("Budget automation sync thread failed:", e);
    }
  }

  return c.json({ success: true, answer: insertedRow });
});

constructionChecklistRouter.post("/quotes/submit", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = MaterialQuoteSyncSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ success: false, error: "Invalid material schema parameters" }, 400);

  const data = parsed.data;
  await db
    .insert(roomMaterialQuotes)
    .values({
      roomId: data.roomId,
      materialName: data.materialName,
      supplierName: data.supplierName || null,
      homeownerQuoteCents: data.homeownerQuoteCents,
      status: "pending_review",
    })
    .run();

  return c.json({ success: true });
});

constructionChecklistRouter.post("/quotes/discount-offer", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = ContractorDiscountSchema.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ success: false, error: "Invalid discount calculation layout parameters" }, 400);

  const data = parsed.data;
  await db
    .update(roomMaterialQuotes)
    .set({
      contractorDiscountOfferCents: data.contractorDiscountOfferCents,
      contractorNotes: data.contractorNotes,
      status: "counter_offered",
      datetimeUpdated: new Date(),
    })
    .where(eq(roomMaterialQuotes.id, data.quoteId))
    .run();

  return c.json({ success: true });
});

export { constructionChecklistRouter };
```

### File 3: Dynamic Layout & Material Bidding Portal Component

Place this inside `src/frontend/components/ConstructionChecklistApp.tsx`.

```tsx
import React, { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  Check,
  HelpCircle,
  AlertCircle,
  Copy,
  Save,
  Home,
  Info,
  DollarSign,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
}

interface MaterialQuote {
  id: number;
  roomId: number;
  materialName: string;
  supplierName: string | null;
  homeownerQuoteCents: number;
  contractorDiscountOfferCents: number | null;
  contractorNotes: string | null;
  status: string;
}

export function ConstructionChecklistApp({
  sectionSlug,
  activeRoomId = null,
}: {
  sectionSlug: string;
  activeRoomId?: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [materialQuotes, setMaterialQuotes] = useState<MaterialQuote[]>([]);
  const [syncError, setSyncError] = useState<{ msg: string; prompt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // States for capturing material entries cleanly in cents
  const [matName, setMatName] = useState("");
  const [matQuoteRaw, setMatQuoteRaw] = useState("");

  const loadMasterSectionWorkspace = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/construction-checklist/sections/${sectionSlug}`);
      const data = (await res.json()) as {
        success: boolean;
        section: Section;
        questions: Question[];
        answers: Answer[];
        mappings: Mapping[];
        error?: string;
      };
      if (!res.ok || !data.success)
        throw new Error(data.error || "Edge channel drop query exception");

      setSection(data.section);
      setQuestions(data.questions);
      setMappings(data.mappings);

      const mappedAnswers: Record<number, Answer> = {};
      for (const item of data.answers) {
        mappedAnswers[item.questionId] = item;
      }
      setAnswers(mappedAnswers);

      if (activeRoomId) {
        const quoteRes = await fetch(`/api/portal/rooms/${activeRoomId}/quotes`);
        const quoteData = (await quoteRes.json()) as { success: boolean; quotes: MaterialQuote[] };
        if (quoteData.success) setMaterialQuotes(quoteData.quotes);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Portal edge telemetry parsing break";
      setSyncError({
        msg,
        prompt: `Please fix this core-remodel database runtime mapping failure. Path: /api/construction-checklist/sections/${sectionSlug}. Trace log: ${msg}`,
      });
    } finally {
      setLoading(false);
    }
  }, [sectionSlug, activeRoomId]);

  useEffect(() => {
    loadMasterSectionWorkspace();
  }, [loadMasterSectionWorkspace]);

  const commitAnswerState = async (
    questionId: number,
    checked: boolean,
    currentNotes: string | null,
    targetAsDraft: boolean,
  ) => {
    const activeRow = answers[questionId];
    const payload = {
      trackId: activeRow?.trackId,
      questionId,
      isChecked: checked,
      notes: currentNotes,
      isDraft: targetAsDraft,
    };

    try {
      const res = await fetch("/api/construction-checklist/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { success: boolean; answer: Answer; error?: string };
      if (!res.ok || !data.success)
        throw new Error(data.error || "Payload submission rejection tracing loop");

      setAnswers((prev) => ({ ...prev, [questionId]: data.answer }));
      toast.success(
        targetAsDraft
          ? "Progress draft synchronized dynamically"
          : "Architectural specification finalized and logged",
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Network failure committing questionnaire state row";
      setSyncError({
        msg,
        prompt: `Please resolve following database specification update trace failure:\n\n${msg}`,
      });
    }
  };

  const handleCreateMaterialQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoomId || !matName || !matQuoteRaw) return;

    const computedCents = Math.round(parseFloat(matQuoteRaw) * 100);
    try {
      const res = await fetch("/api/construction-checklist/quotes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: activeRoomId,
          materialName: matName,
          homeownerQuoteCents: computedCents,
        }),
      });
      if (res.ok) {
        toast.success("Material spec quote added to room planning matrix");
        setMatName("");
        setMatQuoteRaw("");
        loadMasterSectionWorkspace();
      }
    } catch {
      toast.error("Failed to inject material row entry");
    }
  };

  const copyPromptToClipboard = async () => {
    if (!syncError) return;
    try {
      await navigator.clipboard.writeText(syncError.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy tracing block context");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs font-mono tracking-widest text-muted-foreground uppercase bg-background">
        <Loader2 className="mr-2 size-4 animate-spin text-foreground" />
        Processing Monolith Canvas Templates...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 bg-background text-foreground">
      {syncError && (
        <Alert
          variant="destructive"
          className="border border-destructive/40 bg-destructive/10 text-destructive rounded-xl"
        >
          <AlertCircle className="size-4" />
          <AlertTitle>Telemetry Operations Fault Captured</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-xs font-mono opacity-90">{syncError.msg}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/20"
              onClick={copyPromptToClipboard}
            >
              <Copy className="size-3.5" />
              {copied ? "Prompt In Clipboard" : "Copy Agent Fix Prompt"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {section && (
        <div className="space-y-1.5 border-b border-border/10 pb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold uppercase tracking-wider text-foreground">
              {section.name}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground font-light tracking-wide">
            {section.description}
          </p>
        </div>
      )}

      {/* Checklist Mapping Rows */}
      <div className="space-y-4">
        {questions.map((question) => {
          const ans = answers[question.id] || { isChecked: false, notes: "", isDraft: true };
          const linkedScopeCount = mappings.filter(
            (m) => m.questionId === question.id && m.associationStatus !== "user_disassociated",
          ).length;

          return (
            <Card
              key={question.id}
              className="bg-card/20 border-0 ring-1 ring-border/30 rounded-xl overflow-hidden shadow-none transition-all hover:ring-border/60"
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground/60 tracking-widest uppercase">
                        {question.code}
                      </span>
                      {ans.isChecked && !ans.isDraft && (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-0 text-[9px] uppercase tracking-wider rounded">
                          Verified
                        </Badge>
                      )}
                      {ans.isDraft && (ans.isChecked || (ans.notes && ans.notes.length > 0)) && (
                        <Badge className="bg-amber-500/10 text-amber-400 border-0 text-[9px] uppercase tracking-wider rounded">
                          Draft
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-sm font-medium text-foreground leading-relaxed">
                      {question.questionText}
                    </h3>
                    {question.considerations && (
                      <p className="text-xs text-muted-foreground font-light flex items-center gap-1.5 pt-0.5">
                        <HelpCircle className="size-3.5 opacity-70" />
                        {question.considerations}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={ans.isChecked}
                    onCheckedChange={(checked) =>
                      commitAnswerState(question.id, checked, ans.notes, ans.isDraft)
                    }
                  />
                </div>

                <div className="flex gap-2 items-center">
                  <Input
                    className="h-8 text-xs bg-background/40 border-input/30 focus-visible:ring-1"
                    placeholder="Enter design dimensions, exact product counts, or trade notes..."
                    value={ans.notes || ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]: { ...ans, notes: e.target.value },
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 shadow-none border-border/40"
                    onClick={() => commitAnswerState(question.id, ans.isChecked, ans.notes, false)}
                  >
                    <Save className="size-3.5" /> Commit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => commitAnswerState(question.id, ans.isChecked, ans.notes, true)}
                  >
                    Draft Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Material Bidding Negotiation Panel Viewport */}
      {activeRoomId && (
        <div className="pt-6 border-t border-border/10 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
              <DollarSign className="size-4 text-muted-foreground" /> Material Selection & Trade
              Discount Negotiation Ledger
            </h2>
            <p class="text-[11px] text-muted-foreground font-light">
              Declare product choices or custom quotes; contractors review below to inject trade
              discounts directly into the system workflow.
            </p>
          </div>

          <form
            onSubmit={handleCreateMaterialQuote}
            className="grid gap-2 sm:grid-cols-3 max-w-3xl"
          >
            <Input
              className="h-8 text-xs bg-card/40 border-border/30"
              placeholder="Material Name (e.g. Zellige Tile)"
              value={matName}
              onChange={(e) => setMatName(e.target.value)}
            />
            <Input
              className="h-8 text-xs bg-card/40 border-border/30"
              placeholder="Total Quote Value (USD)"
              type="number"
              step="0.01"
              value={matQuoteRaw}
              onChange={(e) => setMatQuoteRaw(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs uppercase tracking-wider font-semibold"
            >
              Log Selection Material
            </Button>
          </form>

          <div className="space-y-2">
            {materialQuotes.map((quote) => (
              <div
                key={quote.id}
                className="p-4 bg-card/10 ring-1 ring-border/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-sans"
              >
                <div>
                  <p className="font-semibold text-foreground text-sm">{quote.materialName}</p>
                  <p className="text-muted-foreground font-light pt-0.5">
                    Declared Estimate: ${(quote.homeownerQuoteCents / 100).toFixed(2)}
                  </p>
                  {quote.contractorNotes && (
                    <p className="text-amber-400 font-light mt-1.5 italic">
                      Contractor Note: "{quote.contractorNotes}"
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {quote.contractorDiscountOfferCents ? (
                    <div className="space-y-1">
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-0 rounded text-[10px] font-mono">
                        Offer: -${(quote.contractorDiscountOfferCents / 100).toFixed(2)}
                      </Badge>
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        Net Cost: $
                        {(
                          (quote.homeownerQuoteCents - quote.contractorDiscountOfferCents) /
                          100
                        ).toFixed(2)}
                      </p>
                    </div>
                  ) : (
                    <span className="text-muted-foreground font-light italic text-[11px]">
                      Awaiting field trade review
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### File 4: Vector Floor Plan Hotspot Navigation Canvas

Place this inside `src/frontend/components/InteractiveFloorPlan.tsx` and integrate it into the master dashboard grid panel view.

```tsx
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Home, ArrowRight } from "lucide-react";

interface FloorPlanRoomDot {
  roomId: number;
  roomName: string;
  coordinateX: string; // Percentage value for reactive SVG positioning
  coordinateY: string;
  isRenovating: boolean;
  activeBudgetCents: number;
}

interface InteractiveFloorPlanProps {
  initializedRooms: FloorPlanRoomDot[];
  onSelectRoomViewport: (roomId: number) => void;
}

export function InteractiveFloorPlan({
  initializedRooms,
  onSelectRoomViewport,
}: InteractiveFloorPlanProps) {
  return (
    <div className="p-6 bg-card/20 ring-1 ring-border/30 rounded-2xl space-y-4 text-foreground">
      <div className="flex items-center justify-between border-b border-border/10 pb-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
            <Home className="size-4 text-muted-foreground" /> Interactive Footprint Mission Map
          </h2>
          <p className="text-xs text-muted-foreground font-light">
            Select highlighted spatial nodes to drill down directly into specific room design
            viewports.
          </p>
        </div>
      </div>

      {/* Graphic Architectural Representation Box */}
      <div className="relative w-full aspect-[16/10] bg-zinc-950 rounded-xl overflow-hidden ring-1 ring-border/20 border border-background">
        {/* Mock blueprints grid background using strict borderless canvas design styles */}
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:24px_24px]" />

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground/20">
            Unified Structural Layout Blueprint
          </span>
        </div>

        {/* Dynamic Positional Map Pins */}
        {initializedRooms.map((room) => {
          if (!room.isRenovating) return null;
          return (
            <button
              key={room.roomId}
              type="button"
              className="absolute group z-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ top: room.coordinateY, left: room.coordinateX }}
              onClick={() => onSelectRoomViewport(room.roomId)}
            >
              {/* Pulsing Visual Radar Indicator Pin */}
              <span className="absolute inline-flex size-5 rounded-full bg-primary/40 animate-ping opacity-75" />
              <span className="relative size-3.5 rounded-full bg-primary ring-2 ring-background transition-transform group-hover:scale-125" />

              {/* Popover Flyout Box on Hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-30 min-w-[140px] p-2 bg-zinc-900 ring-1 ring-border/60 rounded-lg text-left shadow-2xl">
                <p className="text-xs font-bold text-foreground leading-none">{room.roomName}</p>
                <p className="text-[10px] text-muted-foreground pt-1">
                  Allocation: ${(room.activeBudgetCents / 100).toLocaleString()}
                </p>
                <div className="text-[9px] font-bold text-primary flex items-center gap-0.5 mt-1.5 uppercase tracking-wider">
                  Enter Viewport <ArrowRight className="size-2.5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Alternative Grid Text Fallback Index */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 pt-2">
        {initializedRooms.map((room) => (
          <button
            key={room.roomId}
            type="button"
            onClick={() => onSelectRoomViewport(room.roomId)}
            className="p-2 text-left bg-background/40 ring-1 ring-border/20 rounded-lg hover:ring-border/60 text-xs transition-all flex flex-col justify-between"
          >
            <span className="font-medium text-foreground leading-tight">{room.roomName}</span>
            <span className="text-[10px] text-muted-foreground pt-0.5">
              ${(room.activeBudgetCents / 100).toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### File 5: Clean Word-Formatted Blueprint Print Engine

Place this inside `src/frontend/components/ChecklistPrintView.tsx` and map directly to route `/questionnaire/print`.

```tsx
import React from "react";

interface PrintedItem {
  code: string;
  text: string;
  notes: string | null;
  sectionName: string;
}

interface ChecklistPrintViewProps {
  completedItems: PrintedItem[];
  projectName?: string;
}

export function ChecklistPrintView({
  completedItems,
  projectName = "126 Colby Remodel Project Blueprint",
}: ChecklistPrintViewProps) {
  const executeNativePrintFlow = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="bg-white text-black p-10 font-serif max-w-[8.5in] mx-auto min-h-screen relative print:p-0">
      {/* Control ribbon stripped from print media passes */}
      <div className="mb-6 flex justify-between items-center bg-gray-50 p-4 rounded border border-gray-300 print:hidden font-sans">
        <div>
          <h4 className="text-sm font-bold text-gray-900">
            Physical Standard Specification Ledger
          </h4>
          <p className="text-xs text-gray-500 font-light">
            Filters empty entries, structuring verified rows into an absolute 8.5x11 Word style
            template layout.
          </p>
        </div>
        <button
          type="button"
          onClick={executeNativePrintFlow}
          className="bg-black text-white px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded hover:bg-gray-800 shadow-sm transition-all"
        >
          Trigger Blueprint Print
        </button>
      </div>

      {/* Microsoft Word Mimic Frame */}
      <div className="space-y-6 print:space-y-4">
        <div className="text-center border-b-4 border-black pb-4">
          <h1 className="text-2xl font-black uppercase tracking-tight m-0 font-serif">
            {projectName}
          </h1>
          <p className="text-xs italic text-gray-600 mt-1">
            Immutable Verification Audit Record of Committed Selections
          </p>
          <p className="text-[10px] font-mono text-gray-400 mt-0.5">
            Compiled Matrix: {new Date().toLocaleDateString()}
          </p>
        </div>

        {completedItems.length === 0 ? (
          <p className="text-center italic text-gray-400 py-12 font-sans text-xs">
            No specifications or user responses have been committed to head revisions yet.
          </p>
        ) : (
          <div className="space-y-6">
            {completedItems.map((item, index) => {
              const displayHeader =
                index === 0 || completedItems[index - 1].sectionName !== item.sectionName;
              return (
                <div key={`${item.code}-${index}`} className="space-y-1.5 break-inside-avoid">
                  {displayHeader && (
                    <h2 className="text-xs font-sans font-black uppercase tracking-widest text-gray-800 bg-gray-100 px-2 py-1 mt-5 border-l-4 border-black">
                      {item.sectionName}
                    </h2>
                  )}
                  <div className="text-xs pl-2 space-y-1">
                    <p className="font-bold m-0 leading-tight">
                      <span className="font-mono text-[10px] text-gray-500 mr-2">
                        [{item.code}]
                      </span>
                      {item.text}
                    </p>
                    <p className="m-0 font-sans text-[11px] text-gray-800 pl-6">
                      <span className="font-black text-gray-400 text-[9px] uppercase tracking-wider mr-1.5">
                        Verification Status:
                      </span>
                      Confirmed / Field Ready Specification
                    </p>
                    {item.notes && (
                      <p className="m-0 text-[11px] font-sans text-gray-600 italic pl-6 border-l-2 border-gray-200 py-0.5">
                        <span className="font-bold not-italic text-gray-400 text-[9px] uppercase tracking-wider block">
                          Homeowner Directives:
                        </span>
                        "{item.notes}"
                      </p>
                    )}

                    {/* Contractor Comments Blueprint Note Pad */}
                    <div className="pt-2 pb-1 border-b border-dashed border-gray-300 pl-6 font-sans text-[10px] text-gray-400">
                      <span>
                        Crew Field Log / Review Check Details:
                        __________________________________________________________________________
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          @page { size: letter; margin: 0.75in; }
        }
      `,
        }}
      />
    </div>
  );
}
```

### File 6: Sidebar Navigation Shell

Update `src/frontend/components/AppSidebar.tsx` to handle nested tree parsing for playbooks dynamically.

```tsx
import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Layout,
  Settings,
  Folder,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <aside className="w-64 h-screen bg-card/40 ring-1 ring-border/30 text-foreground flex flex-col p-4 font-sans select-none">
      <div className="flex items-center gap-2 px-2 py-3 border-b border-border/10 mb-4">
        <div className="size-3.5 rounded bg-primary" />
        <span className="text-xs font-bold uppercase tracking-wider font-mono">
          Mission Control v1.0
        </span>
      </div>

      <nav className="flex-1 space-y-1">
        <a
          href="/"
          className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 hover:text-foreground rounded-lg transition-all"
        >
          <Layout className="size-4" /> Operations Control
        </a>

        {/* Collapsible /docs Hierarchy Tree Root Node */}
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setDocsOpen(!docsOpen)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 hover:text-foreground rounded-lg transition-all"
          >
            <div className="flex items-center gap-2.5">
              <BookOpen className="size-4" />
              <span>Project Playbooks</span>
            </div>
            {docsOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>

          {docsOpen && (
            <div className="pl-6 pt-1 space-y-1 border-l border-border/10 ml-5">
              <a
                href="/docs"
                className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground font-light"
              >
                <Folder className="size-3" /> Master Manual Overview
              </a>
              <div className="pt-1.5 space-y-1">
                <span className="text-[9px] uppercase font-bold tracking-widest text-muted-foreground/50 block px-1.5">
                  Homeowner Specs
                </span>
                <a
                  href="/docs#homeowner-specs"
                  class="flex items-center gap-1.5 py-0.5 pl-2 text-xs text-muted-foreground/80 hover:text-foreground font-light"
                >
                  <FileText className="size-2.5" /> Spec Entry System
                </a>
                <a
                  href="/docs#homeowner-budget"
                  class="flex items-center gap-1.5 py-0.5 pl-2 text-xs text-muted-foreground/80 hover:text-foreground font-light"
                >
                  <FileText className="size-2.5" /> Budget Engineering
                </a>
              </div>
              <div className="pt-2 space-y-1">
                <span className="text-[9px] uppercase font-bold tracking-widest text-muted-foreground/50 block px-1.5">
                  Contractor Manual
                </span>
                <a
                  href="/docs#contractor-footprint"
                  class="flex items-center gap-1.5 py-0.5 pl-2 text-xs text-muted-foreground/80 hover:text-foreground font-light"
                >
                  <FileText className="size-2.5" /> Footprint Reviews
                </a>
                <a
                  href="/docs#contractor-feedback"
                  class="flex items-center gap-1.5 py-0.5 pl-2 text-xs text-muted-foreground/80 hover:text-foreground font-light"
                >
                  <FileText className="size-2.5" /> Bid Trade Discounts
                </a>
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="pt-4 border-t border-border/10 flex items-center justify-between px-2 text-[10px] font-mono text-muted-foreground/60">
        <span>Identity: Homeowner Zone</span>
        <Settings className="size-3.5" />
      </div>
    </aside>
  );
}
```

---

## 4. Antigravity Deployment Orchestration Pipeline

### .agent/workflows/implement-feature.md

```markdown
# feature-integration-workflow: Dynamic Checklist, Map Navigator & Deal Portal

## Objectives

Coordinate deployment of database tables, parametric routes, vector mapping overlays, material discount ledgers, print tools, and collapsible playbook tree lines.

## Implementation Iterations

1. Database Footprint Setup — Deploy `src/backend/db/schema/home/questionnaire.ts` and sync exports into schema index file.
2. D1 Sync Loop — Run compilation verification on Drizzle, export SQL files into `./drizzle`, and execute local DB migration script updates.
3. Hono Endpoint Assembly — Write router fields into `src/backend/api/routes/construction-checklist.ts` with auto-trigger cents-enforced logic.
4. UI Interface Mounts — Mount `ConstructionChecklistApp.tsx`, `InteractiveFloorPlan.tsx`, and `ChecklistPrintView.tsx` within workspace rendering paths.
5. Tree Sidebar Merging — Inject collapsible navigation modules into `src/frontend/components/AppSidebar.tsx`.
```

### Rule Upgrades for .agent/rules/

_Before writing any lines or technical properties, check your current files inside `.agent/rules/` and perform a direct merge compilation matching these parameters:_

```markdown
# Structural Integrity Parameters

- All pricing properties, estimates, supplier logs, and automated triggers must enforce integer formats tracking pure cents. Standard Javascript floating-point decimal definitions are structurally forbidden.
- Telemetry inclusions, AI associations, and user manual overrides must track absolute feedback state loops across three flags exclusively ('ai_suggested', 'user_confirmed', 'user_disassociated') to ensure human overrides are preserved across runs.
- Client validation failures or drop traces must use alerts and templates derived from the Shadcn UI library exclusively.
```

---

### Implementation Plan Summary

To execute this architecture sequence cleanly, follow this prioritized workspace loop:

#### 1. Workflow Lifecycle

Your operational loop is mapped inside `.agent/workflows/implement-feature.md` [cite: 2026-02-10]. It will verify database relationships first, run compilation steps, layer Hono server routes, and deploy the front-end map vector engines.

#### 2. Local Rules Consolidation

Review your existing configurations within `.agent/rules/` first, and then merge the updated instructions [cite: 2026-02-10]. No orphan files are allowed. Enforce strict **cents integer tracking**, **HITL state preservation history**, and **Monolith borderless contrast layout standards** across all software development components [cite: 2026-02-08, 2026-02-10].
