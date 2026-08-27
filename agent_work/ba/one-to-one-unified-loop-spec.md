# 1-2-1 Unified Loop — Build Spec (v2)

**Supersedes** [one-to-one-loop-spec.md](one-to-one-loop-spec.md) **§3 D1** (scheduling
source) and **§9 phase 6** (Outlook mirror). Everything else in v1 stands and is still
the reference for the shipped loop.

Status: written 2026-08-27 from a live prod audit (§1). **All nine work packages are built
and pushed, and NONE OF IT IS DEPLOYED** — NOVA v1.1.474 on `nova-codex`, NEURO on `main`.
Prod still runs the old code, so the stalled sessions in §1 are still stalled and the
07:00 prep job still no-ops every morning. Deploying is Nick's to do; the two go out
together. Outstanding: only the deliberate omissions in §7 and the data remediation in §6.

⚠ **WP6.1 makes the two deploys a matched pair.** NOVA no longer writes an Outlook event,
so NOVA shipped without NEURO on the Pi means setting a date in NOVA books nothing.

---

## 0. What this changes, in one paragraph

v1 made NOVA authoritative for the 1-2-1 date and had NOVA write its own Outlook event.
In practice the scheduling actually happens in NEURO — that is where the free-slot finder,
the bulk "plan all → book all" flow and the attendee invite live — so NOVA's date has been
set by hand or not at all, and the day-before prep job has **never once fired**. v2 makes
the split explicit: **NEURO schedules, NOVA runs the 1-2-1, the vault is the record.**
NEURO owns both directions of traffic across the bridge, because NOVA prod cannot see the
vault and must never try to.

---

## 1. Evidence — prod audit, 2026-08-27

Read-only queries against `agent_121_*` on BYM-AAPP01. All of this is fact, not inference.

**The prep email has never been sent.** `agent_121_email_log` contains `weekly_kpi` rows
only — no `prep_agent`, no `prep_manager`, ever. The Friday KPI email sends fine to all 14
agents, so SMTP, the `dbo.Agent` roster and the `AgentKey` email lookup all work. The
failure is confined to the day-before job.

**Seven of eleven open sessions are stuck `in_progress`:**

| agent | scheduled | status | token | submitted |
|---|---|---|---|---|
| Nick Ward | 2026-06-27 | in_progress | none | — |
| Kayleigh Russell | 2026-07-01 | **scheduled** | none | — |
| Stephen Mitchell | 2026-07-02 | in_progress | yes | 2026-07-02 |
| Heidi Power | 2026-08-19 | in_progress | none | — |
| Luke Scaife | 2026-08-19 | in_progress | none | — |
| Maria Pappa | 2026-08-20 | in_progress | none | — |
| Nathan Rutland | 2026-08-25 | in_progress | none | — |
| Naomi Wentworth | 2026-08-25 | in_progress | none | — |
| Isabel Busk | 2026-08-25 | in_progress | none | — |
| Zoe Rees | 2026-09-15 | **scheduled** | none | — |
| Hope Goodall | 2026-09-17 | **scheduled** | none | — |

