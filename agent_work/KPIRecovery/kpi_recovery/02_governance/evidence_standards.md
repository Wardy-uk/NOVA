# Evidence Standards

## Purpose

This document defines the minimum standard for evidence used to claim KPI correctness or trust.

---

## Core Rule

"Looks right" is not evidence.

Evidence must allow a third party to understand:

- what was measured
- from which source
- at what time boundary
- using which rule
- with what result

---

## Acceptable Evidence Types

- authoritative source extracts with timestamps
- reproducible query outputs
- controlled comparison datasets
- historical replay results
- evaluator reports
- parity comparison packs
- regression baseline outputs

---

## Evidence Must Include

- artefact date/time
- source system identified
- environment or dataset scope
- calculation or validation method reference
- result summary
- exceptions or caveats

---

## Unacceptable Evidence

- screenshots without data provenance
- verbal confirmation without artefact support
- one-off manual spot checks with no replayability
- build assertions without independent retest
- derived totals with no contributing record path

---

## Evidence Neutrality Rules

- do not hide mismatches because one output is preferred
- preserve raw comparison results
- label ambiguity explicitly
- separate observed result from interpretation

---

## Evidence Tiers

### Tier 1

Authoritative raw source evidence

### Tier 2

Controlled transformation or persistence evidence

### Tier 3

Presentation or reporting evidence

Trust claims should be built from Tier 1 upward, not the reverse.
