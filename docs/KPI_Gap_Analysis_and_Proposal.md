# Support KPI Gap Analysis & Proposed Master KPI Set

*Comparing: Daily KPI Tracker (spreadsheet) vs N.O.V.A automated capture vs HoTS Framework requirements*
*Date: 25 March 2026*

---

## 1. Current State: Daily KPI Tracker (Spreadsheet — Support Team Rows)

The following KPIs are manually reported daily in the "Daily KPI Tracker.xlsx" under the **Support** team section (rows 84-122):

| # | Spreadsheet KPI | Daily Target | Manual/Auto |
|---|----------------|-------------|-------------|
| 1 | WTD percentage KPI's Green | 90% | Manual |
| 2 | WTD percentage KPI's Red | 10% | Manual |
| 3 | Open Product Launch Incidents | — | Manual |
| 4 | Number of Tickets in CC - Incidents | 50 | Manual |
| 5 | Number of Tickets in CC - Service Requests | 65 | Manual |
| 6 | Number of Tickets in CC - TPJ | 50 | Manual |
| 7 | Number of Tickets in Production | 75 | Manual |
| 8 | Number of Tickets in Tier 2 | 20 | Manual |
| 9 | Number of Tickets in Tier 3 | 10 | Manual |
| 10 | Number of Tickets in Development | 1000 | Manual |
| 11 | No Reply in CC - Incidents | 0 | Manual |
| 12 | No Reply in CC - Production | 0 | Manual |
| 13 | No Reply in CC - TPJ | 0 | Manual |
| 14 | No Reply in Tier 2 | 0 | Manual |
| 15 | No Reply in Tier 3 | 0 | Manual |
| 16 | CC over SLA (actionable) - Incidents | 0 | Manual |
| 17 | CC over SLA (actionable) - Production | 0 | Manual |
| 18 | CC over SLA (actionable) - TPJ | 20 | Manual |
| 19 | Tier 2 over SLA (actionable) | 0 | Manual |
| 20 | Tier 3 over SLA (actionable) | 0 | Manual |
| 21 | CC over SLA (not actionable) - Incidents | 20 | Manual |
| 22 | CC over SLA (not actionable) - Production | 20 | Manual |
| 23 | CC over SLA (not actionable) - TPJ | 20 | Manual |
| 24 | Tier 2 over SLA (not actionable) | 10 | Manual |
| 25 | Tier 3 over SLA (not actionable) | 7 | Manual |
| 26 | Tickets escalated to Tier 2 | 15 | Manual |
| 27 | Tickets escalated to Tier 3 | 10 | Manual |
| 28 | Tickets escalated to Development | 10 | Manual |
| 29 | Tickets rejected by Tier 2 | 5 | Manual |
| 30 | Tickets rejected by Tier 3 | 5 | Manual |
| 31 | Tickets rejected by Development | 5 | Manual |
| 32 | Oldest actionable ticket (days) - CC Incident | 2 | Manual |
| 33 | Oldest actionable ticket (days) - CC Production | 10 | Manual |
| 34 | Oldest actionable ticket (days) - CC TPJ | 10 | Manual |
| 35 | Oldest actionable ticket (days) - Production | 30 | Manual |
| 36 | Oldest actionable ticket (days) - Tier 2 | 2 | Manual |
| 37 | Oldest actionable ticket (days) - Tier 3 | 5 | Manual |
| 38 | Failed Jobs remaining on Board | 100 | Manual |
| 39 | No. of CI In Progress (unmitigated) | 0 | Manual |

**Key observation:** All 39 KPIs are entered manually every day. Every single one is now automatically captured by N.O.V.A.

---

## 2. Three-Way Comparison

