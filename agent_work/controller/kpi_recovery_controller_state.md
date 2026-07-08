# KPI Recovery Controller State

## Active Control Record

| Field | Value |
| --- | --- |
| Current date | 2026-06-01 |
| Active programme | KPI Recovery & Evidence Integrity |
| Active phase | Replacement Parity Closure |
| Active work package | `KPX-WP11` |
| Lifecycle state | Build Ready |
| Next required action | Route the data freshness and historical backfill brief to the Build Agent. |
| Following action after findings | Review the freshness/backfill report, update tracker, then decide whether to open evaluation or a narrower recovery loop. |

## Isolation Rules Applied

- Build Agent receives only the build brief and shared scope references.
- Evaluator-only holdouts are not included in build-facing artefacts.
- No implementation instructions beyond externally observable audit outcomes.

## Shared References

- Governance: `C:\Users\NickW\Documents\Nicks knowledge base\Projects\Attractor Programme Methodology\NOVA_Attractor_Governance_and_Operating_Model.md`
- Lifecycle companion: `C:\Users\NickW\Documents\Nicks knowledge base\Projects\Attractor Programme Methodology\NOVA_Attractor_Programme_Methodology.md`
- KPI scope: `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md`
- Local governance implementation: `C:\Users\NickW\Claude\windows automation\daypilot\AGENTS.md`
