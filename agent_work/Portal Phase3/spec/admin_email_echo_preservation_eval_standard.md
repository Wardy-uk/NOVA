# Eval Standard — Admin Email Echo Preservation

## Evaluation Intent

Confirm that email addresses remain intact in conversational acknowledgement text while the admin-context improvements from Iteration 27 remain stable.

## Pass Conditions

- Email addresses in displayed replies remain intact and human-readable.
- Echo stripping still prevents awkward verbatim sentence echo.
- Billing/admin framing for `deactivate` requests remains correct.
- Supplied-name capture for remove-user requests remains correct.
- Existing routing and progression behaviour remain stable.

## Failure Conditions

- Displayed replies still visibly corrupt email addresses.
- Echo stripping regression reintroduces sentence echo.
- The fix regresses the other Iteration 27 gains.
