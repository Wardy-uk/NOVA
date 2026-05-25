# Convergence Loop Operating Process

## Purpose

This document defines the repeatable process for running behavioural convergence loops across NOVA conversational intake domains.

It exists so future chats and agents can continue the programme without losing orchestration context.

---

## Standard Loop

1. Define behavioural specification
2. Define evaluation standard
3. Create holdout scenarios
4. Create convergence package
5. Update programme tracker
6. Build iteration
7. Evaluate observable behaviour
8. Convert evaluator gaps into behavioural routing
9. Run hardening/blocker iterations
10. Run regression protection evaluation
11. Archive protected convergence
12. Move to next domain

---

## Agent Roles

### Orchestrator
Maintains programme state, creates prompts, ensures tracker updates, and controls progression.

### Manager Agent
Turns evaluator findings into behavioural routing and convergence guidance.

### Build Agent
Implements changes without seeing hidden evaluator logic.

### Evaluator Agent
Tests observable behaviour through the real runtime path.

---

## Required Artefacts Per Domain

Each domain should have:

- behavioural spec
- evaluation standard
- holdout scenarios
- convergence package
- iteration plans
- build status reports
- evaluator outputs
- convergence archive when protected

---

## Tracker Requirement

Every build/eval iteration must update the programme tracker according to:

`spec/orchestration/tracker_update_contract.md`

The tracker is orchestration state, not passive documentation.

---

## Regression Protection Requirement

A domain is not complete until it passes regression protection according to:

`spec/regression/regression_protection_standard.md`

---

## Runtime Requirement

Evaluator results are only valid when the evaluator reaches the real runtime path.

Mock-only evaluation is invalid if mocks bypass the behaviour under test.

---

## Key Principle

Raw customer input is the canonical operational record.

LLM output may enrich, classify, extract metadata, and generate acknowledgements, but must never replace or destroy operationally useful customer information.