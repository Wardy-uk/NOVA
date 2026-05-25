# Hardening Goals

1. Remove conversational wording that exposes classification uncertainty
Example to remove:
"It sounds like this might be about your website..."

Replace with:
neutral conversational clarification that does not reveal internal confidence/routing logic.

2. Strengthen implied-website detection for business-detail corrections

Examples:
- phone number wrong
- office address incorrect
- opening hours outdated
- branch details wrong
- contact details incorrect

These should consistently enter conversational website intake without falling back to category pickers.

3. Improve attachment awareness

If customer says:
- attached
- attachment
- photo attached
- see attached

NOVA should acknowledge that files can be uploaded during the intake flow.

Important:
- Preserve all currently converged behaviours.
- Do not redesign intake.
- Do not expand conversational intake to all categories yet.
- Do not touch portal shell or summary flow.
- This is a hardening pass only.