# 1-2-1 Closed Loop — BA Spec

Bring the **Standup** feature's closed-loop principles to the **1-2-1** feature
(People → My Team). Schedule → auto-prep → two-way email → click-through session →
Plaud auto-import → action tracking → weekly KPI nudge.

Status: **AGREED** — core decisions D1–D5 (§3) and BA items B1/B2/B4/B5/B6 (§8) signed off
with Nick. Only B3 remains (an engineering check, not a decision). Ready for build cards.
The **My Team** roster grid ([AgentRosterView.tsx](../../src/client/components/AgentRosterView.tsx))
must look and behave the same — we add to it, we don't redesign it.

---

## 1. Why this exists

The Standup feature is a clean closed loop: cron sends morning prompts → agents submit →
commitments are tracked → a nightly accountability report runs + Plaud import → manager
dashboard shows it all. The 1-2-1 feature is currently thin by comparison:

- **My Team grid** ([AgentRosterView.tsx](../../src/client/components/AgentRosterView.tsx)) —
  per-agent KPI cards, "Generate 1-2-1 Prep" (LLM call → `agent_121_snapshots`) and
  "1-2-1 Snapshot" buttons.
- **Next 1-2-1 date** is read **live from each agent's Outlook calendar** (people.ts
  `/roster/calendar`, keyword-matched events). Nothing stored in NOVA → unreliable, and
  no way to track the **last** 1-2-1.
- No scheduling, no day-before automation, no agent prep loop, no multi-stage session
  flow, no action accountability, no weekly KPI email.

We reuse the standup plumbing (cron registry, `email-templates.ts`, `plaud-service.ts`,
KPI reads) rather than building parallel infrastructure.

---

## 2. Goal

A per-agent monthly 1-2-1 cycle that runs itself:

1. Manager sets the **next 1-2-1 date** in NOVA (authoritative); NOVA mirrors it to Outlook best-effort.
2. **Day before**, NOVA auto-generates prep and emails **both** parties — the agent gets
   configurable prep questions (answers come back into NOVA), the manager gets a summary.
3. Manager runs a **5-stage click-through** session.
4. NOVA **auto-imports the Plaud** note for the session into the discussion stage.
5. New actions are tracked to delivery; outstanding actions are reviewed at the next 1-2-1.
6. Every **Friday PM** each agent gets their own KPI card by email.

The My Team grid stays as-is, gains a real **Next / Last 1-2-1** date (from NOVA, editable).

---

## 3. Locked decisions (from Nick)

- **D1 — Scheduling source: Hybrid, NOVA-authoritative.** NOVA stores `next_121_date`
  per agent; Nick can **manually set/edit it in NOVA** and that value always wins. NOVA
  *also* writes a best-effort matching Outlook event. The calendar is **never** allowed to
  overwrite a manual NOVA value (calendar sync is not trusted). Track `last_121_date` too.
- **D2 — Prep loop: answers come back into NOVA.** The day-before email to the agent links
  to a NOVA submission form (standup-style). Their answers are stored against the session
  and surfaced on the manager's prep screens before the meeting.
