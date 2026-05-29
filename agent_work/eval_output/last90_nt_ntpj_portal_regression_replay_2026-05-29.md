# Last-90-Day NT / NTPJ Portal Phase3 Regression Replay

**Eval date:** 2026-05-29
**Agent:** Claude Code (Eval Agent, NOVA Portal Phase3)
**Purpose:** Validate that the converged Portal Phase3 routing fixes (Iteration 43) hold across a broad historical population — not just the targeted Iteration 43 scenarios — by replaying the last 90 days of NT and NTPJ opening requests through the running portal and checking for recurrence of previously fixed blockers.

---

## 1. Verdict

### ✅ `REGRESSION PROTECTED`

Across **1,260 successfully replayed** historical NT/NTPJ opening requests, **none of the nine previously fixed blockers recurred materially**. Routing, summary-card population, response integrity, and URL capture all held. The handful of flagged edge cases are either correct-on-inspection or atypical internal-forward emails — none reproduces a blocker-class failure.

**Recommendation:** Iteration 43 can move from **`Converged Pending Protection` → `Regression Protected`.**

> Scope caveat (does not change the verdict): this replay exercises the **first-turn routing decision + summary card where the flow reaches it**, using one isolated session per ticket (single-shot, no multi-turn follow-up, no LLM-repeat). It is broad (n=1,260) but not deep on multi-turn flows. See §9.

---

## 2. Runtime freshness confirmation

| Check | Result |
|---|---|
| `src/server/services/portal-chat.ts` last write | **2026-05-29 12:07:16** |
| Stale server processes | Detected (a 10:55 dev tree + ~12 orphaned `tsx` processes from 28/05) — **killed**; port 3001 confirmed free before restart |
| Fresh server start | `tsx watch src/server/index.ts` (equivalent to `npm run dev:server`) |
| Worker process (pid 47824) start time | **2026-05-29 13:21:51** |
| Freshness condition (worker newer than portal-chat.ts) | **PASS** — worker is 1h14m newer than the last `portal-chat.ts` write |
| Server bound | `[N.O.V.A] API server running on http://localhost:3001`; `[N.O.V.A] Portal routes wired (currently enabled)` |
| Portal liveness | `codex-test-login` issued valid token; 3-ticket smoke replay returned 200s with full metadata |

