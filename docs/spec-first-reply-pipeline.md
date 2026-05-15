# NOVA AI — First Reply + Conversational Handoff Spec

**Date:** 15 May 2026  
**Status:** Draft — awaiting Nick's review  
**Goal:** AI handles first contact on every NT ticket, gathers context where needed, then hands off to Customer Care with a full summary. NTPJ tickets get round-robin assignment immediately.

---

## The Problem

NOVA generates decisions but doesn't complete work. Draft responses sit in an approval queue nobody reviews (1,034 timeouts in 18 days). First reply SLA is tanking because the customer waits while NOVA holds the ticket. The team thinks NOVA's handling it, so they don't pick it up either.

---

## NTPJ Flow

**Simple. No AI conversation. No first reply.**

Ticket arrives → round robin assign to TPJ pool → done.

The n8n parity rules are already implemented correctly in `AssignmentEngine`:

- **Domain-based customer stickiness** — if the reporter's domain has an open NTPJ ticket, assign to the same agent (overrides capacity caps)
- **Lowest absolute count ranking** — when no sticky match, pick the TPJ agent with fewest open tickets
- **Dual-cap eligibility** — agents excluded if over `max_capacity` (overall) or `max_tickets_t2t3` (TPJ-specific cap)
- **int_setup label** → routes to TPJ pool regardless of project
- **Excluded types** — Escalation only skips assignment
- **TPJ_Feed label** — excluded (prevents auto-rule loop)

**The fix:** The round-robin code works. The problem is NTPJ tickets aren't reliably entering the assignment path. `agent_jira_project` is set to `NT` only, so NTPJ tickets only get picked up by the unassigned sweep (which uses `getConfiguredProjects()` → `assignment_projects` setting), not the main triage loop.

**Implementation:**
1. Set `assignment_projects` = `NT,NTPJ`
2. In the main agent loop: when project is NTPJ, skip the entire first-reply pipeline, go straight to `assignWithFallback(ticketKey, 'tpj', 'NTPJ')`
3. Post assignment comment as today (internal): `[NOVA Round Robin] Auto-assigned to {name} (TPJ)`

---

## NT Flow

The AI acts as a front-desk agent. It handles first contact, gathers context if needed, and hands off to Customer Care when it's done — or immediately if it's not confident enough to help.

### Step 1: First Reply (public, automatic, every ticket)

**Confidence ≥ 85%** → Post the AI-drafted response as a public reply to the customer.

The AI may ask clarifying questions in this response (e.g., "Could you let me know which property listings are affected?"). This is intentional — the AI is gathering context before handoff.

**Confidence < 85%** → Post a personalised generic first reply (see framework below). Then immediately hand off (skip to step 4).

**Guardrails:**
- JSON/structured payload check (`Actor.looksLikeStructuredPayload`) — if the draft looks like raw JSON, fall back to generic reply
- Never post to already-resolved tickets
- Excluded request types (Escalation only) skip this pipeline entirely

### Step 2: Wait for Customer Reply (if AI asked questions)

If the AI's first reply contained questions or requested information, the agent stays on the ticket and waits for the customer to respond.

When the customer replies:
- If confidence remains ≥ 85%, the AI can respond again (continue the conversation)
- If confidence drops < 85% at any point, immediately hand off (go to step 4)
- If customer sentiment turns frustrated or angry, hand off immediately regardless of confidence
- Hard cap: 3 exchanges maximum, then hand off regardless
- If customer doesn't reply within 2 hours, hand off (existing `agent_sweep_wor_chase_days` / timeout config)

### Step 3: Resolution Path (HIL approval)

If the customer replies with something like "thanks, that fixed it" / "all sorted" / "perfect, thank you", the AI recognises this as a resolution signal.

**This is the one place we keep human-in-loop approval.** The AI submits a close/resolve request to the approval queue. A human confirms the ticket can be closed.

This protects against the AI misreading a polite reply as resolution when the customer actually has follow-up questions.

### Step 4: Handoff to Customer Care

When the AI is ready to hand off (or confidence has dropped below 85%), it does three things:

**a) Public comment** — a warm handoff message the customer sees, tailored to when it's happening:

During working hours:
> Hi Sarah,
>
> I've gathered the details and passed this to {Agent Name} in our Customer Care team who'll take it from here.
>
> Kind regards,
> Nurtur Support

Outside working hours / weekends:
> Hi Sarah,
>
> I've gathered the details and passed this to our Customer Care team. They'll pick this up first thing on {next working day — e.g. "Monday morning"}.
>
> Kind regards,
> Nurtur Support

The AI uses `WorkingDayClock.isWorkingTime()` (already exists in AssignmentEngine) to determine which variant to use. Outside hours, the round-robin assignment still happens (so the ticket is queued for the right agent) but the customer message sets realistic expectations.

**b) Internal comment** — the AI summary for the human agent:

```
🤖 NOVA Handoff Summary

Ticket: NT-18XXX — {summary}
Classification: {category} — {ticket_type}
Complexity: {simple/moderate/complex}
Confidence: {current}%

What happened:
- First reply sent at {time} (AI draft / generic acknowledgement)
- Asked customer: "{question asked}"
- Customer replied: "{summary of reply}"
- [any other exchanges]

Recommended next steps:
{from BriefEngine analysis}

KB References:
{relevant articles if any}
```

