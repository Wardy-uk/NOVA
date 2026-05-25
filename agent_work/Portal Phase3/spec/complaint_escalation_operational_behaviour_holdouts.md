# Complaint / Escalation Holdout Scenarios

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name: Complaint / escalation operational behaviour
- Phase: Portal Phase3

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Customer says they want to make a complaint about repeated poor service | Mature systems often soften or ignore explicit complaint language | The portal treats this as complaint/escalation context and moves the customer forward safely |
| H2 | Customer is angry but also gives actionable service detail | Emotional language and operational detail often compete for routing | The portal preserves both the complaint context and the actionable detail without collapsing into generic intake |
| H3 | Customer asks for escalation without using the word `complaint` | Real users often ask for escalation implicitly | The portal recognises escalation intent and behaves coherently without requiring exact taxonomy words |

## Edge Inputs

- Input: "I want to make a complaint about how this has been handled"
- Input: "This is the third time I've asked. Please escalate this"
- Input: "I'm really unhappy with the response time and need this escalated today"

## Regression Traps

- Trap: complaint language is acknowledged emotionally but routed like an ordinary request with no escalation-aware outcome
- Trap: the portal leaks internal escalation or queue language to explain what it is doing
- Trap: the complaint category exists visually but conversational paths still ignore complaint intent
- Trap: follow-up continuity or existing protected categories regress while complaint handling is added
