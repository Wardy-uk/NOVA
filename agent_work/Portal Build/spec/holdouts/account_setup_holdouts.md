# Account Setup / Office Changes — Holdout Scenarios

**STATUS: ACTIVE — CONVERGENCE BASELINE**
This suite becomes the regression baseline when the domain achieves convergence.

## Purpose

These scenarios are intentionally difficult, ambiguous, emotional, incomplete, or operationally messy.

They exist to:
- stress conversational robustness
- expose taxonomy leakage
- expose conversational resets
- test operational usability
- prevent shallow convergence
- validate bounded disambiguation behaviour
- test cross-domain routing accuracy

These holdouts are evaluator-owned.

The Build Agent must not optimise narrowly against exact wording.

---

## Holdout 1 — Vague Access Failure

"I can't get into anything."

Tests:
- ambiguity handling without platform picker
- conversational follow-up (what happens when you try?)
- avoidance of "which system?" question
- graceful intake without forcing the customer to diagnose

---

## Holdout 2 — Login vs Permissions Ambiguity

"I'm locked out of the reports."

Reality may actually be:
- password expired
- session timeout
- permission revoked
- report scope changed
- data not loaded

Tests:
- disambiguation stays bounded (one question max)
- question focuses on symptom, not system
- does not expose permission model terminology
- does not route prematurely to Data/Reporting

---

## Holdout 3 — Office Move vs CRM Issue

"We've moved offices and nothing is working properly."

Tests:
- structural change recognised
- does not assume which systems are affected
- follow-up asks what specifically isn't working
- does not present system-by-system checklist
- preserves the "moved offices" context into summary

---

## Holdout 4 — Missing User vs Sync Delay

"The new starter says they can't see anything in the system."

Tests:
- distinguishes provisioning gap (Account) from data sync delay (Integration)
- disambiguation question focuses on whether the user was recently set up
- does not ask "which system can't they see?"
- preserves person context (new starter)

---

## Holdout 5 — Account Setup vs Reporting Visibility

"Our new branch manager can't see the performance data."

Tests:
- disambiguates between Account (access not provisioned) and Data (reporting scope)
- one question maximum
- question is about the person/situation, not about systems
- preserves role context (branch manager) and data context (performance data)

---

## Holdout 6 — Urgent User Removal (Security Undertone)

"We need to remove James immediately. He was let go this morning."

Tests:
- urgency handling
- security sensitivity
- minimal follow-up (just email/confirmation)
- no disambiguation — intent is unambiguous
- no "which systems?" question
- fast-track to ticket

---

## Holdout 7 — Multi-Office Restructure

"We're merging the Leeds and Sheffield offices into one and closing Sheffield. There are about 15 users who need moving."

Tests:
- structural complexity preserved
- office names and user count preserved
- no internal account hierarchy terminology
- operationally useful summary
- reasonable follow-up (timeline, who specifically)

---

## Holdout 8 — Follow-Up on Previous Request

"I raised this two weeks ago and nothing's happened. We still need those users set up."

Tests:
- previous request reference preserved
- frustration acknowledged
- does not restart discovery from scratch
- treats as escalation/chase, not new request
- operationally useful context (timeframe, outstanding action)

---

## Holdout 9 — Anti-Bot User

"Just reset my password. Email is john@example.com. Don't need to go through all the questions."

Tests:
- respects user's intent to skip discovery
- captures the essential detail (email)
- does not force unnecessary follow-up
- no disambiguation needed
- fast, efficient intake

---

## Holdout 10 — Cross-Domain Boundary Probe (Website)

"Our website is showing the old Manchester office as active but we closed it last month."

Tests:
- correctly identifies this as Website domain (display issue), NOT Account Setup
- does not capture as office closure request
- routes to Website Design pathway
- no disambiguation needed — website display intent is clear

---

## Holdout 11 — Cross-Domain Boundary Probe (Integration)

"Leads from the new Bradford office aren't reaching anyone. We set it up last week."

Tests:
- genuine ambiguity — Account (office not fully provisioned) vs Integration (lead routing not configured)
- disambiguation allowed but must be ONE question max
- question focuses on what they've observed, not which system
- preserves both office context (Bradford, new, last week) and symptom (leads not reaching)

---

## Holdout 12 — Emotionally Escalated with Mixed Signals

"This is ridiculous. I've been locked out for three days, the new users still aren't set up, and nobody from your team has called me back."

Tests:
- frustration acknowledged
- multi-issue recognised (personal lockout + new user setup + service failure)
- does not disambiguate — all issues are clearly Account domain
- does not try to split into separate tickets conversationally
- preserves all three concerns in summary
- previous contact attempt noted

---

## Holdout 13 — Disambiguation Fallback (Ambiguity Survives)

"Something's not right with our account."

Tests:
- vague enough that disambiguation is attempted
- one question asked (what specifically isn't working?)
- if customer responds equally vaguely ("just... everything"), system routes to Account Setup as safe default
- ambiguity noted in summary for support agent
- does NOT ask a second clarifying question
- does NOT present a picker

---

## Holdout 14 — Customer Uses Internal Terminology

"I need my RBAC permissions updated to include the new branch data scope."

Tests:
- customer-introduced technical language is preserved (they know what they want)
- system does not echo or expand on RBAC terminology
- system does not correct or reframe the customer's language
- operationally useful summary preserves their exact request
- no additional technical probing
