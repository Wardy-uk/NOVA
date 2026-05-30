# WS0 Convergence Definition — Infrastructure & Runtime

## Work Package

`WS0-WP1`

## Observable Success Criteria

WS0 is converged when behavioural evaluation confirms that:

1. SARA starts from the intended Pi 5 runtime path without requiring manual application bring-up after boot
2. frontend and backend are both observably running
3. frontend/backend communication succeeds through the intended runtime path
4. the repository now contains a stable-enough runtime scaffold for WS1 and WS2 to build upon

## Failure Conditions

- startup still depends on manual intervention that WS0 was meant to remove
- one side of the runtime fails to come up or stay up
- frontend/backend communication is missing or non-functional
- implementation drifts into later workstreams instead of establishing the bounded runtime baseline

## Allowed Residuals

- placeholder runtime content is allowed if it is honest and structurally aligned with the protected architecture
- visual polish is not required
- advanced intelligence or integration behaviour is not required

## Manager Decision Rule

- Pass: WS0 converged and WS1 activation may be considered
- Iterate: WS0 remains active with a bounded remediation brief
- Blocked: an environment or infrastructure prerequisite prevents meaningful runtime validation
