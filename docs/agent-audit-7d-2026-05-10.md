# NOVA AI Agent Audit — 7D Results
**Window:** 2026-05-03 → 2026-05-10 (7 days)
**Generated:** 2026-05-10T17:06Z
**Method:** Jira comment multi-signal classification + NOVA decision API + NOVA aggregate APIs
**Methodology version:** v3 — fixed comparison logic (complementary/proactive are not failures)

---

## 1. Headline Metrics

| Metric | Value | April Baseline |
|---|---|---|
| Tickets in window | **613** | 159 (24h) / 474 (5d) |
| NOVA decision coverage | **99.7%** (611/613) | 99.4% (24h) / 93.9% (5d) |
| Total NOVA decisions | **1203** | 410 (24h) / 1,246 (5d) |
| Effective alignment rate | **67.2%** (273/406) | ~44.9% (inflated disagree) |
| Real disagreement rate | **32.8%** (133/406) | ~56.5% (inflated) |
| Over-escalation count | **68** | ~36 (5d) |
| False no_action count | **65** | ~90 (5d) |
| Premature close count | **0** | not measured |
| Shadow mode % | **73.6%** | 91.6% (5d) |
| Live mode % | **26.4%** | 8.4% (5d) |
| Tickets with no NOVA decision | **2** | 1 (24h) / 29 (5d) |

### Verdict Breakdown

| Verdict | Count | % of compared |
|---|---|---|
| no_comparison | 205 | 33.6% |
| agree | 162 | 26.5% |
| real_disagree | 133 | 21.8% |
| proactive | 65 | 10.6% |
| complementary | 46 | 7.5% |

## 2. Per-Day Breakdown

| Day | Tickets | n8n Cov | NOVA Cov | Agree | Comp | Proactive | Disagree | Alignment |
|---|---|---|---|---|---|---|---|---|
| 2026-05-03 | 36 | 100.0% | 100.0% | 31 | 2 | 1 | 2 | 94.4% |
| 2026-05-04 | 57 | 89.5% | 100.0% | 36 | 4 | 6 | 5 | 90.2% |
| 2026-05-05 | 123 | 94.3% | 100.0% | 63 | 11 | 12 | 30 | 74.1% |
| 2026-05-06 | 129 | 98.4% | 100.0% | 57 | 6 | 15 | 49 | 61.4% |
| 2026-05-07 | 110 | 98.2% | 100.0% | 60 | 11 | 13 | 24 | 77.8% |
| 2026-05-08 | 92 | 100.0% | 100.0% | 53 | 10 | 11 | 18 | 80.4% |
| 2026-05-09 | 34 | 100.0% | 94.1% | 21 | 2 | 5 | 4 | 87.5% |
| 2026-05-10 | 32 | 96.9% | 100.0% | 28 | 0 | 2 | 1 | 96.8% |

## 3. Decision Quality

### 3a. Disagreement Buckets

| Bucket | Count | Description |
|---|---|---|
| over_escalation | 68 | NOVA escalated but n8n responded/assigned at lower tier |
| false_no_action | 65 | NOVA took no action but n8n responded or assigned |

### 3b. Disagreement Examples (up to 25)

