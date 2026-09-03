/**
 * @fileoverview Budget Command Center — "Savings" tab.
 *
 * Panel A: the funding-accounts editor from
 * `docs/plans/budget-command-center/screens/4-funding-savings.html` — one row
 * per account, a running total, cancel/save against
 * `GET/PUT /api/budget-tracker/financial-accounts`.
 *
 * Panel B: the savings & reallocation ledger from the same screen — a
 * cursor-paginated table (`GET /api/budget/reallocations`) plus a
 * contingency balance meter (`GET /api/budget/contingency`).
 *
 * ZERO SQL here — every figure comes from `@/lib/budget-api`.
 */
import { useEffect, useState } from "react";
import { AlertCircle, CircleAlert, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BudgetApiError,
  formatCents,
  getContingency,
  getFundingAccounts,
  getReallocations,
  putFundingAccounts,
  useBudgetQuery,
  type FundingAccount,
  type ReallocationEntry,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

const LEDGER_PAGE_SIZE = 20;

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function partyLabel(party: ReallocationEntry["from"]): string {
  return party?.label ?? "—";
}

/** "+$1,100" / "-$2,900" / "$20,000" — sign made explicit, formatCents does the rest. */
function signedAmount(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

// ────────────────────────────────────────────────────────────────────────
// Panel A — funding accounts
// ────────────────────────────────────────────────────────────────────────

function FundingAccountsPanel() {
  const {
    data: fundingData,
    error: fundingError,
    isLoading: fundingLoading,
    refetch: refetchFunding,
  } = useBudgetQuery(getFundingAccounts, []);

  const [draft, setDraft] = useState<FundingAccount[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (fundingData) setDraft(fundingData.accounts);
  }, [fundingData]);

  const dirty =
    draft !== null &&
    fundingData !== null &&
    JSON.stringify(draft) !== JSON.stringify(fundingData.accounts);

  function updateAmount(accountKey: string, text: string, cents: number | null) {
    setDraft(
      (prev) =>
        prev?.map((row) =>
          row.accountKey === accountKey
            ? { ...row, amountText: text, amountCents: cents ?? 0 }
            : row,
        ) ?? prev,
    );
    setSaveError(null);
  }

  function handleCancel() {
    setDraft(fundingData?.accounts ?? null);
    setSaveError(null);
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await putFundingAccounts(
        draft.map((row) => ({
          accountKey: row.accountKey,
          accountLabel: row.accountLabel,
          amountCents: row.amountCents,
          notes: row.notes,
        })),
      );
      refetchFunding();
    } catch (err) {
      setSaveError(
        err instanceof BudgetApiError
          ? `HTTP ${err.status} — ${err.message}`
          : err instanceof Error
            ? err.message
            : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }

  const totalCents = (draft ?? []).reduce((sum, row) => sum + (row.amountCents ?? 0), 0);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Funding accounts</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">These sum to your total budget.</p>
      </div>

      {fundingLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading funding accounts…
        </div>
      ) : fundingError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <CircleAlert aria-hidden className="size-5 text-destructive" />
          <p className="text-sm font-medium text-destructive">Couldn't load funding accounts</p>
          <p className="text-xs text-muted-foreground">{fundingError.message}</p>
        </div>
      ) : !draft || draft.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No funding accounts configured yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 p-4">
          {draft.map((row) => (
            <div key={row.accountKey} className="flex items-center gap-2">
              <Label
                htmlFor={`funding-account-${row.accountKey}`}
                className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal text-foreground"
              >
                {row.accountLabel}
              </Label>
              <CurrencyInput
                id={`funding-account-${row.accountKey}`}
                value={row.amountText ?? ""}
                onValueChange={(text, cents) => updateAmount(row.accountKey, text, cents)}
                aria-label={`${row.accountLabel} amount`}
                className="w-[136px] shrink-0"
              />
            </div>
          ))}
        </div>
      )}

      {saveError && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {saveError}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
        <div className="text-xs text-muted-foreground">
          Total{" "}
          <span className="ml-2 font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatCents(totalCents)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={!dirty || saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save accounts"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Panel B — savings & reallocation ledger + contingency meter
// ────────────────────────────────────────────────────────────────────────

function ReallocationLedgerPanel() {
  const [entries, setEntries] = useState<ReallocationEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<Error | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLedgerLoading(true);
    setLedgerError(null);
    getReallocations({ limit: LEDGER_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLedgerError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getReallocations({ limit: LEDGER_PAGE_SIZE, cursor });
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setLedgerError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore(false);
    }
  }

  const {
    data: contingency,
    error: contingencyError,
    isLoading: contingencyLoading,
  } = useBudgetQuery(getContingency, []);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Savings &amp; reallocation ledger</h2>
      </div>

      {ledgerLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading ledger…
        </div>
      ) : ledgerError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <AlertCircle aria-hidden className="size-5 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Couldn't load the reallocation ledger
          </p>
          <p className="text-xs text-muted-foreground">{ledgerError.message}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No reallocations recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[86px]">Date</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
                    {dateFormatter.format(new Date(entry.occurredAt * 1000))}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{entry.eventTitle}</div>
                    {entry.eventDetail && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {entry.eventDetail}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {partyLabel(entry.from)} → {partyLabel(entry.to)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-sm tabular-nums",
                      entry.amountCents < 0 && "text-amber-500",
                    )}
                  >
                    {signedAmount(entry.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {cursor && !ledgerLoading && (
        <div className="border-t border-border px-4 py-2.5">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <div className="border-t border-border bg-muted/30 px-4 py-3">
        {contingencyLoading ? (
          <div className="text-xs text-muted-foreground">Loading contingency balance…</div>
        ) : contingencyError ? (
          <div className="text-xs text-destructive">Couldn't load contingency balance</div>
        ) : contingency ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">Contingency balance</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatCents(contingency.currentBalanceCents)}
              </span>
            </div>
            <Progress
              value={Math.max(0, Math.min(100, Math.round(contingency.pctRemaining * 100)))}
              aria-label="Contingency balance remaining"
            />
            <div className="text-xs text-muted-foreground">
              {formatCents(contingency.currentBalanceCents)} of{" "}
              {formatCents(contingency.openingReserveCents)} opening reserve
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────

export function SavingsTab() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[440px_1fr] lg:items-start">
      <FundingAccountsPanel />
      <ReallocationLedgerPanel />
    </div>
  );
}

export default SavingsTab;
