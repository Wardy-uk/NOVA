# Evaluation — KPI Agent Breaches Parity Populated-Path Proof Fixture

**WP:** KPX-WP8A
**Date:** 2026-05-31
**Evaluator:** Eval Agent (behavioural; clean-sheet KPI path only)
**Method:** Live API observation against the running server (`http://localhost:3001`).
Short-lived admin token minted via the established KPX eval-family auth path (jwt_secret read
from the NOVA runtime DB `settings` table, `src=db-settings`, secretLen 64, with `.env`
fallback — runtime config, **not** application source). Token proven against three known-good
clean-sheet reads (`/api/kpi/slt`, `/api/kpi/spaces`, `/api/kpi/agent-breaches` → all
`200/ok:true`) before any conclusion was drawn. No application source, diffs, or build-status
notes were inspected. Raw capture retained:
`agent_work/eval_output/_wp8a_results.json` (full ordered run: baseline → seed → teardown,
plus isolation matrix). Harness: `_wp8a_eval.mjs`.

---

## Verdict: **PASS**

The disposable Agent Breaches fixture path proves the populated clean-sheet Agent Breaches
behaviour end to end and leaves the environment clean after teardown. The central capability
left **unverified** by the prior WP8 screen eval — real per-agent values classified
breaching / at-risk / clear, `summary` counts and `breachesByMetric` populated, and the
`target` / `amberBand` / `direction` thresholds actually firing — is now observably
demonstrated through the clean-sheet surface. Critically for this evidence-integrity
programme, the classifications are **computed from real seeded values against the metric
threshold**, not fabricated from the fixture's intent labels, and the surface returns to its
honest-empty state with no residue on teardown.

---

## Control surface (discovered behaviourally)

A single clean-sheet endpoint drives the fixture, action-dispatched by request body, exactly
mirroring the WP6A escalations fixture pattern:

| Call | Effect |
| --- | --- |
| `GET  /api/kpi/fixtures/agent-breaches` | status (present, counts, namespace, expectedBands) |
| `POST /api/kpi/fixtures/agent-breaches {"action":"seed"}` | create disposable space + seed 3 agent-level frozen rows (breach / at-risk / clear) |
| `POST /api/kpi/fixtures/agent-breaches {"action":"teardown"}` | remove the fixture, restore clean state |

A 7-path discovery sweep confirms it is served at this single clean-sheet endpoint and nowhere
else — `/api/kpi/fixtures/breaches`, `/api/kpi/fixtures/agent-breaches-parity`,
`/api/kpi-engine/fixtures/agent-breaches`, and 4 other variants all return `404`.

Fixture space is namespaced and self-labelling: `spaceKey = "__ABFX"`,
`jiraProject = "ZZABFX"`, `displayName = "Agent Breaches Parity Fixture (disposable)"`,
`ownerName = "KPX-WP8A"`, `metricKey = "resolved_today"`. Starting state was `present:false`
(clean) before any action.

---

## Observed behaviour (the verified ground truth)

### Baseline (pre-seed) — honest empty
Fixture status `present:false` (all tallies zero). `GET /api/kpi/agent-breaches` returns the
four real agent spaces (`NT`, `NTPJ`, `STBY`, `YO`), every one `hasData:false`,
`agents:[]`, `summary {agentsBreaching:0, agentsAtRisk:0, agentsClear:0, breachesByMetric:{}}`.
`unsupportedFamilies` honestly enumerates the three legacy families that cannot be derived
(`open_over_sla_per_agent`, `not_updated_per_agent`, `oldest_ticket_per_agent`). This matches
the prior WP8 honest-empty state.

### After `seed` — populated, three classifications computed from real values
Fixture status: `present:true, tickets:11, agents:3, agentDailyRows:3, dailyRows:1,
snapshotRows:1, reportDate:2026-05-31`. The `__ABFX` card on `GET /api/kpi/agent-breaches`
(`hasData:true`):

Space metric definition: `resolved_today` — `direction:higher, target:5, amberBand:40`.
Summary: **`agentsBreaching:1, agentsAtRisk:1, agentsClear:1, breachesByMetric:{resolved_today:1}`**.

| agent | value | rag | status | breachCount / atRiskCount |
| --- | --- | --- | --- | --- |
| Fixture Agent Breach | **1** | **red** | **breach** | 1 / 0 |
| Fixture Agent At-Risk | **4** | **amber** | **at_risk** | 0 / 1 |
| Fixture Agent Clear | **6** | **green** | **clear** | 0 / 0 |

