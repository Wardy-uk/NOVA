# Definition Of A Trusted KPI

## Core Definition

A KPI is trusted only when it is:

- source-defined
- calculation-defined
- reproducible
- independently validated
- explainable
- regression protected

If any one of those conditions is missing, the KPI is not yet trusted.

---

## Required Conditions

### 1. Source Defined

The KPI has an explicit authoritative source hierarchy covering all contributing fields.

### 2. Calculation Defined

The formula, filters, thresholds, time windows, and inclusion/exclusion rules are written in operational terms.

### 3. Reproducible

A third party can reproduce the KPI from the documented source set and calculation rules.

### 4. Independently Validated

The KPI has been checked by an evaluator or validation path independent from the build implementation path.

### 5. Explainable

The KPI can be explained end-to-end:

- what it measures
- where its data came from
- how it was derived
- why the reported value is the reported value

### 6. Edge-Case Governed

Handling is defined for:

- missing data
- partial data
- duplicates
- late-arriving updates
- boundary timestamps
- classification ambiguity

### 7. Regression Protected

Replay, parity checks, or protected tests exist so the KPI does not silently degrade later.

---

## Explicit Non-Qualifiers

The following do not make a KPI trusted:

- it looks plausible
- it matches expectation once
- it matches one dashboard screenshot
- the SQL query runs successfully
- the Build Agent says the logic is correct
- the number has been used historically

---

## Trust States

Use the following states during the programme:

- `UNTRUSTED`
- `SOURCE DEFINED`
- `CALCULATION DEFINED`
- `VALIDATED`
- `REGRESSION PROTECTED`
- `TRUSTED`

`TRUSTED` should only be used after all prior states are satisfied.
