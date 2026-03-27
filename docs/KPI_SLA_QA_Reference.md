# Support Performance Metrics — Complete Reference

*Document Owner: Head of Technical Support*
*Last Updated: 25 March 2026*

---

## 1. Service Level Agreements (SLAs)

### First Response Time (FRT) Compliance %
**What it measures:** Percentage of tickets where the customer received a first response within the agreed SLA timeframe.
**Target:** ≥95% across all tiers
**Granularity:** Per tier (CC Incidents, CC Service Requests, CC TPJ, Production, Tier 2, Tier 3, Development) + aggregate
**Source:** Jira Service Management SLA engine → Daily KPI Report v3.1
**Frequency:** Captured daily, trended weekly

### Resolution Compliance %
**What it measures:** Percentage of tickets resolved within the agreed resolution SLA timeframe.
**Target:** ≥95% across all tiers
**Granularity:** Per tier + aggregate
**Source:** Jira Service Management SLA engine → Daily KPI Report v3.1
**Frequency:** Captured daily, trended weekly

---

## 2. Queue Health Metrics

### Open Ticket Volume (by Tier)
**What it measures:** Current count of open tickets in each support tier.
**Tiers tracked:** CC Incidents, CC Service Requests, CC TPJ, Production, Tier 2, Tier 3, Development
**Why it matters:** Indicates workload distribution and capacity pressure across tiers.
**Source:** Daily KPI Report v3.1 (Jira JQL query)

### No-Reply Ticket Count (by Tier)
**What it measures:** Tickets awaiting a response from the support team — no agent reply yet.
**Target:** 0 across all tiers
**Why it matters:** Directly impacts customer experience and SLA compliance.

### Over-SLA Tickets — Actionable
**What it measures:** Tickets that have breached their SLA and are currently actionable by the team (not waiting on customer/third party).
**Target:** 0 across all tiers
**Why it matters:** These are the tickets the team can and should act on immediately.

### Over-SLA Tickets — Not Actionable
**What it measures:** Tickets breaching SLA but currently blocked (awaiting customer response, third party, etc.).
**Why it matters:** Identifies systemic bottlenecks outside the team's direct control.

### Oldest Actionable Ticket Age (by Tier)
**What it measures:** Age in days of the oldest ticket that is currently actionable in each tier.
**Why it matters:** A canary metric — if this number is growing, the backlog is ageing.

### New Tickets Today / Tickets Solved Today
**What it measures:** Daily inflow vs outflow of tickets.
**Why it matters:** Indicates whether the team is keeping pace with demand.

---

## 3. Escalation Metrics

### Escalation Volume (to Tier 2 / Tier 3 / Development)
**What it measures:** Number of tickets escalated from Customer Care to each higher tier.
**Why it matters:** Tracks 1st Line's ability to resolve without escalation.

### Rejection Volume (by Tier 2 / Tier 3 / Development)
**What it measures:** Tickets sent back from a higher tier because they were incorrectly escalated.
**Why it matters:** Measures triage accuracy — high rejections indicate training gaps.

### Escalation Accuracy %
**What it measures:** Percentage of escalated tickets that were correctly routed first time (not rejected back).
**Target:** ≥90%
**Calculation:** `(Escalated - Rejected) / Escalated × 100`
**Source:** Daily KPI Report v3.1

---

## 4. Customer Satisfaction

### CSAT %
**What it measures:** Customer satisfaction rating from post-resolution surveys in Jira Service Management.
**Scale:** 1-5 star rating, converted to percentage (e.g., 4.5/5 = 90%)
**Target:** +10-15% improvement from baseline by Day 90
**Source:** Jira `customfield_12802.rating` → Daily KPI Report v3.1 + FCR Backfill
**Frequency:** Captured daily

### First Contact Resolution (FCR) Rate %
**What it measures:** Percentage of tickets resolved without the customer needing to follow up after the first agent response.
**Definition:**
- Ignore automated replies (Nurtur bot, AI auto-replies)
- Ignore internal notes
- "First contact" = first public comment from a real agent (accountType: 'atlassian')
- FCR = true if no customer comment exists after that first agent reply
**Target:** +10-20% improvement from baseline
**Source:** Daily KPI Report v3.1 + FCR Backfill
**Frequency:** Captured daily

---

## 5. Quality Assurance — Full Ticket QA

