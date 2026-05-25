# Change Control Rules

## Purpose

These rules prevent uncontrolled KPI logic changes during recovery.

---

## Core Rules

- do not redesign architecture prematurely
- do not assume current KPI logic is correct
- do not merge formula changes without updating the written KPI definition
- do not expand scope before current protected scope is stable
- do not treat presentation fixes as calculation fixes unless evidenced

---

## Required Before Build Routing

- problem statement is defined
- defect class is identified or explicitly ambiguous
- current trust risk is stated
- affected KPI scope is named

---

## Required Before Promotion

- validation completed
- independent retest completed
- regression artefacts created
- promotion decision logged

---

## Forbidden Shortcuts

- "small query tweak" without governance update
- "temporary" source override without exception record
- silent threshold change
- undocumented time-window change
- approval by visual plausibility alone