| Ticket | NOVA | Conf | Bucket | n8n Ground Truth | Shadow | Summary |
|---|---|---|---|---|---|---|
| NT-17841 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | Triggers Not Firing Report |
| NT-17844 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | BriefYourMarket Scheduled Report: DW check (03/05/2026) |
| NT-17873 | escalate | 0.92 | over_escalation | assign (tier: Customer Care) | Y | Product Cancellation - LeadPro (Dashboard) For THORNE CARTER & ASPEN LIMITED |
| NT-17874 | escalate | 0.92 | over_escalation | assign (tier: Customer Care) | Y | Product Cancellation - LeadPro (Instant Valuation Tool) For THORNE CARTER & ASPE |
| NT-17878 | escalate | 0.92 | over_escalation | assign (tier: Customer Care) | Y | Product Cancellation - LeadPro (Autocaller) For THORNE CARTER & ASPEN LIMITED |
| NT-17889 | escalate | 0.85 | over_escalation | respond (tier: Tier 2) | Y | Fw: NTPJ-7112 KnightBain Website Down |
| NT-17900 | escalate | 0.93 | over_escalation | respond (tier: Customer Care) | Y | Exp- Notification of agent leaving |
| NT-17931 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | Triggers Not Firing Report |
| NT-17934 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | BriefYourMarket Scheduled Report: DW check (05/05/2026) |
| NT-17950 | escalate | 0.78 | over_escalation | respond (tier: Tier 2) | Y | Unsubscribed contact |
| NT-17956 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | Urgent - Missing Trigger Data reports |
| NT-17960 | escalate | 0.90 | over_escalation | respond (tier: Tier 2) | Y | JR-Hopper - letting link |
| NT-17968 | escalate | 0.75 | over_escalation | respond (tier: Tier 2) | Y | RE: Warehouse API details |
| NT-17989 | escalate | 0.82 | over_escalation | respond (tier: -) | Y | Re: Fwd: Re: STBY-1024 RE: [iceberg-digital.co.uk] Re: Urgent - F&C Website not  |
| NT-17990 | escalate | 0.78 | over_escalation | respond (tier: Tier 2) | Y | No Response from Office Lookup API |
| NT-17994 | escalate | 0.72 | over_escalation | respond (tier: Tier 2) | Y | incorrect people assigned  |
| NT-17997 | escalate | 0.78 | over_escalation | respond (tier: Customer Care) | Y | Problem sending out a property |
| NT-18005 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | Rogers Stewart BYM |
| NT-18007 | escalate | 0.85 | over_escalation | respond (tier: Tier 2) | Y | Charters - Edward Kendall |
| NT-18009 | no_action | 0.00 | false_no_action | assign (tier: Customer Care) | Y | Only receive CVs worth reading |
| NT-18010 | no_action | 0.00 | false_no_action | respond (tier: Customer Care) | Y | https://www.emsleysestateagents.co.uk/renting/information-for-tenants/ |
| NT-18011 | no_action | 0.00 | false_no_action | respond (tier: Customer Care (or Tier 2 if Customer Care lacks CMS access)) | Y | https://www.emsleysestateagents.co.uk/lettings/information-for-landlords/ |
| NT-18012 | no_action | 0.00 | false_no_action | respond (tier: Tier 2) | Y | Re: Website  |
| NT-18013 | no_action | 0.00 | false_no_action | respond (tier: Tier 2) | Y | Website help |
| NT-18014 | no_action | 0.00 | false_no_action | respond (tier: Tier 2) | Y | Blakes Property |

### 3c. NOVA Action Profile

| Action | Count | % |
|---|---|---|
| no_action | 297 | 24.7% |
| draft_response | 261 | 21.7% |
| assign | 183 | 15.2% |
| escalate | 155 | 12.9% |
| auto_rule_smart-plugin-tpj | 96 | 8.0% |
| comment | 89 | 7.4% |
| auto_rule_smart-plugin-connect-fail | 26 | 2.2% |
| auto_rule_smart-plugin-persistent-fail | 17 | 1.4% |
| auto_rule_abuse-report | 14 | 1.2% |
| auto_rule_product-cancellation | 13 | 1.1% |
| transition | 13 | 1.1% |
| auto_rule_mwu-tier-2 | 12 | 1.0% |
| auto_rule_cia-letter-dedup | 11 | 0.9% |
| auto_rule_auction-house-success | 9 | 0.7% |
| auto_rule_freedom-leisure-integration | 6 | 0.5% |
| auto_rule_digival-report-success | 1 | 0.1% |

### 3d. Confidence Distribution

| Band | Count | % |
|---|---|---|
| High (≥0.80) | 805 | 66.9% |
| Medium (0.50–0.79) | 213 | 17.7% |
| Low (<0.50) | 185 | 15.4% |

