# NOVA AI Agent — Independent Audit Report
**Window:** 2026-04-23 (go-live) → 2026-04-28
**Author:** Independent classification via Atlassian MCP
**Status:** Pilot — methodology proven on 1 ticket, full sweep deferred to Claude Code

---

## Scope

- `agent_go_live_date`: **2026-04-23**
- `agent_jira_project`: **NT**
- `agent_shadow_mode`: **hybrid**
- `agent_hybrid_allowed_actions`: **`["plugin_to_tpj", "abuse_report"]`** — only these are LIVE; everything else is shadow
- Tickets created in window: **~600** (~100/day × 6 days, confirmed by paging the first 200)

## Parser config in use (defaults — settings keys not explicitly set)

| Setting | Default applied |
|---|---|
| `n8n_comment_author_emails` | `Alerts@Nurtur.tech` |
| `n8n_comment_author_display_names` | `Nurtur` |
| `n8n_comment_body_marker` | `AI Summary` |

`parseN8nAction()` first-match-wins priority:
1. `close` ← `/no escalation is needed|no fault|auto[- ]?resolve|\bclose\b/i`
2. `escalate` ← `/escalate to|escalation required|recommend escalation/i`
3. `respond` ← `/respond to customer|reply to|\*\*reply:\*\*|\*\*suggested reply:\*\*/i`

## Identified n8n actor accounts

| accountId | displayName | Role |
|---|---|---|
| `712020:ac84e46b-ecff-4878-974c-2825b0497d54` | `Nurtur` | n8n service account — posts AI Summary, public replies, Round Robin |
| `712020:67acd53f-75f0-4548-adfe-91bba72ad38f` | `NOVA-Jira` | NOVA itself — posts shadow-mode triage comments |

The NOVA-Jira account is in `agent_comment_exclude_accounts` (correctly — agent shouldn't analyse its own posts). The Nurtur account is **not** excluded — that's the ground truth source for n8n actions.

---

## Pilot finding: NT-17392 (Tue 28 Apr) — **Parser False Positive**

**NOVA decision:** `escalate` × 4 records, confidence 0.82, all shadow_mode=true. Reasoning: domain-specific portal failure beyond first-line; recommend T2/T3 investigation.

**n8n actual sequence on the ticket:**

| Time | Author | Action |
|---|---|---|
| 16:00:38 | Nurtur (n8n) | Posted internal "AI Summary" — Recommended Tier: **Tier 2**, escalation guidance only ("Escalate to Tier 3/Development if…") |
| 16:00:59 | Nurtur (n8n) | Posted **public reply** to Lucy asking for screenshot, URL, browser detail — this is a `respond` action |
| 16:05:19 | Nurtur (n8n) | Round Robin v6 auto-assigned to Naomi Wentworth — this is an `assign` action |
| 16:08:02 | NOVA-Jira | Shadow-mode triage comment (NOVA's own log) |
| 17:23:26 | Naomi Wentworth (human) | Resolved — "alerts weren't enabled on the user's account" |

**Ground truth of what n8n did:** `respond` + `assign`. n8n did **not** escalate beyond Tier 2 — it stayed in scope and posted a customer-facing reply.

**What `parseN8nAction()` would extract:** `escalate`. The AI Summary body contains the literal string "Escalate to Tier 3/Development if:" (in the conditional escalation guidance section). This matches the `/escalate to/i` regex and wins over `respond` because of the if-else priority order.

**Result:** NOVA's existing `ai_comparison_log` would record this as **n8n=escalate, NOVA=escalate, agreement=true** — even though n8n's actual public action was `respond` and the recommended tier was unchanged. False positive on agreement.

### Why this matters

Today's morning report claimed "decision mix has stabilised" with 27% escalate. If the parser is reading n8n's *recommendation language* rather than n8n's *actual action*, the comparison signal is biased toward false agreement on escalations. NOVA's escalate-rate vs n8n's escalate-rate isn't apples-to-apples.

---

## Parser blind spots identified (from one ticket — likely more)

1. **Conditional language false-match.** "Escalate to Tier 3 if X" in advisory text is parsed as an escalate action even when X isn't true and n8n didn't escalate.
2. **Single-comment view.** The parser reads the AI Summary only. n8n's actual customer-facing action (the public reply, posted seconds later) is invisible to the comparison.
3. **`Recommended Tier:` field ignored.** The parser captures it (`tierMatch`) but doesn't gate the action on it. A summary saying "Tier 2" should not produce action=escalate.
4. **Round Robin assignment invisible.** n8n's `assign` action via Round Robin v6 (which posts a separate comment from the Nurtur account) isn't currently mapped to any action class — the parser only knows close/escalate/respond.

---

## Recommended remediation

### Short term (parser tightening)
- Add a guard: ignore matches inside conditional clauses (`if`, `should be escalated to T3 if`) by requiring the keyword to appear in a directive context (e.g. line starting with "Recommended Action:", or a specific "Action:" line).
- Use `tierMatch` as the gate: action=escalate only if `Recommended Tier` is *higher* than current ticket tier.
- Treat the public reply comment from the Nurtur account as a separate action (`respond`) rather than only reading the AI Summary.

### Medium term (audit infra)
- Build a `n8n_action_log` table that records each Nurtur-account comment as a discrete action (summary | reply | assign | transition) with parsed metadata. Comparison joins against this rather than a single field.
- Backfill from go-live date to start.

---

## Scope handoff to Claude Code

**Job:** Independent audit of all ~600 NT tickets created since 2026-04-23.

**Methodology proven by this pilot:**
1. JQL: `project = NT AND created >= "2026-04-23 00:00"` (paginate, ~6 pages of 100).
2. For each ticket: `getJiraIssue` with `fields=["comment"]`, `responseContentFormat=markdown`.
3. Filter comments to `author.accountId == 712020:ac84e46b-ecff-4878-974c-2825b0497d54` (the Nurtur account).
4. Per ticket, classify n8n's *actual* actions taken (not advisory text) using these signals:
   - **AI Summary** comment: presence + parsed `Recommended Tier`
   - **Public reply** comment (jsdPublic=true, no AI Summary marker): `respond`
   - **Round Robin v6** comment (body contains "Auto-assigned by"): `assign`
   - **Resolution/transition** comment patterns (TBD)
5. Pull NOVA decisions per ticket via `nova_agent_decisions(ticket_key=X)`.
6. Compare and emit a report: agreement matrix, false-positive examples, parser fix candidates.

**Output file:** `docs/agent-audit-2026-04-23-to-28-results.md` with per-day agreement rates and a sample of disagreement cases.

**Estimated runtime:** ~10 minutes if scripted with concurrency 5; ~600 ticket fetches + ~600 NOVA lookups.

---

*Pilot complete: 1 ticket, 1 parser blind spot found. Full sweep needed.*
