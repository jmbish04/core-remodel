/**
 * @fileoverview Dynamic parametric questionnaire surface.
 *
 * Renders one section's worth of questions, captures draft and committed answers
 * (POSTs to `/api/construction-checklist/answers`), and — when an `activeRoomId`
 * is supplied — shows the material selection and contractor-discount ledger for
 * that room (`GET /api/portal/rooms/:roomId/quotes`).
 *
 * Money is always handled as integer cents on the wire; the human-facing form
 * accepts dollar input and rounds locally before sending.
 *
 * Monolith aesthetic: dark surfaces, ring-1 ring-border/30 (no traditional 1px
 * borders), Inter typography.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Copy,
  DollarSign,
  HelpCircle,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// ---------------------------------------------------------------------------
// Types — mirror the Hono response payload shapes
// ---------------------------------------------------------------------------

interface Section {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  helperText: string | null;
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
  associationStatus: "ai_suggested" | "user_confirmed" | "user_disassociated";
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

interface SectionPayload {
  success: boolean;
  error?: string;
  section: Section;
  questions: Question[];
  answers: Answer[];
  mappings: Mapping[];
}

interface QuotesPayload {
  success: boolean;
  error?: string;
  quotes: MaterialQuote[];
}

interface SyncError {
  message: string;
  agentPrompt: string;
}

interface ConstructionChecklistAppProps {
  sectionSlug: string;
  activeRoomId?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConstructionChecklistApp({
  sectionSlug,
  activeRoomId = null,
}: ConstructionChecklistAppProps) {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [materialQuotes, setMaterialQuotes] = useState<MaterialQuote[]>([]);
  const [syncError, setSyncError] = useState<SyncError | null>(null);
  const [copied, setCopied] = useState(false);
  const [materialName, setMaterialName] = useState("");
  const [materialQuoteDollars, setMaterialQuoteDollars] = useState("");

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadSection = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const response = await fetch(
        `/api/construction-checklist/sections/${encodeURIComponent(sectionSlug)}`,
        { credentials: "include" },
      );
      const payload = (await response.json()) as SectionPayload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load section");
      }

      setSection(payload.section);
      setQuestions(payload.questions);
      setMappings(payload.mappings);

      const indexed: Record<number, Answer> = {};
      for (const answer of payload.answers) {
        indexed[answer.questionId] = answer;
      }
      setAnswers(indexed);

      if (activeRoomId !== null && activeRoomId !== undefined) {
        const quotesRes = await fetch(`/api/portal/rooms/${activeRoomId}/quotes`, {
          credentials: "include",
        });
        const quotesPayload = (await quotesRes.json()) as QuotesPayload;
        if (quotesPayload.success) {
          setMaterialQuotes(quotesPayload.quotes);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error loading questionnaire section";
      setSyncError({
        message,
        agentPrompt: [
          "The questionnaire section failed to load. Please debug:",
          "",
          `  Endpoint:  GET /api/construction-checklist/sections/${sectionSlug}`,
          `  Branch:    feat/questionnaire-floorplan-portal`,
          "",
          `  Trace:     ${message}`,
        ].join("\n"),
      });
    } finally {
      setLoading(false);
    }
  }, [sectionSlug, activeRoomId]);

  useEffect(() => {
    loadSection();
  }, [loadSection]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const commitAnswer = async (
    questionId: number,
    isChecked: boolean,
    notes: string | null,
    isDraft: boolean,
  ) => {
    const current = answers[questionId];
    try {
      const response = await fetch("/api/construction-checklist/answers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: current?.trackId,
          questionId,
          isChecked,
          notes,
          isDraft,
        }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        answer: Answer;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to commit answer");
      }
      setAnswers((prev) => ({ ...prev, [questionId]: payload.answer }));
      toast.success(
        isDraft ? "Draft saved" : "Answer committed and budget refreshed",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to commit answer";
      toast.error(message);
      setSyncError({
        message,
        agentPrompt: [
          "POST /api/construction-checklist/answers failed. Please debug:",
          "",
          `  questionId: ${questionId}`,
          `  isChecked:  ${isChecked}`,
          `  isDraft:    ${isDraft}`,
          "",
          `  Trace:      ${message}`,
        ].join("\n"),
      });
    }
  };

  const submitMaterialQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRoomId || !materialName.trim() || !materialQuoteDollars.trim()) {
      return;
    }
    const dollars = Number.parseFloat(materialQuoteDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Quote must be a non-negative number");
      return;
    }
    const cents = Math.round(dollars * 100);
    try {
      const response = await fetch("/api/construction-checklist/quotes/submit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: activeRoomId,
          materialName: materialName.trim(),
          homeownerQuoteCents: cents,
        }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to log material quote");
      }
      toast.success("Material quote added to the room ledger");
      setMaterialName("");
      setMaterialQuoteDollars("");
      await loadSection();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit material quote";
      toast.error(message);
    }
  };

  const copyAgentPrompt = async () => {
    if (!syncError) return;
    try {
      await navigator.clipboard.writeText(syncError.agentPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard copy failed");
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center bg-background font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin text-foreground" />
        Loading questionnaire section…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 bg-background px-4 text-foreground">
      {syncError && (
        <Alert
          variant="destructive"
          className="rounded-xl border-0 bg-destructive/10 text-destructive ring-1 ring-destructive/40"
        >
          <AlertCircle className="size-4" />
          <AlertTitle>Sync fault captured</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="font-mono text-xs opacity-90">{syncError.message}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-destructive/30 text-xs text-destructive hover:bg-destructive/20"
              onClick={copyAgentPrompt}
            >
              <Copy className="size-3.5" />
              {copied ? "Prompt copied" : "Copy agent fix prompt"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {section && (
        <div className="space-y-1.5 border-b border-border/10 pb-4">
          <h1 className="text-xl font-bold uppercase tracking-wider text-foreground">
            {section.name}
          </h1>
          {section.description && (
            <p className="text-xs font-light tracking-wide text-muted-foreground">
              {section.description}
            </p>
          )}
          {section.helperText && (
            <p className="text-[11px] italic text-muted-foreground/80">
              {section.helperText}
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((question) => {
          const answer = answers[question.id] ?? {
            trackId: "",
            questionId: question.id,
            isChecked: false,
            notes: "",
            isDraft: true,
          };
          const activeMappingCount = mappings.filter(
            (m) =>
              m.questionId === question.id &&
              m.associationStatus !== "user_disassociated",
          ).length;
          return (
            <Card
              key={question.id}
              className="overflow-hidden rounded-xl border-0 bg-card/20 shadow-none ring-1 ring-border/30 transition-all hover:ring-border/60"
            >
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                        {question.code}
                      </span>
                      {answer.isChecked && !answer.isDraft && (
                        <Badge className="rounded border-0 bg-emerald-500/10 text-[9px] uppercase tracking-wider text-emerald-400">
                          Verified
                        </Badge>
                      )}
                      {answer.isDraft &&
                        (answer.isChecked ||
                          (answer.notes && answer.notes.length > 0)) && (
                          <Badge className="rounded border-0 bg-amber-500/10 text-[9px] uppercase tracking-wider text-amber-400">
                            Draft
                          </Badge>
                        )}
                      {activeMappingCount > 0 && (
                        <Badge className="rounded border-0 bg-sky-500/10 text-[9px] uppercase tracking-wider text-sky-300">
                          {activeMappingCount} room
                          {activeMappingCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-sm font-medium leading-relaxed text-foreground">
                      {question.questionText}
                    </h3>
                    {question.considerations && (
                      <p className="flex items-center gap-1.5 pt-0.5 text-xs font-light text-muted-foreground">
                        <HelpCircle className="size-3.5 opacity-70" />
                        {question.considerations}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={answer.isChecked}
                    onCheckedChange={(checked) =>
                      commitAnswer(question.id, checked, answer.notes, answer.isDraft)
                    }
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 border-input/30 bg-background/40 text-xs focus-visible:ring-1"
                    placeholder="Dimensions, product counts, or trade notes…"
                    value={answer.notes ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]: { ...answer, notes: event.target.value },
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 border-border/40 text-xs shadow-none"
                    onClick={() =>
                      commitAnswer(question.id, answer.isChecked, answer.notes, false)
                    }
                  >
                    <Save className="size-3.5" /> Commit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      commitAnswer(question.id, answer.isChecked, answer.notes, true)
                    }
                  >
                    Draft save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {questions.length === 0 && (
          <p className="px-4 py-12 text-center text-xs italic text-muted-foreground">
            No questions are seeded for this section yet.
          </p>
        )}
      </div>

      {activeRoomId !== null && activeRoomId !== undefined && (
        <div className="space-y-4 border-t border-border/10 pt-6">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <DollarSign className="size-4 text-muted-foreground" />
              Material selection &amp; trade-discount ledger
            </h2>
            <p className="text-[11px] font-light text-muted-foreground">
              Log product choices or custom quotes. Contractors review below and
              counter with trade discounts directly in the workflow.
            </p>
          </div>

          <form
            onSubmit={submitMaterialQuote}
            className="grid max-w-3xl gap-2 sm:grid-cols-3"
          >
            <Input
              className="h-8 border-border/30 bg-card/40 text-xs"
              placeholder="Material name (e.g. Zellige tile)"
              value={materialName}
              onChange={(event) => setMaterialName(event.target.value)}
            />
            <Input
              className="h-8 border-border/30 bg-card/40 text-xs"
              placeholder="Quote total (USD)"
              type="number"
              step="0.01"
              min="0"
              value={materialQuoteDollars}
              onChange={(event) => setMaterialQuoteDollars(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs font-semibold uppercase tracking-wider"
            >
              Log selection
            </Button>
          </form>

          <div className="space-y-2">
            {materialQuotes.map((quote) => (
              <div
                key={quote.id}
                className="flex flex-col justify-between gap-4 rounded-xl bg-card/10 p-4 font-sans text-xs ring-1 ring-border/20 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {quote.materialName}
                  </p>
                  <p className="pt-0.5 font-light text-muted-foreground">
                    Declared estimate: $
                    {(quote.homeownerQuoteCents / 100).toFixed(2)}
                  </p>
                  {quote.contractorNotes && (
                    <p className="mt-1.5 italic font-light text-amber-400">
                      Contractor: &quot;{quote.contractorNotes}&quot;
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {quote.contractorDiscountOfferCents !== null ? (
                    <div className="space-y-1">
                      <Badge className="rounded border-0 bg-emerald-500/10 font-mono text-[10px] text-emerald-400">
                        Offer: -$
                        {(quote.contractorDiscountOfferCents / 100).toFixed(2)}
                      </Badge>
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        Net: $
                        {(
                          (quote.homeownerQuoteCents -
                            quote.contractorDiscountOfferCents) /
                          100
                        ).toFixed(2)}
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] font-light italic text-muted-foreground">
                      Awaiting field trade review
                    </span>
                  )}
                </div>
              </div>
            ))}
            {materialQuotes.length === 0 && (
              <p className="px-2 py-6 text-center text-xs italic text-muted-foreground">
                No material quotes logged for this room yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