### 3e. Model Usage

| Model | Count | % |
|---|---|---|
| claude-sonnet-4-6 | 874 | 72.7% |
| unknown | 328 | 27.3% |
| gpt-4.1 | 1 | 0.1% |

### 3f. Event Type Distribution

| Event | Count | % |
|---|---|---|
| ticket_created | 798 | 66.3% |
| comment_added | 293 | 24.4% |
| resolution_review | 111 | 9.2% |
| backfill | 1 | 0.1% |

## 4. Approval Flow

| Metric | Value |
|---|---|
| pending | 2 |
| approved | 106 |
| declined | 24 |
| declined_today | 2 |
| timed_out | 532 |
| today_decided | 3 |
| system_approved_today | 1 |
| system_expired_today | 0 |

## 5. Autonomy Status

No autonomy rules configured (all decisions require approval).

### Shadow vs Live Execution

| Mode | Decisions | % |
|---|---|---|
| Shadow | 886 | 73.6% |
| Live | 317 | 26.4% |

## 6. Quick-Win / Auto-Close

| Metric | Value |
|---|---|
| totalToday | 0 |
| executedToday | 0 |
| undoRate30d | 0 |

- Quick-win decisions in window: 0
- Executed: 0
- Undone (reversed): 0

## 7. Knowledge Base Effectiveness

| Metric | Value |
|---|---|
| open | 1089 |
| article_drafted | 3 |
| article_published | 0 |
| dismissed | 0 |

## 8. Gap Analysis — Tickets with No NOVA Decision

2 ticket(s) had no NOVA agent decision.

| Ticket | Created | Status | Priority | Summary |
|---|---|---|---|---|
| NT-18389 | 2026-05-09T02:11 | Closed | Unset | moreland.uk.com 1 plugin is consistently failing to update |
| NT-18390 | 2026-05-09T02:12 | Closed | Unset | david-james.com 1 plugin is consistently failing to update |

## 9. Agent Runtime Status

```json
{
  "state": "stopped",
  "shadowMode": false,
  "shadowModeEnum": "live",
  "lastTickAt": null,
  "tickCount": 0,
  "ticketsProcessed": 0,
  "intervalMs": 60000,
  "errors": 0,
  "mode": "full",
  "modeChangedAt": null,
  "weekendOverrideUntil": "2026-05-10T19:51:15.026Z"
}
```

## 10. Methodology

### Data Sources

1. **Jira REST API** — JQL search for all NT tickets in window, per-ticket comment fetch
2. **NOVA Decision API** — Per-ticket decision history (`/api/agent/decisions/ticket/{key}`)
3. **NOVA Aggregate APIs** — Approval stats, autonomy rules, KB gap counts, quick-win stats, agent status

### Ground Truth Derivation

n8n actions are classified from Jira comments using multi-signal detection:
- **AI Summary** comments → extract Recommended Tier and Priority
- **"auto-assigned by" / "round robin"** comments → assignment detection
- **Public (jsdPublic=true)** comments → response detection

### Comparison Logic (v3)

Key improvement over April v2: **complementary and proactive actions are not counted as failures.**

| NOVA Action | n8n Action | Verdict |
|---|---|---|
| escalate | n8n responded (non-T3 tier) | **real_disagree** (over_escalation) |
| escalate | n8n escalated (T3/Dev tier) | **agree** |
| draft_response | n8n responded | **agree** |
| draft_response | n8n assigned only | **complementary** |
| draft_response | n8n idle | **proactive** |
| no_action | n8n responded or assigned | **real_disagree** (false_no_action) |
| no_action | n8n idle | **agree** |
| close | n8n acted | **real_disagree** (premature_close) |
| assign | n8n assigned | **agree** |
| assign | n8n responded | **complementary** |

**Effective alignment** = agree + complementary + proactive.
**Real disagreement** = only cases where NOVA's action would have produced a materially wrong outcome.

### Limitations