| Metric | Spreadsheet | N.O.V.A Automated | HoTS Required | Gap |
|--------|:-----------:|:-----------------:|:-------------:|-----|
| **Queue Volumes (7 tiers)** | ✅ Manual | ✅ Auto | ✅ | None — fully automated |
| **No-Reply Counts (5 tiers)** | ✅ Manual | ✅ Auto | — | None |
| **Over-SLA Actionable (5 tiers)** | ✅ Manual | ✅ Auto | ✅ | None |
| **Over-SLA Not Actionable (5 tiers)** | ✅ Manual | ✅ Auto | — | None |
| **Escalation Counts (3 tiers)** | ✅ Manual | ✅ Auto | ✅ | None |
| **Rejection Counts (3 tiers)** | ✅ Manual | ✅ Auto | ✅ | None |
| **Oldest Actionable Ticket (6 tiers)** | ✅ Manual | ✅ Auto | ✅ | None |
| **New / Solved Today** | ❌ | ✅ Auto | ✅ | **Spreadsheet missing** |
| **FRT Compliance % (per tier)** | ❌ | ✅ Auto | ✅ Target ≥95% | **Spreadsheet missing** |
| **Resolution Compliance % (per tier)** | ❌ | ✅ Auto | ✅ Target ≥95% | **Spreadsheet missing** |
| **Escalation Accuracy %** | ❌ | ✅ Auto | ✅ Target ≥90% | **Spreadsheet missing** |
| **CSAT %** | ❌ | ✅ Auto | ✅ +10-15% | **Spreadsheet missing** |
| **FCR Rate %** | ❌ | ✅ Auto | ✅ +10-20% | **Spreadsheet missing** |
| **1st Line Resolution Rate %** | ❌ | ✅ Auto | ✅ +15-25% | **Spreadsheet missing** |
| **Bug Escalation-to-Ack (hours)** | ❌ | ✅ Auto | ✅ -30% | **Spreadsheet missing** |
| **QA Score (ticket audits)** | ❌ | ✅ Auto (AI) | ✅ Avg ≥80% | **Spreadsheet missing** |
| **Golden Rules Compliance %** | ❌ | ✅ Auto (AI) | — (process quality) | **Spreadsheet missing** |
| **Agent-Level Performance** | ❌ | ✅ Auto | ✅ 100% coverage | **Spreadsheet missing** |
| **WTD % KPIs Green/Red** | ✅ Manual | ❌ | — | Derivable from automated RAG |
| **Failed Jobs on Board** | ✅ Manual | ❌ | — | Outside Jira — manual only |
| **CI In Progress** | ✅ Manual | ❌ | — | Outside Jira — manual only |
| **Open Product Launch Incidents** | ✅ Manual | ❌ | — | Outside Jira — manual only |
| **EOD Ticket Status Snapshot** | ❌ | ✅ Auto | — | Captures end-of-day state for trend analysis |

---

## 3. Key Findings

### What the spreadsheet has that N.O.V.A doesn't:
- **Failed Jobs remaining on Board** — separate monitoring system, not in Jira
- **No. of CI In Progress (unmitigated)** — separate CI/CD system
- **Open Product Launch Incidents** — separate tracking
- **WTD % KPIs Green/Red** — this is a meta-metric (% of other KPIs meeting target). Could be auto-calculated from N.O.V.A RAG statuses.

### What N.O.V.A captures that the spreadsheet doesn't (10 metrics):
1. FRT Compliance % (per tier)
2. Resolution Compliance % (per tier)
3. Escalation Accuracy %
4. CSAT %
5. FCR Rate %
6. 1st Line Resolution Rate %
7. Bug Escalation-to-Ack time
8. QA Score (AI ticket audits)
9. Golden Rules Compliance %
10. Agent-level breakdowns of all metrics

### What HoTS requires that neither currently surface:
- **NPS Score** — requires separate survey tool (not in Jira)
- **Support-Related Revenue Loss** — requires CRM/billing integration
- **Team Satisfaction** — requires anonymous survey
- **Production SLA Compliance** — separate process
- **Template Error Rate** — no automated tracking available
- **KAM Satisfaction** — qualitative stakeholder feedback

---

## 4. Proposed Master KPI Set