The classifications track the threshold arithmetic, not the labels: for a higher-is-better
target of 5 with a 40% amber band (amber floor ≈ 3), a value of **1** falls below the band
(→ red / breach), **4** lands inside the band (→ amber / at-risk), and **6** meets/exceeds the
target (→ green / clear). The per-agent `breachCount` / `atRiskCount` and the space-level
`summary` + `breachesByMetric` all reconcile to these computed cell RAGs. This is genuine
threshold classification of frozen agent values, not a hardcoded status string.

### Teardown — clean restoration
`teardown` returned `removed:true` with an all-zero status block; `GET` status confirmed
`present:false`. `GET /api/kpi/agent-breaches` returned to the four real spaces only — `__ABFX`
fully absent, every real space back to `hasData:false` / zero breaches. `GET /api/kpi/spaces`
returned to real-spaces-only — `__ABFX` absent. No residue.

---

## Key questions

1. **Seed the fixture through the provided clean-sheet control surface — PASS.**
   `POST {"action":"seed"}` → `200`, `present:true`, 3 agents seeded.
2. **At least one agent classified breaching after seed — PASS.** "Fixture Agent Breach",
   value 1, rag red, `status:breach`; `agentsBreaching:1`.
3. **At least one agent classified at-risk after seed — PASS.** "Fixture Agent At-Risk",
   value 4, rag amber, `status:at_risk`; `agentsAtRisk:1`.
4. **At least one agent classified clear / met after seed — PASS.** "Fixture Agent Clear",
   value 6, rag green, `status:clear`; `agentsClear:1`.
5. **Classifications from real clean-sheet computed/frozen data, not fabricated labels — PASS.**
   Each agent carries an actual `cells[].value` (1 / 4 / 6) and the RAG / status is the correct
   threshold evaluation of that value against the space `metricDef` (`resolved_today`,
   higher, target 5, amber band 40%). The breach/at-risk/clear outcome is *derived* from the
   seeded numbers through the band logic — change of value would change the band — so it is
   computed, not asserted by the seed's naming.
6. **Teardown removes the proof fixture cleanly and restores honest empty — PASS.**
   `removed:true`, status `present:false`, breaches surface and spaces list both return to the
   four real spaces with the fixture fully gone.
7. **Isolation from real spaces and from the legacy KPI system — PASS (with a bounded note).**
   Throughout the seeded window the four real spaces stayed `hasData:false` with zero breaches
   — only `__ABFX` lit up — so real-space data is untouched. The three `unsupportedFamilies`
   stayed segregated and never leaked into a populated breach row. Legacy namespace does **not**
   serve any of this: `/api/kpi-data/agent-breaches`, `/api/kpi-data/breaches`,
   `/api/kpi-data/fixtures/agent-breaches`, `/api/kpi/breached` all `404`; the legacy KPI pool
   is unconfigured (`/api/kpi-data/agents` → `500 "KPI SQL Server not configured"`) yet the
   clean-sheet breaches + fixture returned full `200` payloads — proving no dependence on the
   legacy `techservicesjsm` pool.

---

## Material blocker
**None.** The populated breach path is fully exercisable and honest; classification is
computed from real seeded values; teardown is clean.

## Bounded non-blocking gaps
- **Fixture visible on shared clean-sheet boards while seeded.** During the seeded window the
  `__ABFX` space appears in `/api/kpi/spaces` and on the `/api/kpi/agent-breaches` surface
  alongside the real spaces (clearly labelled "disposable", owner "KPX-WP8A"). This is by
  design — it must surface on the clean-sheet path to prove parity — and is fully removed on
  teardown, so it is not a data-integrity risk. Same bounded note as the WP6A escalations
  fixture. Not a blocker.
- **Single metric / single-row exercised.** The proof exercises one breach-evaluable metric
  (`resolved_today`) with one frozen day, with exactly one agent in each band. This fully
  satisfies the brief (≥1 breaching, ≥1 at-risk, ≥1 clear, computed from real data) and proves
  the band logic fires across all three outcomes, but it does not exercise multi-metric
  per-agent breach aggregation or day-to-day history variation. Acceptable for a populated-path
  proof; out of scope for this slice.

## Readiness for checkpointing
**Ready.** The Agent Breaches parity slice now has its populated path independently verified:
real per-agent values classified breaching / at-risk / clear, `summary` counts and
`breachesByMetric` populated, thresholds firing correctly across red / amber / green with no
off-band error, and no unsupported family leaking into a breach row. The honest-empty and
isolation behaviour from WP8 is preserved when the fixture is absent. This closes the single
bounded gap ("populated breach path unverified") flagged by the WP8 screen eval. The Agent
Breaches slice can be checkpointed. The environment was left clean (fixture torn down,
`present:false`) at the end of this evaluation.