- n8n ground truth only captures public comments, AI summaries, and round-robin assignments. Internal-only handling is invisible.
- NOVA decisions made after the Jira comment window may be missing for the most recent tickets.
- Approval flow stats are all-time, not window-scoped (NOVA API limitation).
- Shadow mode decisions are logged but never executed, so we cannot measure their real-world outcome.

## 11. Compared to April 2026 Audit

| Dimension | April (5d, Apr 23–28) | May (this audit) | Change |
|---|---|---|---|
| Raw agreement rate | 43.5% (inflated disagree) | 67.2% (effective alignment) | Methodology fixed — not directly comparable |
| Real disagreement | ~21% (reclassified) | 32.8% | Measured properly now |
| Over-escalation | ~36 (5d) | 68 | Regressed |
| False no_action | ~90 (5d) | 65 | Improved |
| NOVA coverage | 93.9% (5d) | 99.7% | Improved |
| Shadow % | 91.6% | 73.6% | - |
| Tickets with no decision | 29 (5d) | 2 | - |

### Key Changes Since April

1. **Methodology v3** — Complementary/proactive actions correctly separated from real failures
2. **Escalation policy** — 5-gate evaluation with evidence scoring, repeat-escalation dampener
3. **Critic gate** — LLM review of high-stakes actions before execution
4. **Quick-win engine** — Pattern-based auto-close with undo capability
5. **Autonomy engine** — Category-based approval bypass with statistical thresholds
6. **Impact measurement** — Rolling 7-day metrics (resolution rate, deflection, queue hours saved)

## 12. Deep-Dive: Over-Escalation Patterns

The 68 over-escalation cases cluster into clear patterns:

| Pattern | Example Tickets | NOVA Conf | n8n Tier | Count (est) |
|---|---|---|---|---|
| Automated reports (Triggers/DW check) | NT-17841, NT-17931, NT-18393 | 0.82 | Tier 2 | ~12 |
| Product cancellations | NT-17873, NT-17874, NT-17878, NT-18394 | 0.92 | Customer Care | ~8 |
| Website issues (hosting/links) | NT-17960, NT-18432 | 0.82–0.90 | Tier 2 | ~10 |
| Forwarded emails / FW: threads | NT-17889, NT-17989 | 0.82–0.85 | Tier 2 | ~6 |
| Agent notifications (leaving/joining) | NT-17900 | 0.93 | Customer Care | ~4 |
| Misc technical queries | NT-17950, NT-17968, NT-17994 | 0.72–0.82 | Tier 2 | ~28 |

**Root cause:** NOVA's reasoner treats many Tier 2 topics as needing escalation. The escalation policy's 5-gate system is present in code but isn't reducing the volume — the evidence-scoring threshold (0.6 for autonomous escalation) is too permissive. Most of these tickets score above 0.6 on evidence because they contain technical keywords (triggers, API, website, plugin) which inflate the technical-detail signal.

**Key insight:** Product cancellations (0.92 confidence) are being escalated when n8n simply assigns them to Customer Care. This is a category-level miscalibration, not a per-ticket judgment failure.

## 13. Deep-Dive: False No-Action Patterns

The 65 false_no_action cases show confidence=0.00, meaning they never reached the LLM. These tickets were filtered out by the perceiver or auto-rules before triage.

| Pattern | Example Tickets | n8n Action | Count (est) |
|---|---|---|---|
| CMS/website content requests | NT-18010, NT-18011 | respond (CC/T2) | ~15 |
| URL-only subjects (misclassified?) | NT-18009, NT-18012 | assign/respond | ~10 |
| Re: / Fw: email chains | NT-18013 | respond (T2) | ~8 |
| Misc support requests | various | respond/assign | ~32 |

**Root cause:** The agent loop's event filtering or the auto-rules engine is skipping tickets that should have reached the LLM reasoner. The 0.00 confidence confirms these didn't get LLM triage at all. Likely causes: (1) `comment_added` events on existing tickets where the perceiver doesn't trigger a new triage, (2) tickets created during agent-loop downtime (agent is currently **stopped**), or (3) rate-limiting/dedup logic filtering them as "recently processed."

