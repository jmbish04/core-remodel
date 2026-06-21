import { Loader2, Mic, Pencil, Sparkles, StopCircle } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { RoomDetailPayload, RoomSummaryRecord } from "./types";

/**
 * RoomOverview (T3.3) — the full-width stored-summary section.
 *
 * Renders the persisted Worker-AI summary (overview / renovation story /
 * budget snapshot / task focus / decision points / supporting signals) plus
 * any free-text room notes & problem areas. The always-visible "Refresh AI
 * summary" card from the old monolith is GONE — refreshing now lives behind a
 * top-right "Edit / Update" button that opens a shadcn Dialog containing the
 * prompt textarea + the voice-record control, which posts to
 * `POST /api/rooms/code/:roomCode/summary`.
 */
export interface RoomOverviewProps {
  roomCode: string;
  detail: RoomDetailPayload;
  /** Gates the edit action behind homeowner auth. */
  accessAuthenticated: boolean;
  /** Merges the regenerated summary into the orchestrator's detail state. */
  onSummaryPatched: (summary: RoomSummaryRecord | null) => void;
}

/** Encodes a recorded audio Blob to base64 for the summary endpoint. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to encode audio note"));
        return;
      }
      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio note"));
    reader.readAsDataURL(blob);
  });
}

/** A labelled paragraph block used throughout the summary render. */
function SummaryBlock(props: { label: string; children: React.ReactNode; muted?: boolean }) {
  const { label, children, muted } = props;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
      <div className={muted ? "text-sm leading-7 text-muted-foreground" : "text-sm leading-7 text-foreground/90"}>
        {children}
      </div>
    </div>
  );
}

export function RoomOverview({
  roomCode,
  detail,
  accessAuthenticated,
  onSummaryPatched,
}: RoomOverviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
  const summaryObject = detail.summary?.summaryObject || null;

  // Tear down any live recorder/stream on unmount so we never leak the mic.
  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const startVoiceNote = useCallback(async () => {
    if (!canRecord || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice recording is not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const base64 = await blobToBase64(blob);
          setAudioBase64(base64);
          setAudioHint("Voice note ready for the next summary refresh.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to prepare voice note");
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          recorderRef.current = null;
          chunksRef.current = [];
          setIsRecording(false);
        }
      };

      recorder.start();
      setAudioHint("Recording voice note...");
      setIsRecording(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start voice note");
    }
  }, [canRecord]);

  const stopVoiceNote = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const regenerateSummary = useCallback(async () => {
    setRegenerating(true);
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}/summary`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: summaryPrompt.trim() || null,
          audioBase64,
          representativeImageId: detail.summary?.representativeImageId ?? null,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        summary?: RoomSummaryRecord | null;
        voiceTranscript?: string | null;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to regenerate the room summary");
      }
      onSummaryPatched(payload.summary ?? null);
      setAudioBase64(null);
      setAudioHint(payload.voiceTranscript ? `Whisper note: ${payload.voiceTranscript}` : "");
      setSummaryPrompt("");
      setDialogOpen(false);
      toast.success("Room summary refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate the room summary");
    } finally {
      setRegenerating(false);
    }
  }, [audioBase64, detail.summary?.representativeImageId, onSummaryPatched, roomCode, summaryPrompt]);

  return (
    <Card className="ring-1 ring-foreground/10">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Room Overview</CardTitle>
            <CardDescription>Stored Worker-AI summary plus room-specific context</CardDescription>
          </div>
          {accessAuthenticated ? (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Pencil className="mr-2 size-4" />
              Edit / Update
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {summaryObject ? (
          <>
            {summaryObject.overview ? (
              <SummaryBlock label="Overview">
                <p>{summaryObject.overview}</p>
              </SummaryBlock>
            ) : null}
            {summaryObject.renovationStory ? (
              <SummaryBlock label="Renovation Story" muted>
                <p>{summaryObject.renovationStory}</p>
              </SummaryBlock>
            ) : null}
            {summaryObject.budgetSnapshot ? (
              <SummaryBlock label="Budget Snapshot" muted>
                <p>{summaryObject.budgetSnapshot}</p>
              </SummaryBlock>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              <SummaryBlock label="Task Focus" muted>
                <div className="space-y-2">
                  {(summaryObject.taskFocus || []).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </SummaryBlock>
              <SummaryBlock label="Decision Points" muted>
                <div className="space-y-2">
                  {(summaryObject.decisionPoints || []).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </SummaryBlock>
              <SummaryBlock label="Supporting Signals" muted>
                <div className="space-y-2">
                  {(summaryObject.supportingSignals || []).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </SummaryBlock>
            </div>
          </>
        ) : detail.summary?.summaryMarkdown ? (
          <pre className="whitespace-pre-wrap rounded-2xl bg-muted/20 p-4 text-sm leading-7 text-muted-foreground ring-1 ring-foreground/10">
            {detail.summary.summaryMarkdown}
          </pre>
        ) : (
          <div className="rounded-2xl bg-muted/10 px-4 py-10 text-center ring-1 ring-foreground/10">
            <Sparkles className="mx-auto mb-3 size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No stored room summary exists yet. Generate one once and it stays cached in D1.
            </p>
          </div>
        )}

        {detail.room.generalNotes || detail.room.problemAreas ? (
          <div className="grid gap-4 md:grid-cols-2">
            {detail.room.generalNotes ? (
              <div className="rounded-xl bg-muted/15 px-4 py-3 ring-1 ring-foreground/10">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Existing Notes
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.room.generalNotes}</p>
              </div>
            ) : null}
            {detail.room.problemAreas ? (
              <div className="rounded-xl bg-muted/15 px-4 py-3 ring-1 ring-foreground/10">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Problem Areas
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.room.problemAreas}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-full sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Refresh AI summary</DialogTitle>
            <DialogDescription>
              Add missing context before rerunning the summary. Voice notes are transcribed with
              Whisper and stored alongside the refresh.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={summaryPrompt}
              onChange={(event) => setSummaryPrompt(event.target.value)}
              placeholder="Tell the summary what it is missing. Example: include the four kitchen options, note the downstairs-left vs downstairs-right move, and mention the budget is still provisional."
              rows={5}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant={isRecording ? "destructive" : "outline"}
                onClick={() => void (isRecording ? stopVoiceNote() : startVoiceNote())}
              >
                {isRecording ? <StopCircle className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}
                {isRecording ? "Stop voice note" : "Record voice note"}
              </Button>
            </div>
            {audioHint ? <p className="text-xs text-muted-foreground">{audioHint}</p> : null}
            {detail.summary?.lastUserPrompt ? (
              <p className="text-xs text-muted-foreground">
                Last correction prompt: {detail.summary.lastUserPrompt}
              </p>
            ) : null}
          </div>

          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={regenerating}>
              Cancel
            </Button>
            <Button onClick={() => void regenerateSummary()} disabled={regenerating}>
              {regenerating ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Refresh room summary
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default RoomOverview;
