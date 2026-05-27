# Admin Email Echo Preservation

## Domain

Portal operational admin/account request handling

## Problem

The portal now routes cancellation/admin requests correctly and captures names properly, but the conversational acknowledgement text can still corrupt email addresses when echo stripping removes parts of LLM-generated mirrored text.

## Desired Outcome

Displayed conversational replies should preserve full email addresses intact while still avoiding awkward verbatim echo.

## Constraints

- Keep the fix tightly local to displayed reply sanitization.
- Preserve the billing/admin framing and name-capture improvements already verified in Iteration 27.
- Do not widen into broader prompt or routing redesign.