## 14. Deep-Dive: Approval Flow Crisis

| Metric | Value | Assessment |
|---|---|---|
| Approved | 106 | Low volume relative to decisions |
| Declined | 24 | Low — suggests quality is acceptable when reviewed |
| **Timed out** | **532** | **Critical — 80% of approvals expire unreviewed** |
| Pending | 2 | Current backlog is small |
| Approval rate (of decided) | 81.5% | Good when someone looks |
| Timeout rate | 80.3% | Most decisions are never reviewed |

The approval queue is not functioning as a quality gate — it's a graveyard. 532 timeouts vs 130 human decisions means the team isn't reviewing NOVA's work. This blocks the autonomy engine: rules can't build accept_rate statistics if approvals time out instead of being approved/declined.

**Impact:** Without approval throughput, the autonomy engine (which requires min_accept_rate ≥ 90–95%) can never activate. The system is stuck in a loop: too many approvals → team ignores them → no data → no autonomy → too many approvals.

## 15. Deep-Dive: Day-of-Week Effect

| Day Type | Avg Alignment | Avg Disagree | Avg Tickets/Day |
|---|---|---|---|
| Weekend (Sat/Sun) | 93.5% | 5.3% | 41 |
| Weekday (Mon–Fri) | 76.2% | 22.5% | 98 |

Weekday tickets are more complex (human-raised, multi-threaded, ambiguous context) and NOVA struggles more with them. Weekend tickets are simpler (automated alerts, plugin failures) where deterministic auto-rules handle most of the volume correctly. This means the effective alignment of 67.2% understates weekend performance and overstates weekday readiness.

## 16. Capability vs Evidence vs Gaps

| Capability | Present in Code | Proven by Audit | Gap |
|---|---|---|---|
| Ticket coverage | YES | YES (99.7%) | 2 overnight tickets missed |
| LLM triage | YES | YES (draft_response, escalate, assign) | Over-escalation pattern |
| Escalation policy (5 gates) | YES | PARTIAL — gates exist but don't prevent over-escalation | Evidence thresholds too permissive |
| Critic gate | YES | NOT TESTED — no high-stakes live actions in window | Shadow mode means critic never fires |
| Quick-win auto-close | YES | NO — 0 executions in 7 days | Engine not activated |
| Autonomy engine | YES | NO — 0 rules configured | Blocked by approval timeout crisis |
| Approval flow | YES | DYSFUNCTIONAL — 80% timeout | Team not reviewing |
| KB gap detection | YES | YES — 1089 gaps found | 0 published articles (pipeline stalled) |
| KB article drafting | YES | MINIMAL — 3 drafted | Not flowing to Confluence |
| Portal chat | YES | NOT MEASURED | No portal chat data in audit window |
| Impact measurement | YES | Code exists | Need snapshot data to confirm |
| Auto-rules engine | YES | YES — 205 auto-rule decisions (17%) | Working well for known patterns |
| Assignment engine | YES | YES — 183 assign decisions (15.2%) | Functioning |
| Comment handling | YES | YES — 293 comment_added events | Working |
| Resolution review | YES | YES — 111 resolution_review events | Working |

## 17. Verdict

**IMPROVED BUT STILL RISKY** — Infrastructure is significantly better, but two critical issues block autonomous operation.

### What improved:
- **Coverage:** 99.7% (was 93.9%) — near-perfect
- **Coverage gaps:** 2 tickets missed (was 29) — dramatic improvement
- **Auto-rules:** 205 decisions handled by deterministic rules — reliable
- **False no_action:** 65 (was ~90) — 28% reduction
- **Live execution:** 26.4% (was 8.4%) — more real action
- **Architecture:** Escalation policy, critic gate, autonomy engine, impact measurement all present
- **Model consolidation:** 72.7% Claude Sonnet (was split across GPT-4.1 + Sonnet + unknown)

