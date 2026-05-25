# Property / Listing Issues — Evaluation Standard

## Purpose

This document defines how behavioural convergence will be evaluated for Property / Listing Issues conversational intake.

The evaluator assesses:
- observable customer behaviour
- operational usability
- conversational continuity
- hidden routing complexity
- preservation of customer-provided information

The evaluator does NOT assess:
- implementation quality
- code structure
- internal architecture
- hidden taxonomy design
unless these leak into observable behaviour.

---

## Runtime Requirements

Evaluation must use:
- real frontend runtime
- real backend conversational runtime
- real persistence layer where practical
- real conversational routing path
- mock bypass path if required

Mock-only evaluation is invalid if it bypasses the runtime behaviour under test.

---

## Evaluation Principles

### Customers Should Be Able To Speak Naturally

Customers should be able to describe:
- missing listings
- incorrect details
- broken feeds
- sync issues
- media problems
- portal inconsistencies

without needing:
- portal expertise
- feed terminology
- system knowledge
- manual categorisation

---

### Classification Must Remain Invisible

Customers must not see:
- integration categories
- portal routing labels
- confidence language
- feed classifications
- operational team names

---

### Conversational Continuity Must Persist

The system should:
- acknowledge what the customer actually said
- preserve previously supplied information
- ask contextual follow-up questions
- avoid repeated discovery

The system must not:
- reset conversationally
- discard operational context
- ask the customer to diagnose the issue technically

---

## Core Evaluation Scenarios

### Scenario 1 — Missing Listing
Example:
"One of our properties isn't showing on Rightmove."

Expected:
- conversational acknowledgement
- follow-up asking which property
- no category picker
- no feed terminology

---

### Scenario 2 — Incorrect Property Details
Example:
"The price for 14 Church Lane is wrong."

Expected:
- property context preserved
- operationally useful follow-up
- no conversational reset

---

### Scenario 3 — Missing Media
Example:
"The floorplan disappeared from one of our listings."

Expected:
- media issue recognised conversationally
- attachment-aware behaviour possible
- no self-classification

---

### Scenario 4 — Portal Sync Ambiguity
Example:
"A property update isn't appearing everywhere."

Expected:
- conversational clarification
- portal/feed complexity hidden
- no technical diagnosis required from customer

---

### Scenario 5 — Website vs Portal Ambiguity
Example:
"This property isn't showing properly."

Expected:
- intelligent clarification
- preservation of conversational flow
- no category picker cliff

---

### Scenario 6 — High Context Report
Example:
"Property 12345 updated in our CRM yesterday but Rightmove still shows the old photos and Zoopla is missing the EPC."

Expected:
- chronology preserved
- portals preserved
- operationally useful summary
- no information loss

---

### Scenario 7 — Human Escalation
Example:
"This has been broken for days and I need someone to sort it now."

Expected:
- frustration acknowledged
- graceful escalation handling
- operational continuity preserved

---

## Regression Requirements

Previously protected behaviours from Website Design / Content Changes must not regress.

Shared protected behaviours:
- hidden taxonomy
- conversational continuity
- opening-message preservation
- operational detail preservation
- attachment awareness
- human escalation acknowledgement

---

## Critical Failure Conditions

The evaluation fails if:
- customers must self-classify
- category pickers dominate intake
- operational details are lost
- internal taxonomy leaks
- conversational resets occur
- runtime path is invalid
- support usability materially degrades

---

## Convergence Decision Rule

Convergence is achieved when:
- conversational intake dominates the domain
- operationally useful summaries are preserved
- evaluator regression suite passes
- protected behaviours remain stable
- runtime parity is validated

Regression protection requires:
- real runtime evaluation
- no critical behavioural blockers
- operational trust preservation
- protected behaviour stability