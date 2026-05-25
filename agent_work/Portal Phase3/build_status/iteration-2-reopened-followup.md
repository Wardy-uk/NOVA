# Build Status — Iteration 2: Reopened / Follow-up Ticket Continuity

**Status:** Ready for evaluation  
**Date:** 2026-05-24

## What Changed

### 1. Follow-up continuation path after ticket reference recognition

**File:** `src/server/services/portal-chat.ts`

When a customer message contains both a ticket reference (e.g. NT-123) AND follow-up/chase language (e.g. "still not fixed", "following up", "been waiting"), the portal now:

- Looks up the referenced ticket and acknowledges it by key, summary, and current status
- Sets the session into a follow-up continuation flow (`category: 'followup'`, appropriate subcategory based on ticket status)
- Automatically selects `followup_reopen` for resolved/closed tickets, `followup_not_resolved` for open ones
- Asks the customer what still needs attention, rather than dead-ending with a status display
- Preserves the original ticket key and summary in session metadata (`followUpTicketKey`, `followUpTicketSummary`)

This applies to both the LLM intent path (status intent + chase language) and the F5 escalation detection path (non-status intent + chase language + ticket reference).

### 2. Original ticket context preserved through submission

**File:** `src/server/services/portal-chat.ts`

- Summary card shows "Related ticket: NT-123 — original summary" so the customer sees the link
- Ticket description is prepended with `Follow-up to NT-123 ("original summary")` so agents see the context
- After ticket creation, a Jira issue link is created between the new follow-up ticket and the original

### 3. Jira issue linking for follow-ups

**File:** `src/server/services/portal-jira.ts`

Added `linkIssues(newKey, originalKey)` method that creates a Jira issue link using the configured link type name (defaults to "Relates").

### 4. Metadata type extension

**File:** `src/shared/portal-types.ts`

Added `followUpTicketKey` and `followUpTicketSummary` optional fields to `IntakeSessionMetadata`.

## What Was Preserved

- Pure status checks (no chase language) still show status and end as before
- Existing escalation/chase detection without a ticket reference still works as before (generic follow-up flow)
- All other portal intake paths (website, property, account, etc.) are untouched
- Category picker, KB deflection, and submission flows unchanged
- Jira link failure is non-blocking (logged as warning, ticket still created)

## What's Uncertain

- The Jira link type name defaults to "Relates" — the project's `jira_link_type_name` setting is currently set to "Blocks" (used by onboarding). Follow-up tickets may want a different link type. The current default of "Relates" is appropriate for follow-ups but could be made configurable separately if needed.

## How to Test

1. Start a portal chat session
2. Send a message like "I'm following up on NT-18592, it's still not fixed"
3. Portal should acknowledge the original ticket by key and summary, then ask what still needs attention
4. Provide follow-up details, review summary card (should show "Related ticket" line)
5. Confirm submission — new ticket should have follow-up reference in description and be linked in Jira
