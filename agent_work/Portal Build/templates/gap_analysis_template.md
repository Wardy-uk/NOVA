# Gap Analysis Template

> DO NOT LEAK TO BUILD AGENT if this analysis includes evaluator-only findings or hidden scenarios.

## Summary

- Phase:
- Verdict:
- Confidence:

## What Passed

- 

## Gaps Found

| ID | Observed behaviour | Expected behaviour | Severity |
| --- | --- | --- | --- |
| G1 |  |  |  |
| G2 |  |  |  |

## Suggested Next Step

- Re-test only:
- Small fix phase:
- Escalate for re-plan:

## SaaS Example

| ID | Observed behaviour | Expected behaviour | Severity |
| --- | --- | --- | --- |
| G1 | Ticket filters work, but pagination resets to page 1 after every refresh | Saved filter state should restore cleanly | Medium |
| G2 | Export button disappears when zero rows match | Empty exports should still be possible if product already allows them | Low |
