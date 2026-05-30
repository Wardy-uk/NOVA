# KPI Recovery Phase 0 Holdouts

Restricted: Manager / Evaluator use only. Do not share with Build Agent.

## Holdout Themes

- Distinguish a genuinely queryable field from a similarly named but non-usable payload fragment.
- Detect route-prefix safety claims that ignore nested or wildcard handlers.
- Detect reports that assert "present" without separating direct field presence from derived reconstruction.

## Holdout Scenarios

1. A field appears only inside opaque JSON with no confirmed extraction path. Evaluation should not treat that as cleanly present unless the report says it needs interpretation.
2. A route family has no literal `/api/kpi/*` declaration but would still conflict through mounting or shared prefixes. Evaluation should treat "no collision" as unsupported if the report does not check actual route behaviour.
3. A report lists all five prerequisite fields but omits an explicit go / no-go outcome for Phase 1. Evaluation should classify that as incomplete rather than converged.
