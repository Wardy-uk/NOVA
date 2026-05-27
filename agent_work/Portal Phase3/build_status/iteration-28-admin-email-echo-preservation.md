# Iteration 28 — Admin Email Echo Preservation

## What Changed

Single targeted fix in `stripVerbatimEcho()` within `portal-chat.ts` (line ~151):

When the echo-stripping function splits the user's message into sentences and removes verbatim echoes from the LLM response, sentences containing email addresses are now **skipped entirely**. Previously, if the user said "please update my email to nick@example.com" and the LLM echoed that sentence, the entire sentence — including the email — would be stripped from the displayed response.

The fix: after sentence splitting (which already protects emails from dot-based splits via `__EMAIL{n}__` placeholders), any sentence that still contains an email placeholder is skipped rather than used as a removal pattern. The email is valuable confirmation data that the system captured the address correctly.

### Preserved behaviour
- Greeting-echo stripping still works (non-email sentences)
- TONE_SANITIZATIONS ("You mentioned...", category-label echo) unchanged — these only strip prefix phrases, not email content
- VOCABULARY_REPLACEMENTS (jargon firewall) unchanged — all use `\b` word boundaries that don't match inside emails
- Billing/deactivation fast-track from Iteration 27: preserved
- Name-capture improvements from Iteration 27: preserved
- Routing, classification, metadata capture, progression: all untouched

## What's Blocked or Uncertain

Nothing blocked. The fix is minimal (one `continue` guard) and doesn't interact with any other subsystem.

## Ready for Evaluation

Yes.
