# KPI Escalation Router Eval Block

## Outcome

`KPX-WP5A` evaluation is currently BLOCKED, not passed or failed.

## Reason

The evaluator could not obtain a legitimate authenticated path to probe `/api/escalations/*`.

Observed behaviour:

- unauthenticated `/api/*` probes collapse to uniform `401`
- `POST /api/auth/register` is restricted
- no valid login credentials were available
- the evaluator correctly refused to read source to extract signing material

Because of that, route-mount truth cannot be established behaviourally: a mounted route and an unmounted route are indistinguishable when the auth wall returns the same unauthenticated response.

## Manager Classification

This is an environment/access blocker, not a product verdict.

It does **not** justify opening the Escalations parity screen yet.

## Minimal Unblock Options

Any one of the following is sufficient:

1. a valid Bearer token for an account allowed to access `/api/escalations/*`
2. login credentials for such an account
3. a pre-created eval account with known credentials
4. a documented local-eval auth path that does not require source inspection

## Next Decision

Re-run the evaluation only after one of the above is provided.
