# NOVA AI Agent Audit — 24H Results
**Window:** 2026-05-09 → 2026-05-10 (1 day)
**Generated:** 2026-05-10T17:05Z
**Method:** Jira comment multi-signal classification + NOVA decision API + NOVA aggregate APIs
**Methodology version:** v3 — fixed comparison logic (complementary/proactive are not failures)

---

## 1. Headline Metrics

| Metric | Value | April Baseline |
|---|---|---|
| Tickets in window | **66** | 159 (24h) / 474 (5d) |
| NOVA decision coverage | **97.0%** (64/66) | 99.4% (24h) / 93.9% (5d) |
| Total NOVA decisions | **69** | 410 (24h) / 1,246 (5d) |
| Effective alignment rate | **68.8%** (11/16) | ~44.9% (inflated disagree) |
| Real disagreement rate | **31.3%** (5/16) | ~56.5% (inflated) |
| Over-escalation count | **5** | ~36 (5d) |
| False no_action count | **0** | ~90 (5d) |
| Premature close count | **0** | not measured |
| Shadow mode % | **29.0%** | 91.6% (5d) |
| Live mode % | **71.0%** | 8.4% (5d) |
| Tickets with no NOVA decision | **2** | 1 (24h) / 29 (5d) |

### Verdict Breakdown

| Verdict | Count | % of compared |
|---|---|---|
| no_comparison | 48 | 75.0% |
| proactive | 7 | 10.9% |
| real_disagree | 5 | 7.8% |
| agree | 2 | 3.1% |
| complementary | 2 | 3.1% |

## 2. Per-Day Breakdown

| Day | Tickets | n8n Cov | NOVA Cov | Agree | Comp | Proactive | Disagree | Alignment |
|---|---|---|---|---|---|---|---|---|
| 2026-05-09 | 34 | 100.0% | 94.1% | 21 | 2 | 5 | 4 | 87.5% |
| 2026-05-10 | 32 | 96.9% | 100.0% | 28 | 0 | 2 | 1 | 96.8% |

## 3. Decision Quality

### 3a. Disagreement Buckets

| Bucket | Count | Description |
|---|---|---|
| over_escalation | 5 | NOVA escalated but n8n responded/assigned at lower tier |

### 3b. Disagreement Examples (up to 25)

| Ticket | NOVA | Conf | Bucket | n8n Ground Truth | Shadow | Summary |
|---|---|---|---|---|---|---|
| NT-18393 | escalate | 0.85 | over_escalation | respond (tier: Tier 2) | Y | Triggers Not Firing Report |
| NT-18394 | escalate | 0.92 | over_escalation | idle (tier: Customer Care) | Y | Product Cancellation - BuildYourMarket For LA Property Discovery |
| NT-18401 | escalate | 0.85 | over_escalation | respond (tier: Tier 2) | Y | LeadPro  |
| NT-18403 | escalate | 0.55 | over_escalation | respond (tier: Customer Care) | Y | CIA Letter Alerting |
| NT-18432 | escalate | 0.82 | over_escalation | respond (tier: Tier 2) | Y | nortonhighfieldltd.com |

### 3c. NOVA Action Profile

| Action | Count | % |
|---|---|---|
| auto_rule_smart-plugin-tpj | 18 | 26.1% |
| auto_rule_smart-plugin-persistent-fail | 8 | 11.6% |
| escalate | 7 | 10.1% |
| assign | 7 | 10.1% |
| auto_rule_smart-plugin-connect-fail | 6 | 8.7% |
| draft_response | 5 | 7.2% |
| no_action | 3 | 4.3% |
| auto_rule_cia-letter-dedup | 3 | 4.3% |
| auto_rule_abuse-report | 3 | 4.3% |
| auto_rule_product-cancellation | 3 | 4.3% |
| auto_rule_freedom-leisure-integration | 2 | 2.9% |
| auto_rule_mwu-tier-2 | 2 | 2.9% |
| auto_rule_auction-house-success | 2 | 2.9% |

### 3d. Confidence Distribution

| Band | Count | % |
|---|---|---|
| High (≥0.80) | 64 | 92.8% |
| Medium (0.50–0.79) | 4 | 5.8% |
| Low (<0.50) | 1 | 1.4% |

### 3e. Model Usage

| Model | Count | % |
|---|---|---|
| unknown | 47 | 68.1% |
| claude-sonnet-4-6 | 22 | 31.9% |

### 3f. Event Type Distribution

| Event | Count | % |
|---|---|---|
| ticket_created | 64 | 92.8% |
| comment_added | 3 | 4.3% |
| resolution_review | 1 | 1.4% |
| backfill | 1 | 1.4% |

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
| Shadow | 20 | 29.0% |
| Live | 49 | 71.0% |

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
| Raw agreement rate | 43.5% (inflated disagree) | 68.8% (effective alignment) | Methodology fixed — not directly comparable |
| Real disagreement | ~21% (reclassified) | 31.3% | Measured properly now |
| Over-escalation | ~36 (5d) | 5 | Improved |
| False no_action | ~90 (5d) | 0 | Improved |
| NOVA coverage | 93.9% (5d) | 97.0% | Improved |
| Shadow % | 91.6% | 29.0% | - |
| Tickets with no decision | 29 (5d) | 2 | - |

### Key Changes Since April

1. **Methodology v3** — Complementary/proactive actions correctly separated from real failures
2. **Escalation policy** — 5-gate evaluation with evidence scoring, repeat-escalation dampener
3. **Critic gate** — LLM review of high-stakes actions before execution
4. **Quick-win engine** — Pattern-based auto-close with undo capability
5. **Autonomy engine** — Category-based approval bypass with statistical thresholds
6. **Impact measurement** — Rolling 7-day metrics (resolution rate, deflection, queue hours saved)

## 12. Verdict

**NOT MATERIALLY IMPROVED** — Real disagreement rate remains too high for autonomous operation.

- Effective alignment: 68.8%
- Real disagreement: 31.3%
- Over-escalation: 5 (target: <10 per 5d window)
- False no_action: 0 (target: <15 per 5d window)
- Premature close: 0

## 13. Top 10 Remediation Items

1. **[MEDIUM]** Approval SLA monitoring
   - Ensure approval timeouts are configured. Expired approvals should auto-decline or alert, not sit forever.
2. **[LOW]** KB gap closure rate
   - Review open KB gaps and close or create articles. High gap count reduces AI response quality.
3. **[LOW]** Model cost optimisation
   - Review model distribution. If cheaper models perform comparably on low-complexity categories, route accordingly.
4. **[LOW]** Portal chat evaluation
   - If portal chat is live, audit deflection rate and handoff quality separately.

---

*Raw data: `audit-24h-2026-05-10.json`. Re-run: `node scripts/audit-2025-05-10.cjs`*