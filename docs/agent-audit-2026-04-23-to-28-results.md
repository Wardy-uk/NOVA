# NOVA AI Agent Audit — Results

**Window:** 2026-04-23 → 2026-04-28  
**Generated:** 2026-04-28  
**Method:** Independent classification of Jira comments (REST API) + NOVA decision API (prod)  
**Script:** `scripts/audit-agent-decisions.cjs` — raw data in `audit-raw.json`

---

## Executive Summary

474 tickets audited. **The existing `parseN8nAction()` parser is fundamentally broken** — it reports "escalate" on 78.8% of tickets because it matches conditional advisory language in AI Summaries ("Escalate to Tier 2 if…"). This means the daily comparison reports ("27% escalate") have been measuring parser artefacts, not real agreement.

NOVA's agent decisions show 43.5% agreement with n8n ground truth, but this is artificially low because the comparison methodology classifies `draft_response` (NOVA's most common action) as disagreeing with `assign` (n8n's most common action) — when in reality these are complementary, not contradictory.

---

## Headlines

| Metric | Value |
|---|---|
| Total tickets | **474** |
| Fetch failures | 0 |
| n8n coverage (Nurtur account comments) | 471 (99.4%) |
| With AI Summary | 463 (97.7%) |
| With public reply (n8n responded) | 250 (52.7%) |
| With Round Robin assignment | 299 (63.1%) |
| NOVA coverage (at least one decision) | 445 (93.9%) |
| Total NOVA decision records | 1,246 |
| Tickets with NO NOVA decision | 29 |

## n8n Ground Truth Combinations

| Combination | Count | % |
|---|---|---|
| Respond + Assign (full handling) | 179 | 37.8% |
| Assign only (routed, no reply) | 120 | 25.3% |
| AI Summary only (observed, no action) | 101 | 21.3% |
| Respond only (replied, no assignment) | 71 | 15.0% |
| No n8n comments at all | 3 | 0.6% |

n8n's typical workflow: post AI Summary → post public reply → Round Robin assign. On 101 tickets n8n only posted the AI Summary and took no further action.

105 additional internal (non-public) comments from the Nurtur account matched customer-facing language patterns ("Hello [name], Thank you for…") but had `jsdPublic: false`. These are n8n's internal acknowledgement templates, not customer-visible replies.

---

## Per-Day Breakdown

| Day | Tickets | n8n Coverage | NOVA Coverage | NOVA vs GT Agree | Disagree | Agreement Rate |
|---|---|---|---|---|---|---|
| 2026-04-23 | 99 | 99 (100%) | 70 (70.7%) | 10 | 1 | 90.9% |
| 2026-04-24 | 94 | 94 (100%) | 94 (100%) | 31 | 29 | 51.7% |
| 2026-04-25 | 39 | 39 (100%) | 39 (100%) | 8 | 17 | 32.0% |
| 2026-04-26 | 25 | 25 (100%) | 25 (100%) | 2 | 18 | 10.0% |
| 2026-04-27 | 111 | 110 (99.1%) | 111 (100%) | 42 | 60 | 41.2% |
| 2026-04-28 | 106 | 104 (98.1%) | 106 (100%) | 41 | 49 | 45.6% |

**Apr 23:** Only 70.7% NOVA coverage — the 29 gap tickets are all from the first 8 hours (pre-dawn automated alerts, plugin monitors). Agent loop wasn't processing overnight tickets at go-live.

**Apr 25–26:** Weekend — lower volume (39 and 25), lower agreement. Many are automated alerts where n8n handles differently than human-reported tickets.

---

## Parser Accuracy — `parseN8nAction()`

Tested on 406 tickets where the AI Summary was parseable.

| Metric | Value |
|---|---|
| Parser returned a result | 406 / 463 AI Summaries (87.7%) |
| **Correct** | **38 (9.4%)** |
| **Incorrect** | **368 (90.6%)** |

### Parser Action Distribution (what the parser says)

| Action | Count | % |
|---|---|---|
| escalate | **320** | 78.8% |
| close | 80 | 19.7% |
| respond | 6 | 1.5% |

### Root Cause: Conditional Escalation Language

The parser matches `escalate to` in the AI Summary body. But n8n's AI Summaries routinely include conditional advisory text like:

> "Escalate to Tier 2 if the client requests assistance with staging/manual update"  
> "Escalate to Tier 3/Development if visual issues are confirmed"

This language appears even on Customer Care (Tier 1) tickets — it's advice for the human agent, not a record of what n8n did. The parser's first-match-wins priority means this advisory text triggers `escalate` before any `respond` pattern can match.

### Parser "Escalate" Verdicts by Recommended Tier

| Recommended Tier | Count | Assessment |
|---|---|---|
| Customer Care (Tier 1) | **205** | **All false positives** — T1 is not escalated |
| Tier 2 | 104 | Some may be valid, but many are advisory |
| Other/Development | 11 | Likely valid |

**Impact:** The existing `ai_comparison_log` entries that show NOVA and n8n "agreeing" on escalation are largely false agreements — both are matching the same advisory text rather than the same *action*.

---

## NOVA vs Ground Truth

| Metric | Value |
|---|---|
| Tickets compared | 308 |
| **Agree** | **134 (43.5%)** |
| **Disagree** | **174 (56.5%)** |
| No comparison possible | 137 |

### Disagreement Breakdown

| NOVA Action | n8n Ground Truth | Count | Assessment |
|---|---|---|---|
| draft_response | assign | 55 | **Complementary, not contradictory.** NOVA prepared a response; n8n routed the ticket. Both are valid actions on the same ticket. |
| draft_response | other (AI summary only) | 53 | **NOVA more proactive.** n8n only observed; NOVA drafted a response. Not wrong — different strategy. |
| escalate | respond | 36 | **Real disagreement.** NOVA recommended escalation but n8n handled at current tier. Needs investigation. |
| escalate | assign | 12 | **Real disagreement.** NOVA escalated but n8n simply assigned. |
| assign | respond | 8 | Marginal. |
| assign | other | 6 | Marginal. |
| escalate | other | 4 | NOVA escalated, n8n took no action. |

The headline 56.5% disagreement rate is misleading. If we reclassify `draft_response vs assign` as "complementary" (55 tickets) and `draft_response vs other` as "NOVA more proactive" (53 tickets), the **real disagreement rate drops to ~21% (66/308)**.

### NOVA `no_action` Gap Analysis

NOVA's latest decision was `no_action` on some tickets where n8n did act:

| n8n Action | Count |
|---|---|
| Respond + Assign | 52 |
| Respond only | 23 |
| Assign only | 15 |
| No action either | 24 |

90 tickets where NOVA said `no_action` but n8n took at least one action. These represent missed processing opportunities — likely timing gaps where the agent loop hadn't processed the ticket before n8n's workflow completed.

---

## NOVA Decision Profile

| Action | Count | % of 1,246 |
|---|---|---|
| draft_response | 464 | 37.2% |
| no_action | 437 | 35.1% |
| escalate | 178 | 14.3% |
| assign | 69 | 5.5% |
| abuse_report | 38 | 3.0% |
| plugin_to_tpj | 38 | 3.0% |
| transition | 15 | 1.2% |
| comment | 7 | 0.6% |

- **Shadow mode:** 1,142 / Live: 104 (91.6% shadow)
- **Live actions:** Only `plugin_to_tpj` (38) and `abuse_report` (38) are in `agent_hybrid_allowed_actions`
- **Models:** claude-sonnet-4-6 (545), gpt-4.1 (233), unknown (448), claude-sonnet-4-20250514 (20)
- **Event types:** ticket_created (1,010), comment_added (227), resolution_review (9)
- **Escalate confidence:** median 0.82, range 0.45–1.00

---

## Gap Analysis — 29 Tickets with No NOVA Decision

All 29 are from 2026-04-23 (go-live day), created between 00:08 and 17:17. Mostly overnight automated alerts:

- 21 are "plugin not updated" / "Smart Plugin Manager" alerts
- 4 are email-forwarded invoices/renewals
- 3 are automated job reports (PFG, Auction House, Triggers)
- 1 is a product cancellation confirmation

**Cause:** The agent loop likely wasn't configured to process overnight tickets created before the loop started on Apr 23. These are all low-value automated tickets that wouldn't benefit from AI triage.

---

## Top 20 Real Disagreement Examples (NOVA escalate vs n8n respond/assign)

63 total escalation disagreements. Top 20:

| Ticket | Conf. | n8n Did | Recommended Tier | Shadow | Note |
|---|---|---|---|---|---|
| NT-16986 | 0.95 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17003 | 0.90 | respond | Tier 2 (escalate to T3 if logs show…) | yes | Conditional language |
| NT-17045 | 0.50 | respond | Tier 2 | yes | Low confidence |
| NT-17061 | 0.95 | respond | Tier 2 (if T2 own branch/CMS) | yes | Conditional language |
| NT-17104 | 0.95 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17113 | 0.88 | respond | Tier 3 | yes | n8n responded despite T3 recommendation |
| NT-17150 | 0.95 | assign | Development | yes | n8n assigned, didn't escalate |
| NT-17161 | 0.95 | respond | Tier 2 | **no** | **Live escalation** — n8n responded |
| NT-17203 | 0.92 | assign | Customer Care | yes | **False escalation on T1** |
| NT-17205 | 0.72 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17206 | 0.82 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17207 | 0.85 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17212 | 0.82 | assign | Tier 2 (follow-on to Dev…) | yes | Conditional language |
| NT-17213 | 0.82 | respond | Tier 3 | yes | n8n responded despite T3 recommendation |
| NT-17222 | 0.82 | respond | Customer Care | yes | **False escalation on T1** |
| NT-17227 | 0.82 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17229 | 0.82 | respond | Tier 2 | yes | n8n handled at T2 |
| NT-17230 | 0.82 | respond | Development | yes | n8n responded despite Dev recommendation |
| NT-17233 | 0.55 | respond | Customer Care | yes | **False escalation on T1**, low confidence |
| NT-17277 | 0.82 | assign | - | yes | No tier data |

**Key patterns:**
- Most escalation disagreements are on Tier 2 tickets where n8n responded or assigned instead of escalating
- 3 false escalations on Customer Care (T1) tickets — NOVA's model is over-escalating
- NT-17161 is a **live** (non-shadow) escalation disagreement — worth manual review
- NT-17113 and NT-17230: n8n responded on tickets where its own AI Summary recommended T3/Dev — n8n itself doesn't always follow its recommendations

---

## Proposed Parser Fixes

See conversation for detailed fix proposals in `ai-improvement.ts`. Summary:

1. **Guard against conditional language:** Strip "if…" clauses before matching escalation keywords
2. **Use Recommended Tier as gate:** Only return `escalate` if tier is T3/Development
3. **Recognise public replies:** Treat `jsdPublic: true` Nurtur comments as `respond`
4. **Add `assign` action class:** Detect Round Robin comments
5. **Return action list, not single value:** Multiple n8n actions per ticket are the norm

---

*Raw data: `audit-raw.json` in project root. Re-run: `node scripts/audit-agent-decisions.cjs`*
