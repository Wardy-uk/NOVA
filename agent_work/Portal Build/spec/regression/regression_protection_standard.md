# Regression Protection Standard

## Purpose

This document defines when a convergence phase can be marked as regression protected.

A phase is not protected simply because the build is complete or the evaluator passes once.

Regression protection means the behaviour has been validated against:
- the intended customer experience
- operational usability
- known previous failures
- runtime parity
- non-regression of already-converged behaviours

---

## Regression Protected Definition

A convergence phase can be marked **Regression Protected** when:

- the target behaviour works through the real runtime path
- previously identified behavioural gaps do not reappear
- customer-visible behaviour remains coherent
- operationally important information is preserved
- no internal taxonomy leaks into customer-facing flows
- fallback behaviour remains graceful
- evaluator results show no critical behavioural blockers

---

## Required Evaluation Conditions

Regression evaluation must use:

- real frontend
- real backend conversational runtime
- real persistence layer where practical
- real LLM path where the behaviour depends on LLM output
- mocked data only where it does not replace the behaviour being evaluated

Mock-only evaluation is not sufficient where mocks bypass the runtime logic under test.

---

## Protected Behaviour Categories

Regression checks should cover:

### 1. Entry Behaviour
- customer can start naturally
- no unnecessary category picker
- no visible internal routing
- no forced self-classification

### 2. Context Preservation
- opening message is preserved
- important customer-provided details are not overwritten
- follow-up details accumulate rather than replace earlier context
- raw customer input remains the canonical operational record

### 3. Conversational Continuity
- responses acknowledge what the customer said
- follow-up questions are relevant
- the system does not ask for information already provided
- conversation does not reset unexpectedly

### 4. Operational Usability
- resulting request/ticket contains enough detail for support to act
- operationally important values are preserved
- support should not need to restart intake manually

### 5. Trust & Fallback
- uncertainty is handled conversationally
- failure states are clear
- frustration/human escalation intent is acknowledged
- the system avoids false confidence

### 6. Taxonomy Protection
- customers do not see internal categories, subcategories, routing teams, confidence scores, or implementation language
- friendly customer-facing labels are used where a summary is required

---

## Critical Blockers

Any of the following prevents regression protection:

- customer must self-classify for the protected domain
- category picker appears in a protected conversational path
- raw customer message is discarded or overwritten
- operationally important details are lost
- internal taxonomy leaks to the customer
- ticket/request summary becomes materially less useful
- customer is forced to repeat information already provided
- false success or silent failure occurs
- evaluator cannot reach the real runtime path

---

## Acceptable Non-Blocking Gaps

A phase may still be marked regression protected if remaining issues are:

- isolated field-extraction quality improvements
- low-risk wording improvements
- edge cases outside the protected domain
- fallback quality issues that do not break the core behaviour
- future-domain work not included in the current convergence scope

These must be logged as known non-blocking improvements.

---

## Minimum Regression Output

Every regression evaluation must produce:

- overall verdict: `REGRESSION PROTECTED` or `NOT REGRESSION PROTECTED`
- number of checks passed / failed
- protected behaviours confirmed
- any blockers found
- any non-blocking gaps found
- whether the phase can be archived
- whether further build work is required

---

## Regression Protection Decision Rule

Use this rule:

```text
If a failure compromises the protected behavioural model,
the phase is NOT regression protected.

If a failure is isolated, understood, non-critical, and does not compromise the protected behavioural model,
the phase MAY be marked regression protected with a logged improvement item.