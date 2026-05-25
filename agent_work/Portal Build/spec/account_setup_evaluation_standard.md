# Account Setup / Office Changes — Evaluation Standard

## Purpose

This document defines how behavioural convergence will be evaluated for Account Setup / Office Changes conversational intake.

The evaluator assesses:
- observable customer behaviour
- operational usability
- conversational continuity
- hidden routing complexity
- preservation of customer-provided information
- bounded disambiguation behaviour
- cross-domain regression

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
- login and access failures
- user setup and removal needs
- office and branch changes
- permission problems
- account configuration requests

without needing:
- platform knowledge
- permission model terminology
- multi-system awareness
- manual categorisation

---

### Classification Must Remain Invisible

Customers must not see:
- platform names (unless customer-introduced)
- permission model terms (RBAC, scopes, roles as system concepts)
- provisioning pipeline awareness (multi-system user creation)
- routing categories or team names
- confidence language

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
- require the customer to re-state information after disambiguation

---

### Disambiguation Must Remain Bounded and Invisible

This is the first domain where disambiguation behaviour is formally evaluated.

The system should:
- ask at most ONE clarifying question when genuine cross-domain ambiguity exists
- frame the clarification as a natural follow-up, not a routing decision
- preserve the customer's original message context through disambiguation
- route to the operationally safe default if ambiguity persists after one question

The system must not:
- ask more than one disambiguation question
- expose that disambiguation is occurring
- present options that resemble a category picker
- use internal domain language in clarification questions
- ask "which system" or "which team" questions

---

## Core Evaluation Scenarios

### Scenario 1 — Login Failure

Example:
"I can't log in."

Expected:
- conversational acknowledgement
- follow-up asking what happens when they try (error, blank page, etc.)
- no platform picker ("Which system?")
- no internal terminology

---

### Scenario 2 — New User Setup

Example:
"We need to set up a new user for our Manchester office."

Expected:
- person/office context preserved
- follow-up asking for name and email
- no multi-system provisioning awareness exposed
- no "which products should they have access to?" picker

---

### Scenario 3 — Urgent User Removal

Example:
"Sarah Jones left the company yesterday. Please remove her access immediately."

Expected:
- urgency acknowledged
- security sensitivity recognised
- minimal follow-up (email address if not provided)
- fast-track to ticket creation
- no "which systems should we remove her from?" question

---

### Scenario 4 — Office Restructure

Example:
"We're closing our Birmingham office and moving everyone to London."

Expected:
- structural change recognised
- follow-up about timeline and affected users
- no internal account hierarchy terminology
- operational details preserved

---

### Scenario 5 — Permission Problem

Example:
"I used to be able to see the reports but now I can't."

Expected:
- change-in-access recognised
- follow-up about what changed and when
- no "which reports?" picker
- no RBAC/permission model terminology

---

### Scenario 6 — Ambiguous Access Issue (Disambiguation Required)

Example:
"I can't see the leads for our new branch."

Expected:
- ONE clarifying question maximum
- question framed as natural follow-up (e.g., "Is this branch recently added to your account?")
- no routing logic exposed
- original message context preserved
- routes correctly after clarification OR defaults safely if still ambiguous

---

### Scenario 7 — Anti-Disambiguation (Clear Intent, No Clarification Needed)

Example:
"Please reset my password — my email is sarah@example.com."

Expected:
- no disambiguation question (intent is clear)
- context preserved (email captured)
- no unnecessary follow-up
- direct ticket path

---

### Scenario 8 — Security-Sensitive Urgency

Example:
"We need to remove a former employee from everything right now. This is urgent."

Expected:
- urgency acknowledged immediately
- minimum viable follow-up (who, and email if not provided)
- no disambiguation
- no "which systems?" question
- fast-track intake

---

### Scenario 9 — Cross-Domain Boundary (Website Overlap)

Example:
"Our website is showing the old office address."

Expected:
- routes to Website Design, NOT Account Setup
- no disambiguation question needed (website display intent is clear)
- does not capture as account/office change request

---

### Scenario 10 — Cross-Domain Boundary (Integration Overlap)

Example:
"Leads from the new office aren't coming through to anyone."

Expected:
- disambiguation may be needed (Account setup incomplete vs Integration failure)
- if asked, ONE clarifying question about whether the office is new/recently set up
- no "is this an account issue or an integration issue?" framing

---

## Disambiguation-Specific Evaluation Criteria

These criteria apply in addition to the standard evaluation for any scenario where disambiguation occurs.

### D1 — Question Count
- PASS: zero or one clarifying question
- FAIL: two or more clarifying questions

### D2 — Question Framing
- PASS: question is about the customer's experience or situation
- FAIL: question is about systems, teams, categories, or routing

### D3 — Picker Regression
- PASS: clarification is open-ended or symptom-focused
- FAIL: clarification presents enumerated options resembling a picker

### D4 — Context Survival
- PASS: original message details survive through disambiguation into the summary
- FAIL: disambiguation causes information loss or conversational reset

### D5 — Invisible Routing
- PASS: customer cannot tell they were disambiguated
- FAIL: customer could reasonably infer they were being classified

### D6 — Fallback Safety
- PASS: when disambiguation fails to resolve, system routes to operationally safe default with ambiguity noted for support
- FAIL: system loops, asks a second question, presents a picker, or drops the request

---

## Regression Requirements

Previously protected behaviours from both existing domains must not regress.

### Website Design / Content Changes
- hidden taxonomy
- conversational continuity
- opening-message preservation
- operational detail preservation
- attachment awareness
- human escalation acknowledgement

### Property / Listing Issues
- hidden taxonomy
- conversational continuity
- opening-message preservation
- operational detail preservation
- attachment awareness
- human escalation acknowledgement
- portal/feed complexity hidden

### Shared Protected Behaviours (all domains)
- invisible classification
- conversational-first intake
- no category picker dominance
- customer vocabulary priority
- operational summary preservation

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
- disambiguation exceeds one question
- disambiguation resembles a category picker
- disambiguation exposes routing logic
- security-sensitive requests are not fast-tracked
- protected domain behaviour regresses

---

## Convergence Decision Rule

Convergence is achieved when:
- conversational intake dominates the domain
- disambiguation remains bounded and invisible
- operationally useful summaries are preserved
- evaluator regression suite passes (all three domains)
- protected behaviours remain stable
- runtime parity is validated
- security-sensitive request handling is appropriate

Regression protection requires:
- real runtime evaluation
- no critical behavioural blockers
- operational trust preservation
- protected behaviour stability across all converged domains
- disambiguation evaluation criteria (D1–D6) all passing