Replace the manual spreadsheet with an automated daily report containing:

### Tier 1: Executive Summary (5 metrics)
*One-glance health check for leadership*

| # | KPI | Target | Direction | Source |
|---|-----|--------|-----------|--------|
| 1 | **FRT Compliance % (All Tiers)** | ≥95% | Higher | Auto |
| 2 | **Resolution Compliance % (All Tiers)** | ≥95% | Higher | Auto |
| 3 | **CSAT %** | +10-15% from baseline | Higher | Auto |
| 4 | **Team QA Score** | ≥8.0/10 | Higher | Auto |
| 5 | **Golden Rules Compliance %** | ≥80% | Higher | Auto |

### Tier 2: Operational Health (8 metrics)
*Daily operational monitoring*

| # | KPI | Target | Direction | Source |
|---|-----|--------|-----------|--------|
| 6 | **New Tickets Today** | — | Monitor | Auto |
| 7 | **Tickets Solved Today** | — | Monitor | Auto |
| 8 | **Escalation Accuracy %** | ≥90% | Higher | Auto |
| 9 | **1st Line Resolution Rate %** | +15-25% from baseline | Higher | Auto |
| 10 | **FCR Rate %** | +10-20% from baseline | Higher | Auto |
| 11 | **Bug Escalation-to-Ack (hours)** | -30% from baseline | Lower | Auto |
| 12 | **Total Over-SLA Actionable** | 0 | Lower | Auto |
| 13 | **Total No-Reply Tickets** | 0 | Lower | Auto |

### Tier 3: Queue Detail (14 metrics)
*Per-tier visibility for team leads*

| # | KPI | Source |
|---|-----|--------|
| 14-20 | **Open Tickets by Tier** (CC Inc, CC SR, CC TPJ, Prod, T2, T3, Dev) | Auto |
| 21-26 | **Oldest Actionable Ticket by Tier** (CC Inc, CC Prod, CC TPJ, Prod, T2, T3) | Auto |
| 27 | **Dev Queue Size** | Auto |

### Tier 4: Escalation Detail (6 metrics)
*Triage quality and tier boundary health*

| # | KPI | Source |
|---|-----|--------|
| 28-30 | **Escalated to T2 / T3 / Dev** | Auto |
| 31-33 | **Rejected by T2 / T3 / Dev** | Auto |

### Tier 5: Manual-Only (3 metrics)
*Cannot be automated — continue manual entry*

| # | KPI | Why Manual |
|---|-----|-----------|
| 34 | **Failed Jobs on Board** | Separate monitoring system |
| 35 | **CI In Progress (unmitigated)** | CI/CD system |
| 36 | **Open Product Launch Incidents** | Separate tracking |

### Removed from Proposed Set
| KPI | Reason |
|-----|--------|
| WTD % KPIs Green/Red | Replaced by per-metric RAG indicators |
| Over-SLA Not Actionable (5 metrics) | Available in detail view but not daily headline |
| No-Reply per tier (5 metrics) | Rolled up to "Total No-Reply" headline; detail available on demand |

---

## 5. Implementation Recommendation

**Phase 1 (Immediate):** Stop manual spreadsheet entry for all automated metrics. The Daily KPI Report v3.1 email already delivers these daily. Direct stakeholders to the NOVA KPI Dashboard at `nova.nurtur.tech` for real-time data.

**Phase 2 (This sprint):** Add the 3 manual-only metrics (Failed Jobs, CI, Product Launch Incidents) as a manual input section in NOVA, so everything is in one place.

**Phase 3 (Next sprint):** Build automated "WTD Summary" that calculates the % of KPIs meeting target — replacing the manual Green/Red percentage.

**Outcome:** Eliminate ~30 minutes of daily manual data entry, reduce human error, and gain 10 new metrics (FCR, CSAT, QA, Golden Rules, 1st Line Rate, Bug Ack, FRT/Resolution compliance, Escalation Accuracy) that the spreadsheet never captured.