- **D3 — Click-through: 5 stages, in this order** (each its own screen):
  1. **Review outstanding actions** from last 1-2-1 — mark delivered / missed / carried-over
     (mirrors standup commitments).
  2. **KPI review** — the card metrics + trend (mirrors standup's Jira review).
  3. **Prep answers** — what the agent submitted via the day-before form.
  4. **Discussion / free notes** — the **Plaud summary auto-lands here**.
  5. **New commitments/actions for the coming month.**
  End = save session + set next 1-2-1 date.
- **D4 — Weekly KPI email: Friday PM, agent only.** Each agent gets their own KPIs
  (KPI health, QA, Golden Rules, training, satisfaction — RAG-coloured, same as the My Team
  card). Nick is **not** copied (he already sees the whole team on screen). Reuses standup
  cron + email infra.
- **D5 — Prep questions + email copy are configurable** (BA detail in §8).

---

## 4. Data model

New tables (schema.ts, `IF NOT EXISTS` + ALTER pattern). Reuse `agent_121_snapshots` /
`agent_121_actions` where they already fit.

### 4.1 `agent_121_sessions` (new — the scheduled cycle)
| col | type | notes |
|---|---|---|
| id | INTEGER PK | |
| agent_name | TEXT | matches roster identity used elsewhere |
| scheduled_date | TEXT (date) | the **next** 1-2-1 — Nick-editable, authoritative |
| status | TEXT | `scheduled` → `prep_sent` → `awaiting_agent` → `ready` → `in_progress` → `complete` → `cancelled` |
| prep_snapshot_id | INTEGER FK | → `agent_121_snapshots` (the auto-generated prep) |
| agent_submission_json | TEXT | answers to prep questions (D2) |
| agent_submitted_at | TEXT | null until they submit |
| outlook_event_id | TEXT | best-effort mirror (D1); null if mirror failed |
| plaud_recording_id | TEXT | matched Plaud note |
| notes_text | TEXT | discussion stage / Plaud summary lands here |
| completed_at | TEXT | sets `last_121_date` semantics |
| created_at | TEXT | |

`last_121_date` per agent = `MAX(completed_at)` over their sessions (no separate column needed).
`next_121_date` = the open `scheduled`/`ready` session's `scheduled_date`.

### 4.2 `agent_121_snapshots` (existing — reuse)
Already holds `metrics_json`, `goals_json`, `prep_json`, `notes`, `transcript_md`. The
day-before auto-prep writes here exactly like "Generate 1-2-1 Prep" does today
([people.ts](../../src/server/routes/people.ts) `generatePrepForAgent`). Link via
`agent_121_sessions.prep_snapshot_id`.

### 4.3 `agent_121_actions` (existing — extend usage)
Already has `snapshot_id`, `description`, `owner`, `due_date`, `status`, `completed_at`.
Add `session_id` (FK to `agent_121_sessions`) so actions tie to the cycle, and use the
status workflow `pending → delivered / missed / carried_over` (mirrors standup commitments).
Stage 1 reviews the prior session's open actions; stage 5 creates new ones.

### 4.4 `agent_121_email_log` (new — idempotent dedup)
Same shape/role as `standup_email_log`: `(session_id, kind, sent_at)` where `kind ∈
{prep_agent, prep_manager, weekly_kpi}`. Prevents double-sends on the 5-min poll.

### 4.5 Settings keys (configurable — D5)
`one21_prep_questions` (JSON array), `one21_prep_email_subject`, `one21_prep_email_intro`,
`one21_manager_summary_intro`, `one21_weekly_kpi_subject`, `one21_weekly_kpi_intro`,
`one21_default_cadence_days` (default 28). Plus reuse of existing SMTP settings.

---

## 5. Scheduling / automation (cron, internal — like standup)

Add jobs to the `jobRegistry` in [index.ts](../../src/server/index.ts) (same 5-min poll
pattern as the standup jobs at lines ~1071–1093). No n8n.

| Job | When | Action |
|---|---|---|
| **121 day-before prep** | Daily, AM (e.g. 07:00 UK) | For each session with `scheduled_date = tomorrow` and status `scheduled`: generate prep snapshot, email agent (prep questions + form link) and manager (summary). Set status `prep_sent`/`awaiting_agent`. Dedup via `agent_121_email_log`. |
| **121 Plaud surface** | Daily, after meetings (e.g. hourly PM) | For sessions whose `scheduled_date ≤ today` and status `in_progress`/`ready` with no `plaud_recording_id`: flag that candidate Plaud notes (title contains agent name) exist. **No auto-bind** — manager picks on the discussion stage (§7). |
| **Weekly KPI email** | **Friday PM** (D4) | For each rostered agent with data: email their own RAG KPI card. Dedup via `agent_121_email_log` keyed on ISO week. |

**Outlook mirror (D1):** when Nick sets/edits `scheduled_date`, NOVA writes/updates an
Outlook event via MS Graph MCP and stores `outlook_event_id`. Failure is non-fatal and
logged — the NOVA date stands regardless. A calendar read may *suggest* a date in the UI
but must never silently overwrite a manually set value.

---

## 6. Emails (reuse `email-templates.ts`)

Three new branded templates, dark theme matching standup:
- **`one21PrepAgentHtml`** — intro + the configurable prep questions + a button to the
  NOVA submission form (`/121/submit/:sessionId`, public-tokened like standup submit).
- **`one21PrepManagerHtml`** — the prep summary (`prep_json`: what's improved / needs
  attention / talking points) so Nick walks in informed.
- **`one21WeeklyKpiHtml`** — the agent's own RAG KPI card (KPI health, QA, GR, training,
  satisfaction), same metrics as the My Team card.

---

## 7. Plaud auto-import (reuse `plaud-service.ts`)

Standup matches a recording by **date** (`findStandupRecording(date)`). 1-2-1s are
per-agent, so date alone is ambiguous on a day with several 1-2-1s. **Decision (Nick): no
auto-bind — present all matching notes for the manager to pick.**
- On the discussion stage, NOVA lists **all** Plaud notes whose **title contains the team
  member's name** (primary filter), ordered by recency / proximity to `scheduled_date`.
- Manager clicks the right one → its summary lands in `notes_text` and `plaud_recording_id`
  is stored. No silent auto-import.
- If nothing matches by name, fall back to listing notes near the date so the manager can
  still attach manually.
- The "121 Plaud import" cron job (§5) is therefore **surfacing/notify only** (flag that
  candidate notes exist), not auto-binding.

---

## 8. BA items (resolved unless noted)

- **B1 — Prep questions. RESOLVED.** Default set (editable in Settings):
  1. What went well this month?
  2. What got in your way / what's blocking you?
  3. What do you want to focus on next month?
  4. Anything you want me to know, or any support you need from me?
  5. Looking at your KPIs this month, what are you most proud of?
  6. Looking at your KPIs this month, what do you most want to improve?
  7. How are you feeling about your role and workload right now?
  8. What progression are you working towards, and how can I support you in getting there?
