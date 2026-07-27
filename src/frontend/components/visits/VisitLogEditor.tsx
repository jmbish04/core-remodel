/**
 * @fileoverview Visit finalize/create form (0032 V2c).
 *
 * A controlled editor: the parent owns the `draft` + the submit buttons (detail
 * has a sticky Save/Submit/Delete bar; new has a Create button), this renders the
 * fields. Notes are PlateJS (OverviewNoteEditor → md + html, never a textarea);
 * rating is the shared StarRating; visit_type is a segmented control over the
 * fixed enum (no OTHER, so no combobox).
 */
import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";
import { cn } from "@/lib/utils";

import { ShowroomAutocomplete } from "./ShowroomAutocomplete";
import { StarRating } from "./StarRating";
import { VISIT_TYPES, VISIT_TYPE_LABEL, type VisitType } from "./types";

export interface EditorDraft {
  storeId: number | null;
  visitType: VisitType;
  rating: number; // 0 = unrated
  notesMarkdown: string;
  notesHtml: string;
  arrivalAt: string | null; // ISO or null
  departureAt: string | null; // ISO or null
}

/** ISO → the value a <input type="datetime-local"> expects (local, no seconds). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  // Shift by the local tz offset so the wall-clock time shows in the picker.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** datetime-local value → ISO (UTC), or null when cleared/invalid. */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function VisitLogEditor({
  draft,
  onChange,
  showStore = false,
}: {
  draft: EditorDraft;
  onChange: (patch: Partial<EditorDraft>) => void;
  showStore?: boolean;
}) {
  return (
    <div className="space-y-6">
      {showStore && (
        <Field label="Showroom">
          <ShowroomAutocomplete value={draft.storeId} onChange={(storeId) => onChange({ storeId })} />
        </Field>
      )}

      <Field label="Engagement">
        <div className="flex flex-wrap gap-2">
          {VISIT_TYPES.map((t) => {
            const active = draft.visitType === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ visitType: t })}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
                  active
                    ? "bg-primary text-primary-foreground ring-primary"
                    : "bg-muted/40 text-muted-foreground ring-border/50 hover:bg-muted",
                )}
              >
                {VISIT_TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Rating">
        <StarRating value={draft.rating} onChange={(rating) => onChange({ rating })} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Arrival">
          <input
            type="datetime-local"
            value={isoToLocalInput(draft.arrivalAt)}
            onChange={(e) => onChange({ arrivalAt: localInputToIso(e.target.value) })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </Field>
        <Field label="Departure">
          <input
            type="datetime-local"
            value={isoToLocalInput(draft.departureAt)}
            onChange={(e) => onChange({ departureAt: localInputToIso(e.target.value) })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </Field>
      </div>

      <Field label="Notes">
        <OverviewNoteEditor
          initialHtml={draft.notesHtml}
          initialMarkdown={draft.notesMarkdown}
          onChange={({ html, markdown }) => onChange({ notesHtml: html, notesMarkdown: markdown })}
          variant="page"
        />
      </Field>
    </div>
  );
}
