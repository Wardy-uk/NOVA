# Handoff — investigate `triage` LLM call failures

**Raised:** 31 Jul 2026, during QA pipeline work. Not investigated at all — this doc is a starting point, not a diagnosis.

## The finding

Querying `agent_llm_calls` on the **main NOVA DB** (not the KPI DB) for the 7 days to 31 Jul 2026:

| call_type | calls | input tok | output tok | cost USD | failures |
|---|---|---|---|---|---|
| respond | 426 | 4,937,504 | 803,590 | 17.91 | 15 |
| **triage** | **2,435** | 7,258,137 | 2,031,928 | **17.42** | **1,613** |
| qa_scoring | 180 | 712,955 | 389,052 | 5.32 | 2 |
| ticket_analysis | 294 | 2,621,230 | 172,974 | 3.52 | 5 |
| coaching_synthesis | 352 | 548,036 | 409,261 | 2.59 | 4 |
| gr_comment_scoring | 1,407 | 1,356,814 | 218,967 | 2.45 | 0 |

**`triage` fails on 1,613 of 2,435 calls — 66%.** It is also the joint-largest cost line at $17.42/week. Every other call type is under 5% failure. Total platform spend is $51/week / $261/month, so a two-thirds failure rate on the biggest line is material.

## Why it matters

- The tokens appear to be spent regardless — `input_tokens`/`output_tokens` are recorded on the failed rows, so this is likely paid-for work being thrown away.
- If triage drives ticket routing/classification, a 66% failure rate means most tickets fall through to whatever the fallback path is. Worth establishing what that fallback does before assuming it's benign.
- Unknown whether this is a recent regression or long-standing. **Check the trend first** — see step 1.

## Where to start

### 1. Is it new, and what is the error?

```sql
-- Main NOVA DB (NOVA_SQL_CONNECTION in C:\Nurtur\NOVA\.env)
SELECT CAST(created_at AS DATE) d, COUNT(*) calls,
       SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) fails,
       ROUND(SUM(estimated_cost),2) cost
FROM agent_llm_calls
WHERE call_type='triage' AND created_at >= DATEADD(day,-60,GETUTCDATE())
GROUP BY CAST(created_at AS DATE) ORDER BY d;

-- The actual error strings, most common first
SELECT TOP 20 error, model, COUNT(*) n
FROM agent_llm_calls
WHERE call_type='triage' AND success=0 AND created_at >= DATEADD(day,-7,GETUTCDATE())
GROUP BY error, model ORDER BY n DESC;
```

Also check the central error log for the same window:

```sql
SELECT TOP 50 occurred_at, source, message, entity_ref
FROM error_log
WHERE occurred_at >= DATEADD(day,-7,GETUTCDATE())
ORDER BY occurred_at DESC;
```

### 2. Prior art worth ruling out

There was an LLM failover incident on 2026-07-22 caused by **`temperature` being deprecated on Claude 5/4.5 models** plus a required-field mismatch. See the memory note `reference-llm-failover-and-error-log`. If triage passes a `temperature` and runs on a Claude 5 model, that is the first thing to check — the same root cause may still be live on this call type. Check what model triage resolves to and whether it sets temperature.

### 3. Code entry points

- `src/server/services/llm-service.ts` — provider abstraction, `MODEL_PRICING`, `estimateCost()`, `logLlmCall()` (writes `agent_llm_calls`), `checkTokenBudget()`. Note: **token budgets suppress a call type until midnight UTC once exceeded** (`budgetSuppressed`, `TokenBudgetExceededError`) — confirm triage isn't simply being budget-blocked and logged as failure.
- `grep -rn "callType: 'triage'" src/server` for the caller(s).
- `src/server/services/ticket-classifier.ts` and the agent loop (`perceiver.ts` / `reasoner.ts`) are the likely consumers.

### 4. Questions to answer

1. Is the 66% rate constant, or a step change on a specific date?
2. Is it one error or several?
3. Are tokens genuinely being billed on failures, or is `logLlmCall` recording usage from a partial/aborted response?
4. What happens to a ticket when triage fails — silent skip, retry, or fallback classification? Does anything surface it?
5. Is a retry loop inflating the call count (2,435 calls vs how many distinct tickets)?

## How to query prod from a dev machine

No local creds. SSH to the read-only debug box over Tailscale:

```bash
ssh claude-debug@100.118.199.1
```

Notes that cost time this session:

- Default shell is **cmd**, not PowerShell — wrap as `powershell -NoProfile -Command "..."`.
- Quoting through SSH is painful. **Use `scp` to copy a `.cjs` file over, then run it** — far more reliable than inlining. `powershell -EncodedCommand` hits "command line is too long" for anything non-trivial.
- Run node with `$env:NODE_PATH='C:/Nurtur/NOVA/node_modules'` so `require('mssql')` resolves.
- Main DB connection string: `NOVA_SQL_CONNECTION` in `C:\Nurtur\NOVA\.env` (ADO format — parse like `parseConnectionString` in `services/database.ts`).
- KPI DB creds (`kpi_sql_*`) are in `C:\ProgramData\NOVA\settings.json`, **nested under a top-level `settings` key**. `agent_llm_calls` is NOT there — it's on the main DB.

## Out of scope

Don't get pulled into the QA pipeline work. That was finished separately on 31 Jul (see git log around v1.1.425) and is unrelated beyond both being LLM consumers.