- **B2 — Cadence. RESOLVED.** Monthly (28-day) **default**, with a **per-agent override**
  (e.g. weekly for someone on a plan). On completing a session NOVA proposes the next date
  using that agent's cadence; Nick can **manually reschedule** any date and it always wins.
  Needs a `cadence_days` column on the agent's roster/plan record (default 28).
- **B3 — Identity mapping. RESOLVED (verified in code).** The canonical key everywhere is
  the agent's **full display name** = `agent_development_plans.agent_name`. KPI DB
  `dbo.jira_agent_kpi_daily.AgentName` is matched to it directly; calendar matches on first
  name + keywords ([people.ts](../../src/server/routes/people.ts) `/roster/calendar`); Plaud
  will match name-in-title; non-admin scope resolves via `user.display_name`
  ([people.ts](../../src/server/routes/people.ts) `resolveAgentScope`). New
  `agent_121_sessions.agent_name` uses this same display-name key.
- **B4 — Plaud matching. RESOLVED.** No auto-bind. NOVA lists all notes whose **title
  contains the agent's name**; manager picks (§7).
- **B5 — Access. RESOLVED.** Managers/admins run the click-through and see **all** agents'
  1-2-1s. Each agent can view **only their own** past 1-2-1 summaries + outstanding actions
  (read-only, in My NOVA) — never anyone else's.
- **B6 — Missed dates & action rollover. RESOLVED.** A passed `scheduled_date` with no
  completed session shows as **overdue** on the My Team card (amber/red) until Nick runs or
  reschedules it — NOVA **never silently auto-rolls** the date. Open actions from the prior
  session **auto-carry-forward** into stage 1 of the next session as `carried_over` so
  nothing is lost.

---

## 9. Build phases (proposed)

1. **Schema + scheduling spine** — new tables, `next/last_121_date` stored & editable on the
   My Team card, manual date setter (no automation yet). **✅ SHIPPED (2026-06-26).**
   Tables `agent_121_sessions` + `agent_121_email_log`, `one21_cadence_days` +
   `agent_121_actions.session_id` columns ([schema.ts](../../src/server/db/schema.ts)).
   Routes `GET /api/people/roster/sessions`, `POST /agent/:name/next-121`,
   `POST /agent/:name/next-121/cancel` ([people.ts](../../src/server/routes/people.ts)).
   My Team card 1-2-1 cell now editable, NOVA date authoritative over calendar, overdue =
   red, last 1-2-1 in tooltip ([AgentRosterView.tsx](../../src/client/components/AgentRosterView.tsx)).
2. **Day-before prep + agent submission loop** — cron prep job, two emails, public submit form.
   **✅ SHIPPED (2026-06-26).** Daily 07:00 UK job `one21-day-before-prep` processes
   sessions scheduled for tomorrow: generates the prep snapshot (reuses
   `generatePrepForAgent`), emails the agent their configurable prep questions (token-gated
   form link) + the manager the summary, advances status `scheduled → awaiting_agent`.
   Idempotent via `agent_121_email_log`. Config `one21-config.ts` (8 default questions,
   editable via `one21_prep_questions`). Public form at `/121/submit/:token`
   ([OneToOneSubmitForm.tsx](../../src/client/components/OneToOneSubmitForm.tsx)); answers
   land in `agent_submission_json`, status → `ready`. Routes `GET /api/121/public/:token`,
   `POST /api/121/submit` (public), `POST /api/121/run-prep` (admin manual trigger).
   Service: [one21-service.ts](../../src/server/services/one21-service.ts). Weekly-KPI email
   template also pre-built for Phase 5.
3. **5-stage click-through UI** — new session view (the only net-new sizeable UI), wired to
   actions/KPIs/prep answers/notes. **✅ SHIPPED (2026-06-26).** Full-screen wizard
   [OneToOneSessionView.tsx](../../src/client/components/OneToOneSessionView.tsx) launched
   via a "Run 1-2-1" button on the agent profile (My Team grid untouched). Stages:
   outstanding actions (delivered/missed/carried_over) → KPI review (30-day averages + prep
   highlights) → their prep answers → discussion notes → next-month commitments + next date.
   Backend: `startSession`/`getSessionDetail`/`updateActionStatus`/`addSessionAction`/
   `updateSessionNotes`/`completeSession` ([one21-service.ts](../../src/server/services/one21-service.ts));
   routes `POST /api/121/session/start`, `GET /session/:id`, `PATCH /action/:id`,
   `POST /session/:id/action`, `PATCH /session/:id/notes`, `POST /session/:id/complete`.
   Completing schedules the next session at the agent's cadence (or a manual date);
   carried-over actions resurface in the next session's stage 1.
4. **Plaud auto-import + manual attach.**
5. **Weekly Friday KPI email.**
6. **Outlook two-way mirror** (best-effort; last because it's the least trusted).

Each phase ships independently; the My Team grid keeps working throughout.
