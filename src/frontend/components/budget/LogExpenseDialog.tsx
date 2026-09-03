import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
/**
 * @fileoverview Budget Command Center — "Log expense" dialog (task F7).
 *
 * Self-contained: renders its own trigger ("Log expense" button, styled to
 * match the header's original) plus the dialog itself. Submits through
 * `createExpense` from `@/lib/budget-api` — ZERO SQL in this file, it talks
 * to the typed API client only.
 *
 * ── What the live route actually accepts ────────────────────────────────
 * `ExpenseCreateRequest` in budget-api.ts now mirrors the LIVE
 * `POST /api/budget-tracker/expenses` route and the `budget_expense_entries`
 * schema, rather than the design's wish list:
 *
 *  - `category` is REQUIRED by the route (it 400s without one). Defaulted to
 *    the column's own `"general"`, since neither the design nor the contract
 *    asks for a category picker here.
 *  - The vendor is free text. There is no vendor foreign key on an expense,
 *    only a `vendor_name` column, so this sends `vendorName`.
 *  - There is no `phase_id` column on an expense at all, so this dialog has
 *    no Phase field. Do not invent one.
 *  - `dateIncurred` is Unix SECONDS. The route's `parseTimestamp()` used to
 *    reject numbers outright, which dropped the date silently — the insert
 *    succeeded with no date and the expense looked saved. Fixed in
 *    budget-tracker.ts; that function now takes seconds, milliseconds, a
 *    numeric string, or a date string.
 *
 * The vendor and phase gaps are recorded in
 * docs/decisions/2026-09-03-budget-command-center-schema-gaps.md.
 */
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ComboboxWithOther, type ComboboxOption } from "@/components/ui/combobox-with-other";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoomSelect } from "@/components/ui/room-select";
import { Textarea } from "@/components/ui/textarea";
import {
  BudgetApiError,
  createExpense,
  formatCents,
  type ExpenseCreateRequest,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

interface FormState {
  item: string;
  amountText: string;
  amountCents: number | null;
  vendorName: string | null;
  roomId: number | null;
  /** `yyyy-mm-dd`, the native `<input type="date">` value. */
  dateIncurred: string;
  notes: string;
}

function todayInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function emptyForm(): FormState {
  return {
    item: "",
    amountText: "",
    amountCents: null,
    vendorName: null,
    roomId: null,
    dateIncurred: todayInputValue(),
    notes: "",
  };
}

function isDirty(form: FormState): boolean {
  const blank = emptyForm();
  return (
    form.item !== blank.item ||
    form.amountText !== blank.amountText ||
    form.vendorName !== blank.vendorName ||
    form.roomId !== blank.roomId ||
    form.dateIncurred !== blank.dateIncurred ||
    form.notes !== blank.notes
  );
}

interface LoggedEntry {
  key: string;
  item: string;
  amountCents: number;
  status: "confirmed" | "failed";
  error?: string;
}

export interface LogExpenseDialogProps {
  /** Fired after a successful create so the caller can refresh totals (e.g. the workbench KPIs). */
  onLogged?: () => void;
}

/**
 * "Log expense" trigger button + dialog. Mount it once; it owns its own
 * open state and its own trigger, so callers just render `<LogExpenseDialog />`.
 */
export function LogExpenseDialog({ onLogged }: LogExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [vendorOptions, setVendorOptions] = useState<ComboboxOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [logged, setLogged] = useState<LoggedEntry[]>([]);
  const errorId = useId();

  function resetAll() {
    setForm(emptyForm());
    setFormError(null);
    setLogged([]);
  }

  /** Shared close guard for the X button, Escape, outside click, and the Cancel button. */
  function attemptClose(): boolean {
    if (submitting) return false;
    if (isDirty(form) && !window.confirm("Discard this expense? It has not been saved.")) {
      return false;
    }
    setOpen(false);
    resetAll();
    return true;
  }

  async function handleSubmit() {
    if (submitting) return;

    const item = form.item.trim();
    if (!item) {
      setFormError("Item is required.");
      return;
    }
    if (form.amountCents == null || form.amountCents <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (!form.dateIncurred) {
      setFormError("Date incurred is required.");
      return;
    }
    const incurredMs = new Date(`${form.dateIncurred}T00:00:00`).getTime();
    if (Number.isNaN(incurredMs)) {
      setFormError("Date incurred is invalid.");
      return;
    }

    setFormError(null);
    setSubmitting(true);

    const key = crypto.randomUUID();
    const amountCents = form.amountCents;
    // Optimistic insert — appears immediately, before the POST resolves.
    setLogged((prev) => [...prev, { key, item, amountCents, status: "confirmed" }]);

    const payload: ExpenseCreateRequest = {
      item,
      amountText: form.amountText,
      amountCents,
      category: "general",
      vendorName: form.vendorName?.trim() || undefined,
      roomId: form.roomId ?? undefined,
      dateIncurred: Math.floor(incurredMs / 1000),
      notes: form.notes.trim() || undefined,
    };

    try {
      await createExpense(payload);
      toast.success(`Logged ${formatCents(amountCents)} — ${item}`);
      setForm(emptyForm());
      onLogged?.();
    } catch (err) {
      const message =
        err instanceof BudgetApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to log expense.";
      // Visible rollback — the optimistic entry stays but flips to "failed" with the server's message.
      setLogged((prev) =>
        prev.map((entry) =>
          entry.key === key ? { ...entry, status: "failed", error: message } : entry,
        ),
      );
      setFormError(message);
      toast.error(`Couldn't log expense: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (next) {
          setOpen(true);
          return;
        }
        if (!attemptClose()) eventDetails.cancel();
      }}
    >
      <DialogTrigger render={<Button />}>Log expense</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log expense</DialogTitle>
          <DialogDescription>Record an actual spend against the budget.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="log-expense-item">Item</Label>
            <Input
              id="log-expense-item"
              value={form.item}
              onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))}
              placeholder="e.g. Kitchen faucet"
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="log-expense-amount">Amount</Label>
              <CurrencyInput
                id="log-expense-amount"
                value={form.amountText}
                onValueChange={(text, cents) =>
                  setForm((f) => ({ ...f, amountText: text, amountCents: cents }))
                }
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-expense-date">Date incurred</Label>
              <Input
                id="log-expense-date"
                type="date"
                value={form.dateIncurred}
                onChange={(e) => setForm((f) => ({ ...f, dateIncurred: e.target.value }))}
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              {/* ComboboxWithOther doesn't forward an `id` to its trigger, so this label is
                  visual-only; the control's accessible name comes from `aria-label` below. */}
              <Label>Vendor</Label>
              <ComboboxWithOther
                options={vendorOptions}
                value={form.vendorName}
                onChange={(value) => setForm((f) => ({ ...f, vendorName: value }))}
                onCreateOther={(label) => {
                  const opt: ComboboxOption = { value: label, label };
                  setVendorOptions((prev) =>
                    prev.some((o) => o.value === label) ? prev : [...prev, opt],
                  );
                  return opt;
                }}
                placeholder="Vendor (optional)"
                searchPlaceholder="Search or add a vendor…"
                emptyMessage="Type to add a vendor."
                disabled={submitting}
                aria-label="Vendor"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-expense-room">Room</Label>
              <RoomSelect
                id="log-expense-room"
                value={form.roomId}
                onChange={(roomId) => setForm((f) => ({ ...f, roomId }))}
                placeholder="Room (optional)"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-expense-notes">Notes</Label>
            <Textarea
              id="log-expense-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional context"
              disabled={submitting}
            />
          </div>

          {formError && (
            <div
              id={errorId}
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {formError}
            </div>
          )}

          {logged.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-border pt-3">
              {logged.map((entry) => (
                <li
                  key={entry.key}
                  className={cn(
                    "flex items-start gap-1.5 text-xs",
                    entry.status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {entry.status === "failed" ? (
                    <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <CircleCheck
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground">{entry.item}</span> —{" "}
                    {formatCents(entry.amountCents)}
                    {entry.status === "failed" && (
                      <span className="block text-destructive">Failed: {entry.error}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => attemptClose()}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            aria-describedby={formError ? errorId : undefined}
          >
            {submitting && <Loader2 aria-hidden className="animate-spin" />}
            {submitting ? "Logging…" : "Log expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LogExpenseDialog;
