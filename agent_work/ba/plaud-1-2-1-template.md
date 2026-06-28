# Plaud 1-2-1 Template (for NOVA)

A Plaud template + title convention so NOVA reliably detects a recording as a 1-2-1,
knows which agent it's for, and gets a summary structured to the 5 click-through stages.

## 1. Title convention (the important bit)

Name the Plaud recording **exactly** like this:

```
1-2-1 | <Agent Full Name> | <YYYY-MM-DD>
```

Examples:
- `1-2-1 | Abdi Mohamed | 2026-06-28`
- `1-2-1 | Heidi Power | 2026-07-15`

Rules NOVA relies on:
- Must **start with `1-2-1`** — that's how NOVA flags it as a 1-2-1 (badge in Scan Plaud).
- The **agent's full name** sits between the first two `|` pipes and must match their name
  in NOVA (e.g. "Abdi Mohamed", as on the My Team card).
- Date last, ISO `YYYY-MM-DD` (NOVA also reads the actual recording timestamp, so the date
  is for humans).

When titled this way, **Scan Plaud auto-flags it as a 1-2-1 and pre-selects the right
agent** — you just hit Assign. If Plaud can't set the title automatically, rename the
recording to this format after the meeting (one rename per 1-2-1).

## 2. Plaud AI template prompt

Create a custom template in Plaud (Templates → New) and paste this as the prompt:

```
This is a 1-2-1 management meeting between a manager and a team member. Summarise it
for our internal system (NOVA). Use British English. Be concise and factual. Capture
sentiment in the team member's own words. Do not invent anything not said.

Title this note exactly:
1-2-1 | <team member's full name> | <YYYY-MM-DD of the meeting>

Begin the note body with this exact line (NOVA reads it as a fallback):
NOVA-1-2-1 | Agent: <team member's full name> | Date: <YYYY-MM-DD>

Then output these sections, each with a "##" heading, in this order. If a section had
nothing, write "None discussed.":

## Outstanding actions reviewed
Bullet each action carried in from last time and its outcome: delivered, missed, or
carried over.

## KPIs discussed
Any performance numbers mentioned — SLA, QA, tickets per hour, CSAT, golden rules — and
the gist of the conversation about them.

## Discussion
Key talking points, wins, blockers, and context.

## Wellbeing & development
How the team member feels about their role and workload, and any progression they want.

## Agreed actions for next month
Bullet each new commitment. Include the owner and a due date where stated.
```

## 3. How NOVA consumes it

- **Scan Plaud** (1-2-1 Overview tab) lists recordings; the standardised title shows a
  **1-2-1 badge** and the agent is pre-selected. Assign → NOVA creates a 1-2-1 session
  dated to the recording and pulls the summary into the notes.
- The `##` sections map to the click-through stages (outstanding actions → KPI review →
  discussion → next-month actions), so the attached summary reads cleanly in NOVA.
- Recognition lives in `parseStdTitle()` in
  [one21-service.ts](../../src/server/services/one21-service.ts).
