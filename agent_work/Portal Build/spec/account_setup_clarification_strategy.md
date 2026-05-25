# Account Setup / Office Changes — Clarification Strategy Rules

## Purpose

This document defines the rules governing conversational clarification and disambiguation for the Account Setup / Office Changes domain. This is the first domain in the programme to require bounded disambiguation, and the patterns established here will set the precedent for all future domains.

---

## Core Principle

Clarification must feel like a knowledgeable colleague asking a natural follow-up question, not like a system trying to sort the customer into a bucket.

---

## What Constitutes Safe Conversational Clarification

Safe clarification has ALL of the following properties:

1. **Symptom-focused.** The question asks about what the customer observes, experiences, or needs — not about which system, team, or category their issue belongs to.

2. **Open-ended or binary.** The question invites a description or a yes/no answer. It does not enumerate options from an internal taxonomy.

3. **Contextually grounded.** The question references something the customer already said, making it feel like a natural continuation, not a new line of questioning.

4. **Invisible as disambiguation.** A reasonable customer would interpret the question as "this person is trying to understand my problem better," not "this system is trying to categorise me."

5. **Preserves momentum.** The question does not break conversational flow. The customer feels they are making progress, not being interrogated or redirected.

### Examples of Safe Clarification

| Customer Says | Safe Clarification |
|--------------|-------------------|
| "I can't see the leads for our new branch" | "Is this branch something that was recently added to your account, or has it been set up for a while?" |
| "One of our users can't access the reports" | "What happens when they try — do they get an error, or can they log in but the reports just aren't there?" |
| "The new office isn't working properly" | "What specifically isn't working — is it that people can't log in, or that things are showing incorrectly?" |
| "Something's not right with our data" | "Could you tell me a bit more about what you're seeing? For example, is data missing, or is it showing the wrong information?" |

---

## What Constitutes Unsafe Category-Picker Regression

Unsafe clarification has ANY of the following properties:

1. **Enumerates internal categories.** The question lists options that map to internal routing paths, even if the words are softened. "Is this about [login] [permissions] [a new user] [an office change]?" is a picker in conversational clothing.

2. **Uses system vocabulary.** The question references platforms, team names, technical concepts, or operational categories that the customer wouldn't naturally use. "Is this a CRM issue or a portal issue?" exposes hidden taxonomy.

3. **Forces classification.** The question requires the customer to make a routing decision. "Would you say this is more of an access problem or a data problem?" asks the customer to do the system's job.

4. **Presents three or more specific options.** Even if symptom-focused, listing three or more options starts to feel like a picker. "Is it: (a) you can't log in, (b) you can't see certain data, or (c) you need a new user?" is a picker.

5. **Asks "which system."** Any question that asks the customer to identify a platform, tool, or system by name (unless they introduced it). "Which system are you having trouble with?" is always unsafe.

6. **Asks a second disambiguation question.** One is the maximum. A second question, regardless of quality, crosses the line from clarification into categorisation.

### Examples of Unsafe Clarification

| Customer Says | Unsafe Clarification | Why It's Unsafe |
|--------------|---------------------|-----------------|
| "I can't get in" | "Which system can't you access: the CRM, the portal, or the website?" | Platform picker |
| "We need some changes" | "Are you looking for: a new user, an office change, a permissions update, or a password reset?" | Category picker in conversational disguise |
| "Things aren't working" | "Is this an account issue or a technical issue?" | Forces classification using internal concepts |
| "The new user can't see anything" | (after first question) "And is the issue specifically with reports, leads, or property data?" | Second disambiguation question |

---

## Maximum Acceptable Clarification Depth

**One question.** This is a hard limit, not a guideline.

### Why One

- Two questions feels like a questionnaire, not a conversation.
- Three questions is indistinguishable from a picker spread across multiple turns.
- The cost of routing to a slightly wrong domain (but with a good summary) is far lower than the cost of degrading the customer experience with repeated clarification.

### What Counts as a Question

- A direct question ("What happens when you try?") = 1 question
- A question with an "or" offering two symptom options ("Do you get an error, or is it just not there?") = 1 question (this is fine — binary symptom choice is not a picker)
- Two questions in one message ("What happens when you try? And which office is this for?") = these count as discovery follow-up, NOT disambiguation, if the domain is already determined. Discovery follow-up within a domain is unlimited. Only cross-domain disambiguation is capped at one.

### The Distinction: Disambiguation vs Discovery

- **Disambiguation** = "I don't know which domain this belongs to." Capped at one question.
- **Discovery** = "I know this is an account issue, now I need details." Not capped — ask as many questions as operationally needed.

The rule applies to the routing decision, not to the entire conversation.

---

## Fallback Behaviour When Ambiguity Remains Unresolved

If, after one clarifying question, the domain is still genuinely ambiguous:

### Step 1: Route to the Operationally Safe Default

For Account Setup collision scenarios, the defaults are:

| Collision | Safe Default | Rationale |
|-----------|-------------|-----------|
| Account vs Integration | Account Setup | Provisioning/access issues are more common and more time-sensitive |
| Account vs Data/Reporting | Account Setup | Access is usually the blocker; data issues are investigated after access is confirmed |
| Account vs Website Design | Website Design | If the complaint is about what's displayed, Website is more actionable |
| Account + multiple domains | Account Setup | Structural/access issues cascade; fixing the root unlocks the rest |

### Step 2: Note the Ambiguity

The request summary must include a note visible to the support agent:

> "The customer's initial description was ambiguous between [brief description]. After one clarifying exchange, the request has been routed to [domain] based on [signal]. The support agent should verify whether [alternative domain] factors are also involved."

This note is NOT customer-facing. It appears only in the internal request summary / ticket description.

### Step 3: Never Loop

The system must never:
- ask a second disambiguation question
- ask the customer to confirm the routing ("Just to check — is this more of a login issue?")
- present a fallback picker ("Since I'm not sure, could you select from...")
- apologise for not understanding and re-ask

The fallback is: route, note, move on.

---

## Clarification Timing

### When to Ask

Disambiguation is only appropriate when:
1. The customer's opening message has genuinely ambiguous cross-domain signals
2. No strong domain-specific signal is present
3. The answer would materially change how the request is handled

### When NOT to Ask

Do not attempt disambiguation when:
1. A strong domain signal is present (e.g., "password reset" → Account Setup, no question needed)
2. The customer is frustrated or urgent (acknowledge and fast-track instead)
3. The customer has given enough context to route, even if imperfectly (prefer routing with a good summary over perfect routing with a bad experience)
4. The request is security-sensitive (user removal, access revocation — fast-track immediately)
5. The customer explicitly says they don't want questions ("Just do X")

---

## Precedent for Future Domains

The disambiguation pattern established in this domain — one question, symptom-focused, invisible routing, safe default fallback — becomes the reusable primitive for all subsequent domain expansions.

Future domains (Template/Email, Integration, Data/Reporting) must:
- follow these same rules
- not introduce their own disambiguation patterns
- not increase the question cap
- not weaken the picker regression tests

If the pattern works cleanly for Account Setup (the lowest-collision expansion domain), it is assumed suitable for higher-collision domains. If it doesn't work here, the pattern must be fixed before proceeding, not bypassed.
