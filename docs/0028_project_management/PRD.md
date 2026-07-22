# 0028 — PRD: Project management as a shared capability

**Date:** 2026-07-22 · **Owner:** Justin · **Status:** Draft for review

---

## 1. The problem

Two projects are running at once and neither is tracked well.

**The software project.** Features get planned in `docs/####_*` bundles and seeded
into `plans` + `plan_tasks`, and then the tasks are never touched again. A session
ships work, writes a changelog entry, and leaves twelve rows sitting at `pending`.
There is no burndown, no velocity, no way to answer "what is actually left" without
reading git.

**The remodel.** A house renovation with a general contractor, subcontractors,
permits, appliance deliveries, a PG&E service upgrade, and a contract full of
payment milestones. Today that lives in a mix of ClickUp, email, and the
homeowner's head. When something slips, nobody finds out until it has already
blocked something else.

They are different methodologies — the software work is agile-ish, the remodel is
waterfall — but they need **the same views**: a board, a schedule, a backlog, a
grid, a progress rollup, and a written narrative of what is coming.

## 2. Who this is for

| User | What they need | What they will actually do |
|---|---|---|
| **Homeowner (admin)** | Everything. Full visibility, every report, drill from a payment milestone down to the discrete task that satisfies it. | Reviews AI-flagged risks, approves outbound comms, decides trade-offs. |
| **General contractor** | Their own tasks, the schedule, what is blocking them, what is arriving when. | Updates status — ideally from a phone, ideally without learning a new tool. |
| **Subcontractor / trade professional** | Only the tasks they are attached to, plus the schedule context around them. | Reads. Occasionally confirms a date or posts a photo. |
| **Coding agent** | A machine-readable backlog and a way to close a task against a PR. | Creates and closes tasks via MCP as a required part of every turn. |

## 3. Why anyone outside the household uses it

A tool nobody updates is worth nothing, and a contractor can always refuse to use
it — or price the annoyance into the bid. So participation has to be *earned*:

1. **Lowest possible friction to contribute.** ClickUp stays usable directly; our
   system syncs to it rather than replacing it. Status updates should be answerable
   by replying to a message with a sentence and a photo.
2. **Reports worth logging in for.** Upcoming milestones, what is blocked and why,
   delivery ETAs, schedule impact — a subcontractor genuinely benefits from knowing
   the drywall is late before they drive over.
3. **Fewer disputes.** A written, agreed, illustrated description of what each phase
   delivers is protection for the contractor as much as the homeowner. Payment
   milestones argued about in advance are not argued about at invoice time.

## 4. Goals

- **G1** One reusable component layer serving both projects. Board, grid, backlog,
  Gantt, velocity — written once.
- **G2** D1 stays current, because closing a task requires a PR number and agents
  are required to do it.
- **G3** Micro↔macro. Discrete tasks (unambiguous enough for an AI or a new
  subcontractor to execute) roll up into phases, phases into a program view.
- **G4** The preview-changelog / changelog practice extends to the remodel: agree
  what a phase delivers **before** it starts, record what it delivered after.
- **G5** External signals move the schedule automatically — shipment ETAs, permit
  status, contract dates — instead of being noticed late.
- **G6** A permission model that is real in the data from day one, even while the
  gate is still open.

## 5. Non-goals (this release)

- Real per-person contractor logins — that is 0029, and 0028 is deliberately shaped
  to make it a small change.
- Sending anything. NagBot drafts; a human approves and sends. Choosing a transport
  (wire up the existing unused email binding vs. add Twilio for SMS) is a **spend
  decision** and is not made here.
- Replacing ClickUp. ClickUp remains the master record for remodel tasks.
- QR flyers and RAG chat over installation manuals — good ideas, separate plans.

## 6. Key user stories

- As the **homeowner**, I open a phase and see the tasks, the schedule, what is at
  risk, and a written narrative of what the house will look like when it is done.
- As the **homeowner**, I upload a draft contract and the system extracts the payment
  and timeline milestones, generates the task breakdown, and tells me **what is
  missing** before I sign it.
- As a **contractor**, I get a weekly view of my upcoming work and what is blocking
  it, and I can update a task without opening a laptop.
- As a **subcontractor**, I see the three tasks I am attached to and nothing else.
- As a **coding agent**, I list open tasks at session start, create tasks for work I
  discover, and close each one against the PR that shipped it.
- As the **homeowner**, I see engineering velocity — deploy frequency, lead time,
  PR throughput, and what is stuck — drawn from D1 tasks and GitHub together.

## 7. Success criteria

| # | Criterion | How it is measured |
|---|---|---|
| S1 | One component set renders both projects | The same `<WorkBoard>` renders `plan_tasks` and `planning_tasks` with no source-specific props |
| S2 | Task rot stops | Open `plan_tasks` rows older than the merged PR that finished them → zero |
| S3 | Closing requires a PR | `close_plan_task` with no `prNumber` returns an error, verified in QC |
| S4 | Schedule reacts to reality | A changed shipment ETA moves the blocking task's start date within one cron cycle |
| S5 | Contract gaps surface pre-signature | Every payment milestone maps to ≥1 task, or is reported as a gap |
| S6 | Permissions are real in the data | Every work item has ≥1 watcher row; `viewerContext` is the only authorization decision point |
| S7 | Remodel phases get the changelog treatment | Each remodel phase has a preview entry before it starts and a shipped entry after |

## 8. Open questions for Justin

1. **Outbound transport.** Wire up the existing (free, already-declared) `send_email`
   binding, or add Twilio for SMS? SMS is what actually gets a contractor to reply,
   but it is a new vendor and a recurring bill.
2. **ClickUp list structure.** One list for the whole remodel, or one per phase/trade?
   This determines whether the mirror is one list id or many.
3. **Sprint concept for the remodel.** Waterfall has no sprints. Use **weeks** as the
   reporting cadence for the remodel side, and keep sprints for software only?
4. **Effort units.** Story points on the software side. For the remodel — crew-days?
   Or leave effort null and rely on start/end dates alone?
5. **How much does a subcontractor see of the budget?** Currently: nothing. Confirm
   that stays true even for the line items covering their own work.
