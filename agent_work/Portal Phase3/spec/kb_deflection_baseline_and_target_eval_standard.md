# Eval Standard — KB Deflection Baseline And Target

## Evaluation Intent

Confirm that the running portal now presents a real, operator-usable KB deflection status outcome rather than only raw hidden plumbing.

## Pass Conditions

- A current KB deflection rate is visible through the runtime surface used for this slice.
- A configured target band corresponding to the 20-30% objective is visible or otherwise clearly represented.
- The runtime indicates whether the current rate is below, within, or above the target band.
- Existing KB-related user flows still behave coherently.
- No internal implementation language leaks into customer-facing surfaces.

## Failure Conditions

- No runtime-visible baseline exists.
- No runtime-visible target exists.
- The evaluator cannot tell whether current performance is on/off target.
- The slice depends on code inspection rather than observable runtime behaviour.
