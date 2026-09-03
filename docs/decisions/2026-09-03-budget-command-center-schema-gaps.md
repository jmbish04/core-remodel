# Budget Command Center — six fields the new screens want that the database does not have

- **Date raised:** 2026-09-03
- **Raised by:** budget-ux-overhaul session (orca/budget-ux-overhaul)
- **Status:** awaiting decision

## What happened

Building the new budget workbench from the approved design turned up six places
where a screen asks for a value the database has no column for. In each case the
agent that hit it flagged it and used the closest existing field rather than
inventing one, so nothing is broken — but five of the six are approximations
that will quietly drift, and one is a rule the repo says is mandatory.

## Why it matters

None of these blocks the merge. All five are cheap now and expensive later: they
are one additive migration today, versus a data-correction job once real invoices
and change orders are flowing through these screens. Two of them (the money
convention and the CSLB contract value) touch numbers that end up in front of
contractors.

## The six

**1. Funding accounts store cents but not the typed text.**
The repo's currency rule says every money field stores both `<field>_text` (what
the user actually typed, e.g. `"$118,400"` or `"call for pricing"`) and
`<field>_cents`. `budget_funding_accounts` only ever had `amount_cents`. The
Savings tab's inputs produce both; the text is currently discarded.

**2. Contract value and down payment are being read off the estimate, not the contract.**
The compliance screen shows "contract $118,400" and checks California's
down-payment cap against it. Neither `contracts` nor `contract_revisions` nor
`contract_payment_milestones` has a contract value or a down-payment amount, so
the agent sourced both from the linked estimate's current revision
(`totalAmountCents` / `depositAmountCents`). That is a real, purpose-built column
— but it is the estimate's number, and an estimate and a signed contract diverge
the moment anything is negotiated.

**3. Estimate line numbers are actually item codes.**
The reconciliation screen shows "Meridian Tile · estimate line 14".
`estimate_line_items` has no line-number column, so the agent used `item_code`,
which is the closest existing field but is not the same thing.

**4. A rejected reconciliation has nowhere to record why.**
Rejecting a line writes the reason into the shared `notes` field because there is
no rejection-reason column. It works, but the reason is then mixed in with
whatever else `notes` holds.

**5. Two of the four compliance gates have no evaluator.**
`down_payment_cap` and `license_active` are computed live from real data.
`signed_change_order` and `lien_release` are read from the new gates table, which
nothing writes to yet — so today every contract shows those two as "not yet
evaluated" rather than pass or fail. That is the honest state and it is rendered
as such, never faked as a pass, but the Compliance tab is half-informative until
something evaluates them.

**6. Budget line items have no vendor.**
The grid's first column shows a vendor under every line — "Delgado Builders",
"Meridian Tile". `budget_tracker_items` has no vendor foreign key. The only
vendor field anywhere nearby is a denormalized `vendor_name` text column on
`budget_expense_entries`, which belongs to an actual expense, not to the budget
line. So `vendorLabel` is null on every row today and that column renders empty.
Fixing it properly means a `vendors` table and a foreign key — the repo's own
rule forbids adding another `*_name` text column.

## Also done, not a question

`/admin/budget/grid` and `/admin/budget/inbox` now redirect into the new
workbench. Their islands read the pre-rebuild response shapes, and those shapes
cannot coexist with the new contract on the same endpoints. The island files are
still on disk so nothing is lost; a follow-up removes them.

## The question

Which of these six do you want fixed in this pull request, and which should
become their own work?

## Options

1. **Fix 1, 3 and 4 now; file 2, 5 and 6 as follow-ups.** *(recommended)* Those
   three are one additive migration — three columns, no backfill, no behaviour
   change — and they close the two places the repo's own rules are being bent.
   Number 2 needs a conversation about where a contract's value actually lives,
   and number 5 is a whole evaluation pipeline (reading change orders and lien
   waivers), neither of which belongs in a UI rebuild.
2. **Fix all six.** Adds a contract-value/down-payment column pair and a gate
   evaluator to this PR. Roughly doubles its size and puts compliance logic in a
   pull request nobody opened for compliance logic.
3. **Fix none; ship the UI and file all six.** Fastest to merge. The cost is
   that the approximations in 2 and 3 become the shipped behaviour, and the
   currency-convention gap in 1 stays in a table that is now on-screen.

## Default if no answer

I will take option 1 — add `amount_text` to `budget_funding_accounts`, a line
number to `estimate_line_items`, and a rejection-reason column, all additive —
and open follow-up tasks in colby-maestro for the contract value question, the
gate evaluator, and the missing vendor relationship. I will not touch the contract/estimate sourcing without an answer,
because guessing there produces a wrong number in front of a contractor.

## Decision

_(empty until answered)_
