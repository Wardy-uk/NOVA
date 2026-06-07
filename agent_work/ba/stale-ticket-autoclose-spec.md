# Stale Ticket Auto-Close — Unified Lifecycle (BA Spec)

Single source of truth for NOVA auto-closing tickets where we've chased the requestor
and had no response. **Supersedes** the two overlapping mechanisms that exist today.

Status: **AGREED** — D1–D5 signed off (§9). Ready for an implementation card + build.

---

## 1. Problem / why this exists

Tickets that sit in "Waiting on Customer" with no reply currently get inconsistent
handling, and many never close at all. Root cause: two separate, half-overlapping systems.

### Current state (what's live today)

**A. Lifecycle Manager** — `lifecycle-manager.ts` `checkStaleTickets()`
State machine on NOVA's **internal** `ticket_state` table:
`awaiting_customer →(48h)→ stale →(+1d)→ chase_sent →(+5d)→ auto_close_candidate →(+5d)→ closed`.
Closes as **No Fault Found**, SOP-003. Timings (`chaseDays=5`, `closeDays=10`) are **hardcoded**.

**B. Chase Sweep** — `agent-loop.ts` `runChaseSweep()`
JQL query against live Jira for `Waiting on Customer` / `Waiting for Customer`. Sends up to
2 chases (`agent_chase_after_days=5`, `agent_chase_interval_days=3`, `agent_chase_max_count=2`).
Chase body is a **hardcoded generic template** ("We're following up on…"). **Never closes.**

### Problems

| # | Problem | Impact |
|---|---------|--------|
| P1 | Only path **A** auto-closes, and it only sees tickets in NOVA's internal state table. | Tickets NOVA never tracked are chased by **B** but **never closed** → backlog of stale tickets. |
| P2 | Two systems, divergent thresholds (48h+1+5+5 vs 5+3). | Possible double-chasing, confusing behaviour. |
| P3 | Chase **B** body is generic. | Customers get an impersonal nudge that doesn't reference their actual issue. |
| P4 | Lifecycle timings hardcoded. | Can't tune without a code change. |
| P5 | Neither counts **human** chases — NOVA can chase a ticket an agent already chased. | Over-chasing, looks unco-ordinated. |
| **P6** | **Wrong status name.** Chase sweep **B** queries `status_name IN ('Waiting on Customer','Waiting for Customer')` — **neither exists in NT**. The real status is **"Waiting On Requestor"** (id `11768`), confirmed live in Jira (54 tickets sit there). | **The chase sweep currently matches ZERO NT tickets.** This is *the* root cause of stale tickets never being chased/closed. |

---

## 2. Goal

**One** configurable, JQL-driven stale lifecycle that covers **every** waiting ticket
(not just NOVA-tracked ones): chase up to twice — counting human *or* AI chases — with
ticket-specific AI chases, then auto-close after no response within the window.

---

## 3. Locked decisions (from product owner)

- **Window:** **5 working days** from the ticket entering "Waiting on Requestor", then close.
- **Chases:** **max 2** within the window. A chase counts whether sent by a **human or NOVA** —
  NOVA must detect existing chases and not exceed the cap / not stack on a human.
- **AI chase content:** **ticket-specific** — generated from the ticket's own context
  (summary + conversation + the actual outstanding question). No generic template.
- **Day counting:** **working days** (skip weekends + UK bank holidays).
- **Close resolution:** **Request Cancelled / Withdrawn** (`customfield_14494` id `13768`).
  Keeps "No Fault Found" meaningful for genuine no-fault closes.

---

## 4. Target lifecycle

Clock is **working-day** aware. `T0` = the moment the ticket enters a qualifying waiting status.

| Step | When (working days, customer still silent) | Action |
|------|--------------------------------------------|--------|
| Enter | T0 | Ticket detected in a waiting status; start clock. |
| Chase 1 | T0 + 2 wd | If chases-so-far < 1 → send **ticket-specific** chase (public). |
| Chase 2 (final) | T0 + 4 wd | If chases-so-far < 2 → send chase **+ explicit close warning** ("if we don't hear back by <date> we'll close this"). |
| Auto-close | T0 + 5 wd | If still in waiting status and no customer reply since T0 → close as **Request Cancelled / Withdrawn** with a polite public note + internal 🤖 note. |