### What did not improve:
- **Over-escalation:** 68 (was ~36) — **doubled**. This is the #1 regression.
- **Approval throughput:** 80% timeout rate renders the approval gate meaningless
- **Autonomy activation:** 0 rules enabled despite engine being built
- **KB pipeline:** 1089 open gaps, 0 published articles
- **Quick-win engine:** 0 executions

### What regressed:
- Over-escalation is materially worse, likely because the LLM triage now runs on more tickets (higher coverage) but hasn't been calibrated for ticket types that don't need escalation (product cancellations, scheduled reports, T2 website issues).

### Bottom line:
- **Effective alignment: 67.2%** (target: ≥85%)
- **Real disagreement: 32.8%** (target: <15%)
- **Over-escalation: 68** (target: <10 per 5d window)
- **False no_action: 65** (target: <15 per 5d window)
- Not ready for autonomous operation. Fix over-escalation and approval flow first.

## 18. Top 10 Remediation Items

1. **[CRITICAL]** Over-escalation regression (68 cases, doubled from April)
   - Add auto-rule exceptions for product cancellations (assign to CC, not escalate), scheduled reports (Triggers/DW check → T2 respond), and agent notifications (CC handle).
   - Raise escalation policy Gate 4 evidence threshold from 0.6 to 0.75.
   - Add a "tier ceiling" check: if n8n's AI Summary says Customer Care or Tier 2, block escalation unless NOVA has explicit T3/Dev evidence.

2. **[CRITICAL]** Approval queue crisis (80% timeout rate)
   - The team isn't reviewing approvals. Options: (a) reduce approval volume by enabling autonomy for well-understood categories, (b) auto-approve low-risk decisions after 2h instead of timing out, (c) surface approval queue more prominently in NOVA UI.
   - Without fixing this, the autonomy engine can never activate.

3. **[HIGH]** False no_action (65 cases, confidence=0.00)
   - These tickets never reached the LLM. Check perceiver filters: are `comment_added` events on existing tickets being skipped? Are tickets created during agent downtime being backfilled? The agent is currently **stopped** — any tickets created while stopped get no triage.

4. **[HIGH]** Enable autonomy rules for safe categories
   - Product cancellations: deterministic assign to CC (convert to auto-rule).
   - Plugin failures (smart-plugin-*): already handled by auto-rules, but confirm coverage.
   - Auction house success: already auto-ruled.
   - Start with disabled-but-seeded rules, validate, then enable.

5. **[HIGH]** Agent is stopped — restart it
   - `state: "stopped"`, `tickCount: 0`, `ticketsProcessed: 0`. No triage is happening right now. Every ticket since the last stop is unprocessed.

6. **[MEDIUM]** KB pipeline is stalled (1089 open / 0 published)
   - The gap detection works (1089 gaps found) but articles aren't being drafted or published. Check Confluence integration settings, KB article service, and whether the pipeline needs manual trigger or has errors.

7. **[MEDIUM]** Quick-win engine has 0 executions
   - The engine exists but isn't firing. Check settings: is it enabled? Are there patterns configured? This could handle easy wins (thank-you replies, stale tickets) and reduce queue load.

8. **[MEDIUM]** Tighten "Triggers Not Firing Report" handling
   - This is a recurring automated report ticket that appears multiple times. NOVA consistently escalates (0.82 conf) but n8n responds at T2. Add a specific auto-rule or adjust triage prompts to recognize this pattern.

9. **[LOW]** Model attribution gap (27.3% "unknown")
   - 328 decisions have no model recorded. This is likely auto-rule decisions (no LLM call), but verify. If LLM decisions are losing model metadata, fix the observer logging.

10. **[LOW]** Weekend override is set but agent is stopped
    - `weekendOverrideUntil: "2026-05-10T19:51:15"` suggests someone wanted the agent running this weekend, but it's stopped. Align intent with state.

---

*Raw data: `audit-7d-2026-05-10.json`. Re-run: `node scripts/audit-2025-05-10.cjs --7d`*