**Root cause.** [OneToOneSessionView.tsx:60](../../src/client/components/OneToOneSessionView.tsx#L60)
POSTs `/api/121/session/start` from a **mount effect**, and `startSession`
([one21-service.ts:148](../../src/server/services/one21-service.ts#L148)) unconditionally
sets `status = 'in_progress'`. So *opening* the wizard to glance at someone's KPIs burns
the session, and only `completeSession` moves it on. The day-before job matches
`status = 'scheduled'` and nothing else — those seven agents can never be prepped again.

The three genuinely `scheduled` rows simply never had a "tomorrow" land on them while the
job was live. Kayleigh's 01-Jul has been sitting overdue for eight weeks.

**Two more findings:**

- `one21_cadence_days` is **NULL on all 14 plans** → everyone silently falls back to the
  28-day default. Nathan's vault card says `cadence: fortnightly`; NOVA has never known it.
- Roster drift: `agent_development_plans` still holds **active** rows for **Arman Shazad**
  and **Willem Kruger** (left / moved team per the vault), and there is an open 1-2-1
  session for **"Nick Ward"** — Nick has one booked with himself.

---

## 2. Target architecture

### 2.1 Who owns what

| Concern | Owner | Why |
|---|---|---|
| Finding a slot, creating the Outlook event, inviting the person | **NEURO** | Only implementation that picks a real free slot, checks clashes and adds the attendee. NOVA's mirror hardcodes 10:00–10:30 and invites nobody. |
| Bulk booking the whole team | **NEURO** | `plan-all` / `book-all` already exist and are the flow Nick uses. |
| "Is this 1-2-1 overdue / stalled / unwritten" | **both, from one number** | NOVA holds session state; NEURO derives cadence state from the notes. They must agree — see §5. |
| Prep generation, prep questions, both emails | **NOVA** | Already built and correct. NEURO deleted its own generator on 14 Aug precisely to avoid two. |
| KPI snapshot, action tracking, delivery rate | **NOVA** | KPI DB access lives here. |
| Plaud binding to a session | **NOVA** | Reads Plaud direct via MCP — no vault round-trip needed. |
| People cards, development plans, 1-2-1 Tracker, action checkboxes | **vault, written by NEURO** | The human-readable record; NEURO already has every write service for it. |

### 2.2 Direction of travel

**NEURO initiates both legs.** The bridge stays one-directional in the network sense
(NEURO → NOVA), so `NEURO_BRIDGE_SECRET` and `bridgeAuth`
([neuro-bridge.ts:32](../../src/server/routes/neuro-bridge.ts#L32)) are reused unchanged
and NOVA gains no outbound dependency.

```
  book / bulk-book              NEURO  ──push──▶  NOVA   creates 'scheduled' session
  (Outlook event + invite)        │                        │
  stamps 1-2-1-booked in vault    │                        ▼
                                  │              day-before prep job fires
                                  │              (emails agent + Nick)
                                  │                        │
                                  │                        ▼
                                  │              Nick runs the 5-stage session,
                                  │              attaches the Plaud note, completes
                                  │                        │
  writes People card,             │◀──pull───────────────  │
  dev plan, actions               nightly
```

**NOVA never writes the vault.** NOVA prod runs on BYM-AAPP01; the vault lives on Nick's
machine and the Pi via Syncthing. NEURO runs on the Pi with the vault mounted and already
owns `obsidian.updatePersonNote`, `development-plan`, `action-items` and
`one-to-one-tracker`. Any attempt to give NOVA a vault path would either fail in prod or
create a second writer to files NEURO regenerates nightly.

---

## 3. Work packages

Ordered. WP1 is a blocker for everything and ships alone.

### WP1 — Stop viewing a session from consuming it *(NOVA)*

**Problem.** Opening the wizard sets `in_progress` forever; seven agents are wedged.

**Change.**

1. Split `startSession` in two:
   - `GET /api/121/session/for-agent/:name` — resolves (or lazily creates) the open session
     and returns it **without touching status**. The wizard's mount effect calls this.
   - `POST /api/121/session/:id/begin` — the explicit "Start 1-2-1" the manager clicks.
     Only this sets `in_progress`.
2. Add `POST /api/121/session/:id/abandon` → `status = 'abandoned'`, then run the same
   next-session scheduling `completeSession` does. Gives a wedged session a way out that
   isn't a fake completion.
3. Treat `in_progress` as **stalled** on the overview when `scheduled_date < today - 2`
   and `completed_at IS NULL`. New `stalled` count on `getOne21Overview`, rendered as its
   own tile and chip. **Never auto-complete and never auto-revert** — v1 §8 B6 already
   forbids NOVA silently rolling a date, and the same rule applies here.
4. Add `'abandoned'` to the terminal statuses; leave it out of `OPEN_STATUSES`.

**Files.** [one21-service.ts](../../src/server/services/one21-service.ts),
[one21-public.ts](../../src/server/routes/one21-public.ts),
[OneToOneSessionView.tsx](../../src/client/components/OneToOneSessionView.tsx),
[OneToOneOverviewView.tsx](../../src/client/components/OneToOneOverviewView.tsx).

**One-off remediation** (separate, after the code is deployed): for the six stalled August
sessions, either complete them properly through the UI or abandon them, so each agent gets
a fresh `scheduled` row. Kayleigh's 01-Jul row needs a new date. Delete the "Nick Ward"
session and his `agent_development_plans` row.

**Acceptance.** Open the wizard on any agent, close it without clicking anything, re-query:
status is unchanged. The overview shows a `stalled` count of 0 once remediation is done.

---

### WP2 — NEURO booking creates the NOVA session *(bridge + NEURO)*

**Problem.** Nothing connects the two. Without a `scheduled` row dated tomorrow, the prep
job is a no-op — which is why it has never sent an email.

**Change — NOVA side.** New router `neuro-bridge-121.ts`, mounted next to the existing
bridge routers, behind `bridgeAuth`:

```
POST /api/neuro-bridge/121/booking
  { agentName, date: "YYYY-MM-DD", startsAt?: ISO, outlookEventId?, source: "neuro" }
  → { ok: true, data: { sessionId, scheduled_date, created: bool, rescheduled: bool } }
```

Semantics mirror `POST /api/people/agent/:name/next-121`
([people.ts:439](../../src/server/routes/people.ts#L439)) — update the open session if one
exists, else insert `status = 'scheduled'` — with two differences: it **does not** call
`mirrorNext121ToOutlook` (NEURO already made the event), and it stores NEURO's
`outlookEventId` so a later reschedule matches the same meeting.

Rescheduling an already-prepped session resets `status` to `'scheduled'` and **clears the
email-log rows for that session id**, so prep re-fires for the new date. Without the clear,
the `agent_121_email_log` dedup key (the bare session id) silently suppresses it.

```
POST /api/neuro-bridge/121/cancel   { agentName }   → cancels the open session
GET  /api/neuro-bridge/121/state    ?days=60        → what NOVA thinks is booked, for reconciliation
```

**Change — NEURO side.** In [one-to-one-booking.js](../../../../nuero/backend/services/one-to-one-booking.js),
after the `updatePersonNote({ booked121 })` stamp in `book()` (line ~369) and in
`reschedule()` (line ~589), push to NOVA via
[nova-client.js](../../../../nuero/backend/services/nova-client.js).

Failure is **non-fatal and loud**: the calendar event and the vault stamp already
succeeded, so a failed push must not roll them back. Log it and record the pending push so
the reconciliation job (below) retries — a silently dropped push is a 1-2-1 with no prep,
which is the exact failure this WP exists to end.

Add a NEURO cron (`cron.schedule('20 6 * * *', ...)`, before NOVA's 07:00 prep job) that
reconciles: for every bookable direct report with a `1-2-1-booked` date, compare against
`GET /121/state` and push any that NOVA is missing or has wrong. This is the safety net
that makes a dropped push self-healing.

**Acceptance.** Book a 1-2-1 in NEURO for tomorrow → a `scheduled` NOVA session exists
within seconds; at 07:00 the agent gets the prep form and Nick gets the summary; both are
logged in `agent_121_email_log`.

---

### WP3 — Cadence comes from the vault *(bridge + NEURO)*

**Problem.** `one21_cadence_days` is NULL for all 14 agents, so NOVA schedules everyone at
28 days regardless of what the People card says.

**Change.** Extend the `/121/state` reconciliation push to carry `cadence` per person
(`weekly | fortnightly | monthly | n/a` from People frontmatter) and have NOVA map it onto
`agent_development_plans.one21_cadence_days` (7 / 14 / 28 / NULL). `cadence: n/a` sets the
plan `status = 'deferred'` so the person keeps their card and history but is never
auto-scheduled — matching NEURO's `bookable` rule exactly
([one-to-one-detect.js:116](../../../../nuero/backend/services/one-to-one-detect.js#L116)).

**Acceptance.** Nathan's card says `fortnightly`; after a sync, completing his session
proposes a date 14 days out, not 28.

---

### WP4 — Roster reconciliation *(NOVA + NEURO)*

**Problem.** Three name-keyed rosters with no join and no drift detection: NOVA's
`agent_development_plans.agent_name`, NEURO's `People/<name>.md` with
`direct-report: true`, and the vault's `Documents/HR/<name> - Development Plan.md`. Arman
and Willem are active in NOVA and gone from the team; Nick has a 1-2-1 with himself.

**Change.** The reconciliation job compares the two rosters and **reports** rather than
acts — auto-deactivating someone on a name mismatch is how you lose their history.

- Add a **Roster drift** panel to the 1-2-1 Overview: in NOVA but not a vault direct
  report; a vault direct report with no NOVA plan; name matches that differ only by case
  or whitespace.
- Exclude Nick himself explicitly (bridge is single-identity, `ALLOWED_EMAIL`).
- Document the canonical key as the **vault People filename**, and make NOVA's
  `agent_name` conform to it. v1 §8 B3 called `agent_development_plans.agent_name`
  canonical; it stays the storage key, but the vault is now the thing it must match.

**Acceptance.** The panel lists Arman, Willem and Nick Ward on first run and is empty
after remediation.

---

### WP5 — Write the 1-2-1 back to the vault *(NEURO)*

**Problem.** The loop currently dead-ends in `agent_121_actions`. The People card, the
development plan and `Tasks/Master Todo.md` never learn a 1-2-1 happened. This is the
half of Nick's step 4 that has no code at all.

**Change — NOVA side.** One read endpoint on the bridge:

```
GET /api/neuro-bridge/121/completed?since=YYYY-MM-DD
  → [{ agentName, sessionId, scheduledDate, completedAt, plaudRecordingId,
        notesText, actions: [{ id, description, owner, dueDate, status }],
        reviewedActions: [{ description, status }],   // delivered / missed / carried_over
        kpiSummary: { slaCompliancePct, qaOverallAvg, goldenRulesAvg, ticketsPerHourAvg, csatAvg } }]
```

**Change — NEURO side.** Nightly job (after the existing 1-2-1 detect sync, so the
detector has already seen any Plaud note) that, per completed session:

1. **People card** — `updatePersonNote(name, { last121, next121Due })`. Note the existing
   rule holds: `last-1-2-1` moves only when a note proves the meeting happened. NOVA's
   `completed_at` **is** that proof, so this is a legitimate second source — but it must
   write the same field with the same meaning, and `1-2-1-booked` must be cleared when the
   meeting is spent.
2. **Actions** — append new commitments to the person's 1-2-1 section as
   `- [ ] text 👤 [[People/Name|Name]] 📅 due` so the existing
   [action-items.js](../../../../nuero/backend/services/action-items.js) parser picks them
   up unchanged. Dedupe on NOVA's action id, stored in an HTML comment on the line, so a
   re-run never doubles them.
3. **Development plan** — for actions Nick flags as goal-progress, append a dated bullet
   via `development-plan.updateProgress`. Everything else stays an action; NOVA gets a
   "this is goal progress" checkbox on stage 5 to drive it.
4. **Meeting note** — if no Plaud note exists for the date, write a stub under
   `Meetings/1-2-1/<Name>/` from `notesText` so the session is not invisible in the vault.
   Must **not** be `type: meeting` unless it carries a `plaud_id`, or it will corrupt the
   dominance detector and the meetings-held ledger.
5. **Tracker** — `one-to-one-tracker.render({ apply: true })` last, so the table reflects
   the new dates.

Every write is dry-run-able and backs up the touched file, per the existing vault-mutation
convention.

**Acceptance.** Complete a 1-2-1 in NOVA with two actions → next morning the People card
shows the new `last-1-2-1`, both actions appear as unchecked boxes attributed to the
person, and the tracker row has moved out of overdue.

---

### WP6 — Retire the duplicates *(NOVA)*

1. **Delete `mirrorNext121ToOutlook`** and its call sites
   ([people.ts:345](../../src/server/routes/people.ts#L345), 462, and the cancel path).
   NEURO is the only calendar writer from WP2 on; leaving this alive means two events.
   Keep `outlook_event_id` on the table — it now stores NEURO's id.
2. **Collapse the two prep generators.** `generatePrepForAgent`
   ([people.ts:38](../../src/server/routes/people.ts#L38)) feeds the day-before job;
   `Briefing121Service` ([briefing-121.ts](../../src/server/services/briefing-121.ts)) is a
   second LLM brief with its own table and its own view. Pick one — the prep-snapshot path
   is the one wired into the loop, so `Briefing121Service` folds into it or goes. NEURO
   already made this exact call on its own side in August; the same reasoning applies.
3. **Log the no-op.** `runDayBeforePrep` returns silently when `processed === 0`
   ([index.ts:1178](../../src/server/index.ts#L1178)). That silence is why this went
   unnoticed for two months. Log every run, and surface "prep last sent" on the overview.

---

### WP7 — Don't book a 1-2-1 on someone's day off *(NEURO)* — optional

The PeopleHR absence feed already crosses the bridge
([neuro-bridge-availability.ts](../../src/server/routes/neuro-bridge-availability.ts)) and
nothing in either booking path consults it. Have `propose` / `planAll` filter out dates
where the person has approved leave. Note the endpoint's own warning: it carries
**approved** leave only, and `ok:false` means "could not look", never "nobody is off" — so
a failed read must fall through to booking, not block it.

---

## 4. Identity

One canonical key: **the vault People note filename** (`People/Nathan Rutland.md` →
`Nathan Rutland`).

- NOVA stores it in `agent_121_sessions.agent_name` and
  `agent_development_plans.agent_name` (unchanged storage, now with a defined source).
- The KPI DB joins on `dbo.Agent` / `dbo.jira_agent_kpi_daily.AgentName`, which already
  matches by full display name.
- NEURO resolves aliases via People frontmatter `aliases:` before pushing, so "Seb" and
  "Abdi Mohammad" arrive as the canonical name.
- Bridge payloads carry the canonical name only. **No fuzzy matching on the NOVA side** —
  a name NOVA does not recognise is a 404 and a drift-panel row, not a guess.

---

## 5. Two definitions of "overdue" must not diverge

NEURO's cadence state machine has five states — `booked`, `unwritten`, `overdue`,
`due-soon`, `ok` — and `unwritten` (held but never written up) has no NOVA equivalent.
NOVA has `overdue` (a passed `scheduled_date`) and, after WP1, `stalled`.

They map cleanly and should be stated once, in NEURO, which already derives from the notes:

| NEURO | NOVA equivalent |
|---|---|
| `booked` | open session, `scheduled_date` in future |
| `unwritten` | session complete, no `plaud_recording_id` and no vault note |
| `overdue` | open session, `scheduled_date` past |
| — | `stalled` — `in_progress`, past, never completed (new, WP1) |

Do **not** build a second cadence calculator in NOVA. NOVA reports session facts; NEURO
turns them into a state.

---

## 6. Sequencing

| # | WP | State | Notes |
|---|---|---|---|
| 1 | WP1 state machine | **built** | `resolveOpenSession` / `beginSession` / `abandonSession`; `stalled` on the overview |
| 2 | WP6.3 log the no-op | **built** | prep job logs every run |
| 3 | WP2 booking push | **built** | `/api/neuro-bridge/121/*`; NEURO inline push + 06:20 sweep |
| 4 | WP6.1 kill the Outlook mirror | **built** | must deploy WITH WP2 — see the status note |
| 5 | WP3 cadence | **built** | vault `cadence:` → `one21_cadence_days` |
| 6 | WP5 vault write-back | **built** | People card + actions + tracker; nightly, off the rollup |
| 7 | WP4 roster drift | **built** | panel on the overview (`GET /api/121/roster-drift`), plus the vault half in NEURO's 06:20 sweep |
| 8 | WP7 absence-aware booking | **built elsewhere** | delivered by a separate session in `one-to-one-booking.js` (`personOff` / `awayCheck`) |
| 9 | WP6.2 collapse prep generators | **built** | merged into `generatePrepForAgent`; see below |

**WP6.2 turned out not to be a merge of two working things.** `Briefing121Service` had
**never run** — `agent_121_briefings` held zero rows on 2026-08-27, and it would have been
mostly empty if it had: App.tsx passed the agent's *display name* as `agentId`, while its
queries match `jira_issue_cache.assignee_account_id` and `agent_training_signals.agent_id`,
both Jira account ids. Ticket performance, escalations, coaching signals, autonomy
interaction and every trend derived from them returned nothing, silently. Only the QA half
worked, because it happened to key on the name.

The ideas were sound and the wiring never was. [one21-prep-signals.ts](../../src/server/services/one21-prep-signals.ts)
is that content keyed properly (via `dbo.Agent.AccountId` — the lookup whose absence made
it a no-op) and folded into the prep that actually sends: escalations and their
appropriateness, AI-agent approve/reject, outstanding coaching signals, best/worst QA
tickets **by key**, and volume/time-to-resolve against the previous window. Rendered as an
**Evidence** block in the manager email and at stage 2, from the same numbers the model
reasoned over. Every gatherer fails soft and names what it could not get; the LLM is told
explicitly not to read a gap as a zero. Service, routes, view and tab deleted; the empty
table is left in place with a comment.

**Remediation still to do, once deployed** (data, not code — Nick has confirmed he is up
to date on the physical 1-2-1s, so these are real meetings that need *completing*, not
abandoning): the six stalled August sessions, Kayleigh's 01-Jul row, and deleting the
"Nick Ward" session and plan row.

**Test coverage.** 48 new tests — `one21-service.test.ts` (NOVA) plus
`nova-121-sync.test.js` and `nova-121-writeback.test.js` (NEURO) — pinning the rules that
would otherwise fail silently: stalled means `in_progress` and past rather than a
`scheduled` date that has simply gone by, prep stays editable until the manager opens the
1-2-1, case and spacing are the same person while a missing space is a typo, an
unchanged re-push is a no-op, a spent booking is not resurrected, `next-1-2-1-due` is
never pushed as a booking, a blank `cadence:` is unknown rather than off-the-rota, an
unreadable NOVA state aborts rather than re-pushing everyone, the actions block appends
rather than regenerates, and a tick Nick has made is never rewritten. Full NEURO suite:
1001 passing.

---

## 7. Open for Nick

Both of the first two were **deliberately left unbuilt** in WP5 rather than guessed at —
each would put speculative writes into the vault, and neither blocks the loop closing.

1. **Goal progress vs action** (WP5.3) — is a stage-5 checkbox the right way to mark
   "this one belongs on the development plan", or should every action just land as an
   action and goals stay hand-curated? **Not built.** Every action currently lands as an
   action on the People card; `Documents/HR/<name> - Development Plan.md` is untouched.
2. **Meeting-note stubs** (WP5.4) — worth writing when there is no Plaud recording, or is
   an unrecorded 1-2-1 better left showing as `unwritten` in the tracker? **Not built** —
   Nick writes the meeting notes himself, and a stub carrying `type: meeting` without a
   `plaud_id` would corrupt the dominance detector and the meetings-held ledger.
3. **`Areas/1-2-1 Tracker.md`** — now that NOVA has a real overview screen, does the
   generated tracker still earn its place, or does it retire?
4. **Weekly KPI email** — unchanged by any of this, but note per-agent satisfaction is
   permanently blank by design (survey anonymity) and will always render "—".