**Chase counting (human or AI):** a "chase" = a **public/outward comment from a support-side
author** (NOVA service account *or* any internal agent) made while the ticket has been in a
waiting status since T0. NOVA sends a chase only when `count < 2` **and** the scheduled day is
reached **and** no support chase in the last interval (don't stack on a human who just chased).
The day-5 close is **independent** of who did the chasing — if a human already chased twice,
NOVA chases 0 times and still closes on schedule.

**Reset / abort conditions** (ticket leaves the flow, clock clears):
- Customer (reporter / portal customer) posts a public comment after T0, **or**
- Ticket moves out of a waiting status (agent picked it back up, resolved, escalated), **or**
- An exclusion (§7) applies.

**Reopen after close:** a customer reply after auto-close follows NOVA's existing reply-reopen
handling — Jira reopen + the ticket re-enters normal triage. (No special-casing here.)

---

## 5. AI chase content (ticket-specific)

Reuse the existing LLM chase path (`chase.txt` prompt + `chase-schema.ts` / `buildChaseDecision`),
**not** the hardcoded template in `runChaseSweep`. Chase must:
- Reference the **actual outstanding item** (what we asked for / what's blocking).
- Be grounded in the ticket summary + the public conversation so far.
- On **Chase 2**, state the close date plainly and that they can reply to reopen.
- Pass the existing `Actor.looksLikeStructuredPayload` guard (never post JSON/structured leakage).

---

## 6. Qualifying statuses & scope

- **Status (D1 — CONFIRMED live in Jira):** exactly **"Waiting On Requestor"** (status id `11768`,
  statusCategory In Progress). Match by **status id**, not name, to avoid the casing/name drift that
  caused P6. The old `Waiting on Customer` / `Waiting for Customer` names do **not** exist in NT and
  must be dropped. Status set is configurable in case more are added later.
- **Projects (D2 — CONFIRMED):** **configurable**, default **NT only** for now. Calyx is out
  (own SLO engine). NTPJ can be added later via config without a code change.

---

## 7. Exclusions (CONFIRMED)

Skip auto-close (chasing still allowed) when:
- Ticket carries a **`nova-no-autoclose`** label — manual opt-out for agents. *(new label)*
- **(D3 — CONFIRMED: exclude)** Ticket is currently **escalated** or in **Development / Tier 3**
  (`customfield_12981` CurrentTier = Development/Tier 3). These wait on internal/3rd-party work,
  not the customer — closing them for "no customer response" would be wrong.
- **(D4 — CONFIRMED: do NOT exclude)** **P1 / Critical** tickets **are** auto-closed if the
  customer goes silent for the full window — a P1 with no customer response isn't a live P1.
  Chases still go out first.

---

## 8. Config keys (proposed — replaces old keys)

| Key | Default | Purpose |
|-----|---------|---------|
| `stale_autoclose_enabled` | `true` | Master switch. |
| `stale_autoclose_projects` | `NT` | CSV of projects in scope. |
| `stale_autoclose_waiting_status_ids` | `11768` | Qualifying status **ids** (Waiting On Requestor). Match by id, not name. |
| `stale_chase_first_wd` | `2` | Working days of silence before chase 1. |
| `stale_chase_interval_wd` | `2` | Working days between chases. |
| `stale_close_wd` | `5` | Working days of silence before close. |
| `stale_chase_max` | `2` | Total chases (human + AI). |
| `stale_autoclose_resolution` | `Request Cancelled / Withdrawn` | Close resolution type. |
| `stale_autoclose_exclude_labels` | `nova-no-autoclose` | CSV of opt-out labels. |
| `stale_use_working_days` | `true` | Working vs calendar days. |

**Deprecate:** `agent_chase_enabled`, `agent_chase_after_days`, `agent_chase_interval_days`,
`agent_chase_max_count`, `agent_chase_batch_size`, and the hardcoded `chaseDays`/`closeDays`
in the lifecycle manager.

---

## 9. Decisions (RESOLVED — signed off)

- **D1 — status:** ✅ **"Waiting On Requestor"** (id `11768`), confirmed live. Match by id.
- **D2 — projects:** ✅ Configurable; **NT only** for now.
- **D3 — escalated / Dev / Tier 3:** ✅ **Excluded** from auto-close.
- **D4 — P1 / Critical:** ✅ **Not excluded** — they auto-close too.
- **D5 — autonomy:** ✅ **Run live** (respect existing shadow/hybrid/live mode; no extra approval gate).

---

## 10. Build notes / flags (for the implementation, not policy)

- ⚠ **BUILD FLAG — T0 (waiting-start) source.** The unified job is JQL-driven for coverage, so
  T0 must come from **Jira's status-change history (changelog)**, not NOVA's internal
  `ticket_state` (which only covers tracked tickets). Confirm `jira_issue_cache` stores a
  reliable "entered waiting at" timestamp, else fetch the changelog per candidate.
- ⚠ **BUILD FLAG — author role classification.** Counting chases and detecting customer replies
  both need "is this comment from support or from the customer?". Reuse the n8n/NOVA author
  settings (`nova_ai_jira_account_id`, support agent accounts) + reporter identity. Verify this
  is reliable on portal vs email-raised tickets.
- ⚠ **BUILD FLAG — working-day / UK bank-holiday calendar.** Need a holiday source. Check whether
  one already exists in NOVA (SLA timers may have one) before adding a new dependency.
- **Single owner:** implement as one service (e.g. `stale-lifecycle.ts`) invoked on the sweep
  interval. Retire `runChaseSweep` and the `checkStaleTickets` stale→chase→close branches so
  there is exactly one code path.

---

## 11. Acceptance criteria

1. A ticket in a qualifying waiting status with **no NOVA history** is chased and auto-closed on
   schedule (proves the P1 coverage gap is fixed).
2. A ticket a **human already chased twice** is **not** chased again by NOVA, but **is** closed on
   day 5 if the customer stays silent.
3. AI chase text **names the specific outstanding item** for that ticket (not a generic template).
4. A **customer reply** at any point aborts the flow (no chase, no close) and the clock clears.
5. Weekend/bank-holiday days **do not** count toward the 5-day window.
6. Auto-close sets resolution **Request Cancelled / Withdrawn** and posts a public note + internal note.
7. In **full_shadow** mode, every chase/close is logged but **not** sent/executed.
8. All thresholds/statuses/projects are driven by the §8 config — no code change to retune.

---

## 12. Status

**AGREED** (D1–D5 signed off). Next: write the implementation card (single `stale-lifecycle.ts`
service + config keys + migration off `runChaseSweep` and the lifecycle stale→close branches),
then build. Acceptance criterion #1 (the P6 wrong-status-name + coverage gap) is the headline fix.