**c) Round robin assignment** — always to Customer Care pool. Use `assignWithFallback(ticketKey, 'cc', 'NT')`.

Always CC on initial handoff. The AI doesn't escalate directly to T2.

**However**, when a ticket is subsequently escalated to T2 (by the CC agent or via Jira tier field change to "Tier 2"), round robin must re-assign to the T2 pool. This is a separate trigger — not part of the AI conversation flow, but the assignment engine needs to handle tier changes and re-run round robin for T2 when they happen.

### Step 5: Request Type Update

On handoff, update the Jira Request Type from "AI Request" to the classified type (existing `updateRequestTypeOnHandoff()` logic). This already works.

---

## Generic First Reply Framework

LLM-generated each time, not a rigid template. Uses ticket context to sound personal.

**Structure (all required):**
1. **Greeting** — reporter's first name. "Hi Sarah," not "Dear Customer,"
2. **Acknowledgement** — name what they've raised. Prove we read it. "Thanks for getting in touch about the issue with your email campaigns not sending."
3. **What happens next** — name the assigned agent. "I've passed this to {Agent Name} in our Customer Care team who'll be looking into this for you."
4. **Warm close** — brief, human. "They'll be in touch shortly."

**What NOT to do:**
- No "your request has been logged with reference number..."
- No "a member of our team will be in contact at the earliest opportunity"
- No promises about specific timelines
- No technical jargon about queues or triage
- No corporate filler ("we value your custom", "rest assured")

**Example:**

> Hi Sarah,
>
> Thanks for letting us know about the issues with your ValPal widget not displaying on the property pages. I've passed this to Nathan in our Customer Care team who'll take a closer look.
>
> He'll be in touch shortly.
>
> Kind regards,
> Nurtur Support

**Ordering note:** For generic replies (< 85% confidence), round robin must resolve *before* the reply is generated, so we can name the assigned agent in the message. Sequence: triage → round robin → generate generic reply referencing assignee → post reply → post handoff summary.

---

## What This Changes

| What | Before | After |
|---|---|---|
| First reply | Sits in approval queue, times out | Posted immediately (public), every ticket |
| AI conversation | One-shot draft, then abandoned | AI stays on ticket, asks questions, gathers context |
| Handoff | Bare assignment comment | Public handoff + internal summary of full AI interaction |
| Assignment pool | Category-based (CC/T2) | Always Customer Care on initial handoff. T2 round robin triggers on escalation. |
| NTPJ assignment | Inconsistent (not in main loop) | Immediate round robin to TPJ, every time |
| Approval queue | Used for all draft_response actions | Only used for resolution/close (HIL) |
| Critic gate | Runs on every draft_response (90% broken) | Removed from first-reply path |

---

## Implementation Touchpoints

| File | Change |
|---|---|
| `agent-loop.ts` | New flow controller: NTPJ → immediate assign. NT → first reply → conversation → handoff. Remove approval routing for draft_response. Keep approval for close/resolve only. |
| `agent-loop.ts` → `tryAutoAssign()` | For NT initial handoff: always CC pool. Remove `!pendingApproval` guard. |
| `agent-loop.ts` or `jira-sync` | Detect tier field changes (e.g. CC → Tier 2). When a ticket is escalated to T2, re-run round robin with `assignWithFallback(ticketKey, 't2', 'NT')` to assign a T2 agent. |
| `agent-loop.ts` → `executeDecision()` | Rewrite to follow the new step sequence. |
| `actor.ts` | Add `postPublicReply(ticketKey, text)` method. Current guardrail says "NEVER post public comments" — needs a controlled opening for first replies and handoff messages specifically. |
| `actor.ts` → critic | Remove `draft_response` from `HIGH_STAKES_ACTIONS`. Keep critic on close/resolve/escalate if you fix the model routing bug. |
| `reasoner.ts` | Add "generic first reply" mode. Add "handoff summary" generation mode. Add conversation-continuation logic (process customer reply, decide whether to respond again or hand off). |
| `brief-engine.ts` | Extend `postBriefToJira()` to include conversation history (questions asked, replies received) in the handoff summary. |
| `lifecycle-manager.ts` | Keep approval timeout logic but only for close/resolve actions, not draft_response. |
| `ticket-state.ts` | New states: `ai_conversation` (AI is actively handling), `handed_off` (assigned to CC). |
| Settings | `assignment_projects` = `NT,NTPJ`. Consider `agent_critic_enabled` = `false` until model routing fixed. |

---

## Confidence Thresholds Summary

| Confidence | First Reply | What Happens Next |
|---|---|---|
| ≥ 85% | AI-drafted response (public) | AI stays on ticket, continues conversation if needed |
| < 85% | Generic acknowledgement (public) | Immediate handoff to CC via round robin |
| Resolution signal | N/A | HIL approval to close |
| NTPJ (any) | None | Immediate round robin to TPJ |

---

## Resolved Questions

1. **Max conversation depth** — Gauge by sentiment. If the customer is getting frustrated, hand off sooner. Hard cap of 3 exchanges regardless.
2. **Conversation timeout** — 2 business hours (already configured). If customer doesn't reply within 2 hours, hand off.
3. **Weekend/out-of-hours** — AI runs 24/7, same process. First replies go out on weekends/evenings. Handoff still happens (assignment may queue until working hours). The handoff message to the customer should be tailored to set expectations — e.g. "Our team will pick this up first thing on Monday" rather than "They'll be in touch shortly."
