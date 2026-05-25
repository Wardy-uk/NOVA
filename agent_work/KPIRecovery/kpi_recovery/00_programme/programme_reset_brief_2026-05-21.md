# KPI Recovery Reset Brief — 2026-05-21

## Why We Are Resetting

The full KPI vs Jira parity audit shows that the programme has recovered several **local behavioural defects**, but the overall KPI surface is still not trustworthy enough to continue with incremental patching as if the baseline were stable.

The biggest issue is not one formula. It is that the system is still mixing:

- incomplete / shifting cache state
- partially recovered KPI logic
- legacy n8n-era assumptions
- mixed methodology between NOVA, Jira, and historical workflow outputs

This means we should **reset the recovery method**, not discard every code fix.

## What We Keep

We do **not** roll back the clearly-correct bounded fixes already made, including:

- ghost KPI suppression
- FRT field sync and FRT parsing recovery
- breach-board population-path fixes
- breach-board SLA-definition alignment
- escalation / rejection dataflow recovery
- 1st Line Resolution formula correction
- wallboard cache refresh fix
- WS3-A reconciliation logic itself

These remain part of the product unless later evidence disproves them.

## What Changes Now

We stop treating prior slice trust promotions as evidence that the **whole KPI estate** is trustworthy.

From this point:

1. **Global parity is reset**
   - We no longer assume the KPI dashboard is broadly trustworthy just because several bounded slices passed their local lifecycle.

2. **Cache integrity becomes the top gate**
   - No broad KPI trust claims until `jira_issue_cache` is proven complete and stable against live Jira.

3. **All KPI families must be classified before fixing**
   - `Direct Jira parity`
   - `Cache-dependent Jira parity`
   - `Non-Jira KPI`
   - `Legacy n8n-only / missing capability`

4. **The next programme path is baseline-first, not symptom-first**
   - restore cache parity
   - prove field completeness
   - then re-audit KPI families from a stable data substrate

## Reset Decisions

### R-1: Reframe trust states as local, not global

Existing TRUSTED slices remain evidence that specific fixes behaved correctly under the slice conditions tested.
They do **not** imply that all current dashboard numbers are globally trustworthy.

### R-2: Establish a canonical baseline stack

From now on, every KPI must be assessed against this source stack:

1. **Live Jira via Atlassian MCP**
2. **NOVA cache / persistence layer**
3. **NOVA KPI output**
4. **Legacy n8n workflow logic** (reference only, not authority)

### R-3: Treat n8n as historical reference, not correctness target

n8n v4 and `KpiSnapshot` are useful for methodology comparison and capability-gap discovery, but not as the governing truth source.

### R-4: Re-enter through the substrate, not the symptoms

The next work must start with:

- cache completeness
- snapshot completeness
- field completeness
- date-window semantics

Only after that should we trust metric-by-metric parity work.

## Immediate Next Phases

### Phase A — Complete WS3-A hardening

Deploy and verify the batch-safe reconciliation fix (`e647670`) so cache cleanup works automatically and safely.

### Phase B — Baseline Integrity Audit

Run a new narrow audit focused only on:

- total open tickets
- total done/resolved today population
- per-tier open counts
- key required Jira fields present in cache (`current_tier`, FRT SLA, Resolution SLA, CSAT)

This is the new entry gate.

### Phase C — Re-scope KPI families from the baseline

Once the substrate is stable, group KPIs into:

- volume / queue
- SLA / FRT
- escalation / rejection
- derived
- satisfaction
- non-Jira / internal
- missing capability

Then route bounded fixes again from that cleaner baseline.

## What Is Explicitly Parked

- broad “everything is trusted” claims
- n8n parity as a target in itself
- agent KPI feature expansion
- missing KPI expansion from old n8n output
- Bug Ack redesign
- FCR redesign until substrate is stable

## Success Condition For The Reset

The reset is successful when:

- the cache is provably complete enough to serve as a substrate
- direct Jira vs cache gaps are understood and bounded
- KPI fixes resume from a stable baseline instead of moving-target evidence
