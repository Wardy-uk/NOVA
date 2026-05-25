# Account Setup / Office Changes — Protected Behaviour Definitions

## Purpose

This document defines the specific behaviours that must be protected once this domain achieves convergence. These become the regression baseline for all future domain expansions.

---

## Protected Behaviour 1: Invisible Classification

The system must internally classify account-related requests into operational categories (authentication, authorisation, provisioning, account structure, configuration, security-sensitive) without surfacing any of these categories to the customer.

**Protected:** Customer says "I can't get in" → system internally routes as authentication issue → customer sees a conversational follow-up about what happens when they try.

**Violation:** Customer sees "This looks like an authentication issue" or "I've categorised this as a login problem."

---

## Protected Behaviour 2: Platform Opacity

Customers must not be exposed to the multi-platform reality behind "setting up a user" or "changing access." A single user setup may require provisioning across 3-5 internal systems. The customer sees one request and one outcome.

**Protected:** "Please set up a new user" → system asks for name, email, office → ticket created → support handles multi-system provisioning.

**Violation:** "Which platforms should this user have access to: [BYM CRM] [Portal] [LeadPro] [Website CMS] [Email Builder]?"

---

## Protected Behaviour 3: Permission Model Opacity

Internal permission concepts (RBAC, roles, scopes, permission matrices, access levels as system constructs) must not leak into customer-facing conversation.

**Protected:** "She needs to be able to see everything for the London office" → system captures the intent → support translates to permission configuration.

**Violation:** "I'll need to update her role to 'office_admin' with branch-scoped data access for the London entity."

**Exception:** If the customer introduces technical terminology themselves (Holdout 14), the system preserves their language without expanding on it.

---

## Protected Behaviour 4: Security-Sensitive Fast Track

Requests involving user removal, access revocation, or phrases indicating a terminated employee must be treated as time-sensitive. The system should:
- acknowledge urgency immediately
- minimise follow-up to essential details only (who, and email if not provided)
- not require justification for the urgency
- not subject these requests to disambiguation
- route directly to ticket creation

**Protected:** "Remove this person now, they were fired today" → "Understood — I'll get this raised urgently. Could you confirm their email address?" → ticket.

**Violation:** "Could you tell me more about why you need this person removed?" or "Which systems should we remove them from?"

---

## Protected Behaviour 5: Bounded Disambiguation

When genuine cross-domain ambiguity exists, the system may ask at most ONE clarifying question. This question must:
- use customer vocabulary (symptoms, situations, observations)
- feel like a natural follow-up, not a routing decision
- preserve the customer's original message context
- not expose that disambiguation is occurring

After one question, if ambiguity persists, the system must route to the operationally safe default (Account Setup for access/user issues) and note the remaining ambiguity in the request summary for the support agent.

**Protected:** "I can't see the leads" → "When you try to access them, do you get an error, or are the leads just not appearing at all?" → routes based on answer.

**Violation:** "Is this an access/permissions issue, or are leads not being delivered to the system?"

---

## Protected Behaviour 6: Conversational Context Survival Through Disambiguation

When disambiguation occurs, all details from the customer's original message must survive into the request summary. Disambiguation is additive — it adds information, it never replaces or discards.

**Protected:** Customer says "The new office can't see any leads" → disambiguation question about whether the office is newly set up → answer received → summary includes: new office, can't see leads, office setup timeline, and disambiguation outcome.

**Violation:** After disambiguation, the summary only contains the disambiguated category and loses "new office" or "leads" context.

---

## Protected Behaviour 7: Opening Message Preservation

The customer's first message is the canonical record. It must be preserved verbatim in the request summary regardless of any follow-up, disambiguation, or classification that occurs during intake.

This is a shared behaviour with existing protected domains, restated here because disambiguation creates a new risk vector for opening message loss.

---

## Protected Behaviour 8: Operational Detail Preservation

Follow-up details accumulate rather than replace. Each piece of information the customer provides (names, emails, office locations, error messages, timelines, previous request references) must persist into the final request summary.

This is especially important for multi-issue requests (e.g., "I'm locked out AND the new users aren't set up") — both issues must appear in the summary.

---

## Protected Behaviour 9: No Category Picker Regression

At no point in the Account Setup intake flow should the customer encounter an enumerated list of options that functions as a category picker. This includes:

- explicit pickers ("Select: [Login] [New User] [Office Change]")
- disguised pickers (a "clarifying question" that lists 3+ specific options)
- progressive pickers (multiple yes/no questions that narrow to a category)
- platform pickers ("Which system: [CRM] [Portal] [Website]?")

A single open-ended clarifying question that asks about the customer's experience is NOT a picker. The distinction is: pickers enumerate internal categories; clarifying questions ask about observable symptoms.

---

## Protected Behaviour 10: Frustration and Escalation Handling

Frustrated customers must be acknowledged. Escalation signals (repeated requests, "nobody has helped", "this has been going on for days") must be:
- reflected in the system's tone
- preserved in the request summary
- treated as operational context, not noise to be discarded

The system must not respond to frustration with additional process (more questions, disambiguation, categorisation). Frustrated customers get acknowledged and fast-tracked.

---

## Regression Protection Scope

When this domain achieves convergence, all ten protected behaviours above become regression-protected. Future domain expansions (Template/Email, Integration, Data/Reporting) must validate that none of these behaviours degrade.

The disambiguation behaviours (5, 6, 9) are particularly important for regression monitoring, as they establish the disambiguation pattern that future domains will reuse. If the pattern works here, it becomes the template. If it regresses here, every future domain is at risk.