### Overall QA Score (1-10)
**What it measures:** AI-assessed quality of the agent's ticket handling, scored across four dimensions.
**Target:** Team average ≥8.0 (equivalent to 80%)
**Scoring dimensions:**
| Dimension | Weight | What it assesses |
|-----------|--------|-----------------|
| Accuracy | 35% | Was the information provided correct? |
| Clarity | 25% | Was the communication clear and understandable? |
| Tone | 20% | Was the tone professional, empathetic, appropriate? |
| Closure | 20% | Did the agent properly resolve or advance the ticket? |

### Grade (GREEN / AMBER / RED)
- **GREEN:** Overall score ≥7.5
- **AMBER:** Overall score ≥5.5
- **RED:** Overall score <5.5

### Concerning Flag
Flagged when any individual dimension score ≤4, or tone/compliance risks detected.

### Additional QA Outputs
- **Category** — Classification of the issue type
- **Issues** — Specific problems identified
- **Coaching Points** — Actionable feedback for the agent
- **Suggested Reply** — AI-generated improved response
- **Customer Sentiment** — Positive / Neutral / Negative

**Exclusions:** Chat request type tickets are excluded from QA scoring.
**Source:** Ticket_QA_V5_FullQA (hourly) + QA_FullQA_Backfill
**Frequency:** Every resolved ticket, processed hourly during business hours (Mon-Fri 8am-6pm)

---

## 6. Quality Assurance — Golden Rules

### Three Golden Rules (per agent comment)
Each public agent comment is scored against three communication standards:

| Rule | What it assesses | Score 3 (Pass) | Score 2 (Needs work) | Score 1 (Fail) |
|------|-----------------|----------------|---------------------|----------------|
| **Ownership** | Who owns the next step? | Named person/role/team stated | Vague — "we're looking into it" | No ownership stated |
| **What's Happening** | What concrete action is being taken? | Specific next action stated | Vague — "investigating" | Only acknowledges receipt |
| **Timeframes** | When will the customer hear back? | Specific committed time | Weak — "soon", "ASAP" | No timeframe given |

### Overall Golden Rules Score
= Minimum of the three rule scores (weakest rule sets the overall)

### Pass/Fail per Rule
Pass threshold configurable (default: score ≥2)

### Golden Rules Compliance %
**What it measures:** Percentage of agent comments passing all three rules.
**Target:** ≥80%

**Exclusions:** Bot comments, customer comments, private internal notes, non-team-member comments.
**Source:** Ticket_QA_V5_GoldenRules (hourly) + QA_GoldenRules_Backfill
**Frequency:** Every public agent comment, processed hourly during business hours

---

## 7. Tiered Support Effectiveness

### 1st Line Resolution Rate %
**What it measures:** Percentage of resolved tickets that were handled entirely within Customer Care (CC) without escalation to Tier 2, Tier 3, or Development.
**Target:** +15-25% improvement from baseline
**Calculation:** Based on request type classification — CC bucket types (Incident, Chat, AI Request, Emailed Request, GDPR, Service Request, TPJ Request) count as 1st Line resolved.
**Source:** Daily KPI Report v3.1 + FCR Backfill
**Frequency:** Captured daily

---

## 8. Engineering Collaboration

### Bug Escalation-to-Acknowledgement Time (hours)
**What it measures:** Average time from ticket creation to first agent response, for bug/development tickets.
**Target:** -30% reduction from baseline by Day 90
**Scope:** Tickets with issue type "Bug", "Development", or "Defect", or with status containing "Development"
**Source:** Daily KPI Report v3.1 + FCR Backfill
**Frequency:** Captured daily

---

## 9. Checkpoint Framework

All metrics above feed into the **90-Day Checkpoint Evidence Panel**, with snapshots taken at:

| Checkpoint | Date | Purpose |
|-----------|------|---------|
| Day 0 | 01 Mar 2026 | Pre-intervention baseline |
| Day 1 | 16 Mar 2026 | Initial measurement after changes begin |
| Day 15 | 31 Mar 2026 | Early progress check |
| Day 30 | 15 Apr 2026 | First monthly review |
| Day 45 | 30 Apr 2026 | Mid-point assessment |
| Day 60 | 15 May 2026 | Two-month review |
| Day 90 | 14 Jun 2026 | Final evaluation |

---

## 10. Agent-Level Metrics

Per-agent daily tracking includes:
- Tickets solved count
- QA average score
- Golden Rules compliance %
- CSAT average rating
- Open ticket count

These feed the **Agent Leaderboard** in the NOVA KPI Dashboard.