**Notes:** A non-fatal idempotent migration error (`IX_kb_usage_article is dependent on column article_id`) appeared in stderr during boot; the server continued past it to bind normally (this matches the project's ALTER-TABLE try/catch migration pattern). Initial bootstrap took ~90s and its stdout was block-buffered through the process pipe, which initially masked successful startup; freshness was confirmed once logs flushed and the port bound. **Freshness is trusted.**

---

## 3. Date window

| | Value |
|---|---|
| Window (stated) | 2026-02-28 00:00 → 2026-05-29 23:59 Europe/London |
| Extraction bounds (end-exclusive) | **`jira_created >= 2026-02-28T00:00:00Z` AND `jira_created < 2026-05-30T00:00:00Z`** |

(Late-May timestamps are BST/UTC+1; the one-hour boundary nuance at the window edge is immaterial to a 90-day routing-regression population.)

---

## 4. Extraction / selection method

- **Source:** `jira_issue_cache` table in the NOVA primary MSSQL database (`techservicesjsm`-side cache), queried directly via `NOVA_SQL_CONNECTION` — independent of the dev server (no sql.js conflict).
- **Script:** `agent_work/eval_output/_extract_last90_nt_ntpj.mjs` (adapted from the existing `_extract_portal_replay_range.mjs`).
- **Filter:** `project_key IN ('NT','NTPJ')` within the date window, with eligibility classification applied in SQL.
- **Eligibility rules** (a ticket is a `candidate` unless it hits an exclusion):
  - `exclude_empty` — null/blank description
  - `exclude_too_short` — < 12 chars
  - `exclude_noise` — body is `test`/`testing`/`n/a`, or summary mentions spam
  - `exclude_machine` — auto-reply / out-of-office / bounce-back / undeliverable / "do not reply" / "automated message"
  - `needs_attachment_review` — body references an attachment ("please see attached" / "see the attached") → **flagged separately, not replayed**
- **Deliberate deviation from the Phase3 extractor:** weekend / out-of-hours tickets are **kept as candidates** (the original script excluded them). Routing/output integrity is independent of ticket creation time, so dropping them would needlessly shrink the historical population this eval is meant to broaden.

---

## 5. Population counts

### Total tickets by queue (in window)

| Queue | Total | Candidate (replayed) | Attachment-flagged |
|---|---|---|---|
| **NT** | 929 | 873 | 11 |
| **NTPJ** | 394 | 388 | 5 |
| **Total** | **1,323** | **1,261** | **16** |

### Exclusion summary

| Reason | Count |
|---|---|
| candidate (eligible) | 1,261 |
| exclude_machine | 29 |
| needs_attachment_review (flagged separately) | 16 |
| exclude_empty | 16 |
| exclude_noise | 1 |
| **Excluded total** | **62** |

---

## 6. Replay totals

- **Method:** `agent_work/eval_output/_replay_last90.mjs` — one **fresh isolated portal session** per ticket via `POST /api/portal/auth/codex-test-login`; send the extracted opening message; capture first assistant response + session metadata (intent, stage, category, subcategory, deflected, kbSuggested, collected fields, summary subject/description); then end the session. **No tickets submitted** (single opening turn only; the flow asks follow-ups rather than auto-submitting). Concurrency 4, incremental save every 10.
- **Replayed:** 1,261 candidates
- **Succeeded:** **1,260**
- **Errored:** **1** (`opening_message_unusable` — one ticket whose extractable opening text, after signature/quote stripping, was < 12 chars; benign)

| Queue | Replayed | OK |
|---|---|---|
| NT | 873 | 872 |
| NTPJ | 388 | 388 |

### Outcome distribution (n=1,260)

| Intent | n |  | Category | n |  | Stage reached | n |
|---|---|---|---|---|---|---|---|
| change | 491 | | website | 376 | | detail | 745 |
| problem | 376 | | account | 257 | | **summary** | **475** |
| null | 361 | | data_feeds | 162 | | kb_check | 31 |
| question | 32 | | property | 161 | | intent | 9 |
| | | | other | 114 | | | |
| | | | email_marketing | 95 | | | |
| | | | billing | 38 | | | |
| | | | letters / followup / complaint / leadpro | 39 | | | |
| | | | (null) | 18 | | | |

KB suggested: 31 · Deflected: 0.

---

## 7. Regression blocker results

Each previously fixed blocker was detected with a heuristic over the **running-software outputs** (captured responses + session metadata only — no source inspection), then flagged cases were manually reviewed. Detector + full flagged records: `agent_work/eval_output/last90_flags.json`.

| # | Previously fixed blocker | Raw flags | True recurrences | Status |
|---|---|---|---|---|
| 1 | Email-marketing over-capture | 61* | ~2 ambiguous | ✅ Not recurring |
| 2 | Property **count mismatch** → generic website framing | 0 | 0 | ✅ Not recurring |
| 3 | Property **wrong-status** → generic website framing | 2 | 0 | ✅ Not recurring |
| 4 | CRM/API/leads/database integration → email marketing | 4 | 0–1 borderline | ✅ Not recurring |
| 5 | URL-less named-page amendment → `other_general` | 0 | 0 | ✅ Not recurring |
| 6 | Domain truncation (`www.example.co.uk → www.co.uk`) | 0 | 0 | ✅ Not recurring |
| 7 | Garbled / duplicated assistant responses | 0 | 0 | ✅ Not recurring |
| 8 | False "you've been in touch before" on fresh sessions | 0 | 0 | ✅ Not recurring |
| 9 | Blank summary subject/description with usable input | 0 | 0 | ✅ Not recurring |

\* Heuristic was deliberately broad (any `email_marketing` ticket lacking explicit campaign keywords). On inspection the 61 break down as **genuinely email-platform** content, not unrelated requests being dragged in (see §7.1).

### 7.1 Email-marketing capture — breakdown of the 61 flags (blocker #1)

| Sub-group | n | Verdict |
|---|---|---|
| BYM **transactional-email** system footers ("This is a transactional message…") | 33 | Genuine email-platform notifications |
| Email **trigger alerts** ("triggers fired below 20% of average") | 4 (+4 in remainder) | Correct — BYM email automation |
| Email **reporting / usage stats** (ReportServer, interaction stats, Digi-Val usage) | 6 | Correct — email reporting |
| **Contact-list / email management** (upload customer list, remove emails from BYM, email footer typo, test send) | ~8 | Correct — email contact/content |
| System-build-test / instance provisioning forwards | 3 | Mild; provisioning-adjacent |
| **Genuine website-vs-email mis-route** (NTPJ-7021 website notes change; NT-18828 office address in website+BYM footer) | ~2 | Borderline — both also mention the BYM/email footer |

`email_marketing` is **95/1,260 (7.5%)** of all routings, and the feed/CRM/property/website families retain their own categories (`data_feeds` 162, `property` 161, `website` 376). The original failure mode — unrelated requests aggressively pulled into email marketing — **is not occurring**. Worst case ≈ 2 ambiguous website/footer edge cases out of 1,260.

### 7.2 CRM/API/feeds → email marketing (blocker #4)

The 4 flagged tickets are vague internal-forward emails, not the customer feed-sync pattern the blocker covered:
- **NT-19300** — an `InstanceMigrationRunner` dev/migration log (atypical internal ticket); arguably mis-routed but not a customer feed request.
- **NT-19846** — "create separate BYM accounts" (account provisioning, forwarded with detail below the fold).
- **NT-19631 / NT-16496** — Digi-Val usage / "BYM NH database" marketing-admin queries (defensibly email-adjacent).

The classic feed-sync failures (Reapit / Alto / Street / LeadPro / Rightmove feed) correctly land in **`data_feeds` (162 tickets)** — e.g. NT-19183 `property/property_feed_sync`, NT-17101/NT-17505 `data_feeds/feeds_integration`.

### 7.3 Property wrong-status (blocker #3)

Both flagged tickets (NT-17273 deactivated office's property still live; NT-20012 properties that should read "LET AGREED") routed to **`data_feeds/feeds_property`** — a *specific, sensible* category for feed-propagation issues, **not** the generic-website framing the blocker described. False positives against the blocker.

### 7.4 Positive confirmations (fixes working, not just "no flag")

- **Summary card:** of the **475** sessions that reached `stage = summary`, **475/475 had BOTH a populated subject AND description** — zero blanks (blocker #9 solidly fixed).
- **Count mismatch:** the count-mismatch opener present in the population routed to `property/property_media` — property, not website (blocker #2).
- **Named pages:** 76 openers referencing named pages spread across website (34), property (23), data_feeds (9), account (6) — **none** to `other_general` (blocker #5).
- **URL integrity:** **238 distinct hostnames** captured cleanly (e.g. `maysestateagents.nurtur.digital`, `julietwist.briefyourmarket.com`, `fineandcountry.co.uk`). The only sub-2-label host was `bym-assrs`, an internal intranet report-server hostname from a forwarded email — **not** a truncated public domain (blocker #6).
- **No garbled/duplicated responses** and **no false "previous contact"** language across all 1,260 responses (blockers #7, #8).

---

## 8. Representative examples (with keys)

**Correct routing (PASS):**
- `NT-11206` — "Book a viewing emails not going to Street feed" → `data_feeds/feeds_integration`, captured URL `https://angusandco.uk/`.
- `NT-19183` — property feed not syncing → `property/property_feed_sync`.
- `NT-18541`, `NT-18776` — properties not showing on site → `property/property_visibility`.
- `NTPJ-5377`, `NT-18320` — wrong sale status → `property/property_status`.
- `NT-13019`, `NT-19371` — user/account detail changes → `account/account_details`.
- `NT-15247`, `NTPJ-7918` — design changes → `website/website_design`.
- `NTPJ-6365`, `NT-19771` — site errors → `website/website_broken`.
- `NT-19756` — genuine campaign query → `email_marketing/email_campaign`.

**Summary card populated correctly (PASS):**
- `NT-11267` — LeadPro access issue → subject *"[Portal] Content update — Will unable to view leads in LP account…"*, full description retained.

**Borderline (not blocker-class):**
- `NTPJ-7021`, `NT-18828` — website-content / address changes routed to `email_marketing` because both reference the BYM/email footer (ambiguous; both attachment- or below-the-fold dependent).
- `NT-19300` — internal migration-runner log routed to `email_marketing` (atypical internal ticket).
- `NT-11271` — correct routing (`property/property_visibility`) but a **signature** Facebook URL was captured as the `url` field — a replay data-quality artifact from raw email bodies, not a portal routing fault.

---

## 9. Caveats & limitations

1. **First-turn / single-shot.** One opening message per ticket, one isolated session, no multi-turn follow-up and no LLM-repeat per ticket. This validates the routing decision and the summary card where reached; it does not exercise deep multi-turn collection or submission. (The Iteration 43 harness used repeats on a small targeted set; this run trades repeat-depth for population breadth, n=1,260.)
2. **Replay input = stored Jira description**, signature/quote-stripped heuristically. Some openers are forwarded/internal emails or contain signatures, which occasionally injects a signature URL (e.g. NT-11271) — an input artifact, not portal behaviour.
3. **Population realism.** ~33 BYM transactional-email system notifications passed the eligibility filter and inflate the `email_marketing` bucket slightly; they are genuine email-platform text, not routing regressions.
4. **16 attachment-dependent tickets** were flagged and excluded (cannot be faithfully replayed without the attachment).
5. **Identity:** replay used the portal `codex-test-login` test identity ("Codex Test Organisation"), giving fresh isolated sessions and avoiding real-customer side effects. No real tickets were submitted.

---

## 10. Artefacts

| File | Contents |
|---|---|
| `last90_nt_ntpj_portal_regression_replay_2026-05-29.md` | This report |
| `last90_nt_ntpj_portal_regression_replay_2026-05-29_raw.json` | Raw replay results (1,261 records) |
| `last90_population_2026-05-29.json` | Extracted population + eligibility classification |
| `last90_flags.json` | Blocker-family detector output + full flagged records |
| `_extract_last90_nt_ntpj.mjs` | Extraction script |
| `_replay_last90.mjs` | Replay harness |
| `_analyse_last90.mjs` | Failure-family analysis script |

---

## 11. Conclusion

A broad 90-day replay of **1,260 historical NT/NTPJ opening requests** through the freshly restarted portal shows **no material recurrence of any of the nine previously fixed Portal Phase3 blockers**. Summary cards populate 475/475 at summary stage, URLs capture cleanly across 238 hosts, responses are coherent and free of false-history language, and the feed/CRM/property families hold their own categories rather than collapsing into email marketing. Residual noise is limited to ~2 ambiguous website/email-footer edge cases and a few atypical internal-forward emails — none blocker-class.

### Verdict: ✅ `REGRESSION PROTECTED` — promote Iteration 43 from `Converged Pending Protection` to `Regression Protected`.
