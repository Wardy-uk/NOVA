# Account Setup / Office Changes — Behavioural Specification

## Domain

Account Setup / Office Changes conversational intake.

This workstream covers customer requests relating to:
- login failures and password resets
- new user creation and user removal
- permission and access issues
- office/branch additions, closures, and merges
- account-level configuration changes
- user role modifications
- multi-office account restructuring

---

## Behavioural Goal

The portal should allow customers to describe access, user, and office-structure problems naturally without needing to:
- know which platform or system is involved
- understand internal permission models or role hierarchies
- identify whether the issue is authentication, authorisation, or provisioning
- classify the type of account change required

The intake experience should feel like describing the problem to a knowledgeable colleague who already understands the product landscape.

---

## Protected Customer Experience

Customers should be able to say things like:

- "I can't log in."
- "We need a new user set up."
- "Please remove Sarah — she left last week."
- "We've opened a new branch in Manchester."
- "I can't see the reports I used to be able to see."
- "We need to merge two offices."
- "My password isn't working."
- "One of our team needs admin access."
- "We're closing the Birmingham office."
- "The new starter can't access anything."

without being forced into:
- platform pickers ("Which system can't you access?")
- internal role/permission terminology
- multi-system provisioning awareness
- category selectors of any kind

---

## Expected Behaviour

### Invisible Classification

NOVA should determine internally whether the issue relates to:
- authentication (login/password)
- authorisation (permissions/access scope)
- provisioning (user creation/removal)
- account structure (office/branch topology)
- configuration (account-level settings)
- security-sensitive operations (urgent removal, access revocation)

without exposing this taxonomy to the customer.

---

### Context Preservation

Customer-provided details must persist through intake.

Examples:
- person's name and email
- office/branch name and location
- what they were trying to access
- error messages or symptoms
- timeline (when it started, when noticed)
- urgency indicators (left the company, security concern)
- reference to previous requests

must survive into the Request Summary.

---

### Conversational Follow-Up

Follow-up questions should be operationally useful.

Examples:
- "Could you let me know the person's name and email address?"
- "What happens when you try to log in — do you get an error message?"
- "Is this a brand new office, or are you restructuring existing ones?"
- "When do you need this in place by?"

Questions should not:
- repeat known information
- expose internal routing logic
- ask the customer to identify which platform is affected
- reveal multi-system provisioning complexity
- use permission model terminology (RBAC, scopes, roles as internal concepts)

---

### Security-Sensitive Request Handling

Requests involving user removal, access revocation, or password resets carry implicit security weight.

The system should:
- acknowledge urgency without requiring justification
- treat removal requests as time-sensitive by default
- never perform or promise account changes in conversation
- never expose temporary credentials or password details conversationally
- fast-track to ticket creation for security-adjacent requests

---

## Disambiguation Behaviour

This is the first domain where bounded conversational disambiguation is required.

### When Disambiguation Is Needed

The system encounters genuine ambiguity when the customer's opening message could equally belong to this domain or another. Common collision points:

| Customer Says | Possible Domains | Disambiguation Signal |
|--------------|-----------------|----------------------|
| "I can't see our leads" | Account (permissions) / Integration (delivery failure) | What happens when they try? Error vs empty? |
| "The new office isn't set up properly" | Account (configuration) / Website (display) | What's not working — access or public display? |
| "A user can't see any data" | Account (access) / Data/Reporting (scope) | Is the user new or was this working before? |
| "I can't log in to update the website" | Account (login) / Website (content change) | Primary complaint: login failure or content need? |

### Disambiguation Rules

1. **Maximum one clarifying question.** If the domain is still ambiguous after one exchange, route to the most operationally safe default and note the ambiguity for the support agent.
2. **Questions must use customer vocabulary.** Ask about what they're experiencing, not which system is involved.
3. **Never expose routing logic.** The customer should not know they're being disambiguated.
4. **Preserve conversational flow.** The clarifying question must feel like a natural follow-up, not an interruption.
5. **Preserve the opening message.** The clarification does not replace or restart intake — it builds on what was already said.

### Safe Disambiguation Examples

> **Customer:** "I can't see the data for our new branch."
>
> **System:** "I'd like to help with that. Is the new branch something that's recently been added to your account, or has it been set up for a while and the data has just stopped appearing?"
>
> *(Distinguishes Account Setup [new branch not configured] from Data/Reporting [existing branch, data missing] without exposing the distinction.)*

> **Customer:** "One of our users can't access the leads."
>
> **System:** "That sounds frustrating. When they try to access the leads, do they get an error or see a blank page, or are the leads just not there at all?"
>
> *(Distinguishes Account [permissions/error] from Integration [leads never arrived] through observable symptom, not system classification.)*

### Unsafe Disambiguation Examples

> **UNSAFE:** "Is this an access issue or a data delivery issue?"
>
> **UNSAFE:** "Would you like me to route this to our accounts team or our integrations team?"
>
> **UNSAFE:** "Please select: [Login Problem] [New User] [Office Change] [Permissions]"
>
> **UNSAFE:** "Is this about your CRM account, portal account, or website account?"

---

## Human Escalation Behaviour

Frustrated or urgent users should:
- be acknowledged appropriately
- not be subjected to disambiguation when urgency is clear
- receive fast-track intake for security-sensitive requests
- be able to continue conversationally without forced discovery

Special case: "Please remove this person immediately" or "They left the company" — skip all non-essential follow-up, capture the minimum (who to remove) and create the ticket.

---

## Attachment Expectations

Customers may provide:
- screenshots of error messages
- lists of users to add/remove (spreadsheets, email threads)
- office restructure documents
- organisational charts

The intake flow should acknowledge attachment capability naturally.

---

## Operational Requirements

The resulting Request Summary must preserve:
- the affected person(s) — name, email where provided
- the affected office/branch — name, location where provided
- the operational symptom — what they can't do, what they need
- urgency indicators — security, timeline, previous request reference
- any error messages or screenshots mentioned
- chronology where relevant

Support agents should not need to restart discovery manually.

---

## Protected Behaviour Rules

Customers must not:
- see internal taxonomy or platform names (unless they introduced them)
- classify their own request into a category
- be forced to repeat themselves after disambiguation
- lose operationally important details during disambiguation
- encounter hard conversational resets
- be exposed to provisioning complexity (multi-system user creation)
- see permission model terminology

---

## Cross-Domain Routing Signals

### Strong Account Setup Signals (route here)
- "log in", "password", "reset", "locked out", "can't access"
- "new user", "set up", "create account", "add someone"
- "remove user", "delete account", "revoke access", "left the company"
- "new office", "new branch", "closing", "merging offices"
- "permissions", "admin access", "can't see" (when combined with user/access context)

### Exit Signals (not this domain)
- "my website shows the wrong office address" → Website Design
- "leads are going to the wrong office" → Integration
- "the office data in our reports is wrong" → Data/Reporting
- "the property isn't showing for that branch" → Property / Listing Issues

### Ambiguous Signals (disambiguation may be needed)
- "can't see" (without clear access/user context — could be data, permissions, or integration)
- "not working" (without clear what — could be anything)
- "the new office" (missing context on what specifically is wrong)
- "our data" (could be access, reporting, or integration)

---

## Convergence Target

Convergence is achieved when:
- account/access-related requests behave conversationally
- disambiguation remains bounded (one question max) and invisible
- operationally important context survives intake including through disambiguation
- security-sensitive requests are fast-tracked appropriately
- no category picker patterns emerge
- evaluator regression suite passes (this domain + both protected domains)
- operational usability is trusted by support staff
