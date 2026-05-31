# KPI Trends Parity Evaluation — 2026-05-31

**Work Package:** `KPX-WP7` — Trends parity surface delivery (full behavioural re-evaluation following `KPX-WP7A` activation qualified pass)
**Evaluator:** Independent Claude Code session — behavioural only, no source/diff/build-status inspection
**Runtime base:** `http://127.0.0.1:3001` (probed via the `127.0.0.1` literal; `localhost` on this box is a SPA catch-all returning 200 HTML for any path and would mask 404s)
**Auth path:** Short-lived admin JWT (25-min expiry) minted via the established, approved KPX local-eval auth path — signing secret read from the NOVA runtime settings store (`settings` table via `NOVA_SQL_CONNECTION`, `.env` `JWT_SECRET` fallback). No production credentials and no application source were used to derive signing material. Unauthenticated control (`GET /api/kpi/trends/NT` → **401 "Not authenticated"**) confirms the auth gate is intact.
**Raw captures:** `_wp7full_results.json` (canonical route, window sweep, validation, regression, isolation), `_wp7_allspaces.json` (all 8 spaces classification census).

---

## Verdict: **QUALIFIED PASS**

The clean-sheet Trends surface is reachable on the clean-sheet path only, is isolated from the legacy KPI system, and — most importantly — behaves **honestly**: it does not fabricate trend lines from insufficient data, and it classifies metrics into a clean, per-space, three-way state (`supported` / `awaiting` / `unsupported/not-wired`) with accurate, non-misleading notes.

It is **qualified, not unconditional**, for two reasons:

1. The headline positive behaviour — *supported metrics rendering real multi-day trends* — **could not be observed**, because no metric in any space has yet accumulated ≥2 frozen EOD days. This is environmental data scarcity (only one EOD freeze exists), not an observed defect or any sign of fabrication.
2. The **configurable history window is still inert and unvalidated** (carried forward unchanged from `KPX-WP7A`): every requested window returns `windowDays:30`, and invalid windows are silently accepted.

Neither qualification is a *material blocker* to the integrity of the surface as it stands, but both mean the phase has not yet demonstrated its full intended behavioural outcome.

---

## What observable behaviour was verified

### 1. Surface exists and loads from the clean-sheet path only — VERIFIED
The live canonical route is space-scoped: `GET /api/kpi/trends/:spaceKey`. It returns `200 {ok:true, data:{…}}` for all 8 valid Jira spaces (`COMMS, CS, KAM, NT, NTPJ, ONBOARD, STBY, YO`). The unscoped `GET /api/kpi/trends` is `404 "Cannot GET"`. The surface lives entirely under `/api/kpi/*`.

### 2. Honest treatment of insufficient history (awaiting) — VERIFIED (strong)
The integrity-critical behaviour is confirmed with a real example. `queue_total` on space NT has **exactly one frozen day** (`history:[{date:"2026-05-29", value:145}]`) and a live value of 145, yet it is **not** drawn as a trend:

```
queue_total → unwired:false, trendStatus:"awaiting", histLen:1, value:145,
note:"Only one frozen day so far — a multi-day trend appears after a second EOD freeze."
```

Wired metrics with zero frozen history behave identically and honestly:

```
frt_compliance → unwired:false, trendStatus:"awaiting", histLen:0, value:null,
note:"No frozen daily history yet — a trend appears once EOD freezes accumulate."
```

No fabricated line is drawn from a single data point or from no data. This is the central honesty requirement and it holds.

### 3. Honest classification of not-wired metrics — VERIFIED
Not-wired metrics are a distinct, explicitly-flagged third state — not ambiguously blank:

```
fcr_rate → unwired:true, trendStatus:"unsupported", histLen:0,
note:"No data source wired yet — no trend can be drawn (not fabricated)."
```

This classification is **per-space and meaningful**, not a hardcoded list: NT exposes 3 not-wired metrics (`fcr_rate`, `reopen_rate`, `bug_escalation_ack_hrs`), NTPJ exposes 2, and the other six spaces expose 0. Each space also exposes a different total metric set (COMMS 7, ONBOARD 5, KAM 12, STBY/YO 17, NTPJ 21, CS 20, NT 26), confirming the surface is wired to real per-space metric definitions.

### 4. Per-space classification census (all 8 spaces) — VERIFIED honest empty-state
| Space | status | hasData | supported | awaiting | not-wired | max history len |
| --- | --- | --- | --- | --- | --- | --- |
| COMMS | 200 | false | 0 | 7 | 0 | 0 |
| CS | 200 | false | 0 | 20 | 0 | 1 |
| KAM | 200 | false | 0 | 12 | 0 | 0 |
| NT | 200 | false | 0 | 23 | 3 | 1 |
| NTPJ | 200 | false | 0 | 19 | 2 | 0 |
| ONBOARD | 200 | false | 0 | 5 | 0 | 0 |
| STBY | 200 | false | 0 | 17 | 0 | 0 |
| YO | 200 | false | 0 | 17 | 0 | 0 |

Every space carries an honest top-level note: *"No multi-day clean-sheet history yet for this space — trends appear as EOD freezes accumulate (≥2 frozen days per metric)."* No space reports `supported` metrics, consistent with the fact that **no metric anywhere has ≥2 frozen days** (max observed history length is 1).

### 5. Honest space validation — VERIFIED
| Probe | Status | Body |
| --- | --- | --- |
| `…/trends/ZZZZNOTASPACE` | 404 | `{ok:false, error:"Unknown space"}` |
| `…/trends/SLT` (aggregate leaderboard, not a space) | 404 | `{ok:false, error:"Unknown space"}` |

Unknown/non-space keys are cleanly rejected — no silent 200, no 500.

### 6. Isolation from the legacy KPI system + non-regression — VERIFIED
| Route | Status |
| --- | --- |
| `GET /api/kpi-data/trends` | 404 (Cannot GET) |
| `GET /api/kpi-engine/trends` | 404 (Cannot GET) |
| `GET /api/kpi/spaces` | 200 / ok |
| `GET /api/kpi/qa-parity` | 200 / ok |
| `GET /api/kpi/escalations-parity` | 200 / ok |
| `GET /api/kpi/slt` | 200 / ok |

Legacy namespaces expose no Trends route; sibling clean-sheet surfaces remain healthy. Nothing regressed.

---

## Key questions — answers

1. **Exists and loads from clean-sheet path only?** — **YES.** Space-scoped `/api/kpi/trends/:spaceKey`, 200 for all 8 valid spaces, isolated under `/api/kpi/*`.
2. **Supported metrics render real multi-day trends (not thin placeholders)?** — **NOT OBSERVABLE.** No metric in any space has ≥2 frozen days, so the `supported` array is empty everywhere. The path is correctly *gated* on real data (≥2 frozen days); this is data scarcity (one EOD freeze so far), not a fabrication or a visible defect. Unverified, deferred to data accumulation.
3. **Wired-but-thin metrics appear honestly as awaiting (not fabricated)?** — **YES (strongly verified).** `queue_total` with one frozen day is `awaiting` with an explicit "after a second EOD freeze" note; zero-history wired metrics likewise. No fabrication.
4. **Not-wired metrics honestly classified (not ambiguously blank)?** — **YES.** Distinct `unwired:true` / `trendStatus:"unsupported"` state with an explicit "not fabricated" note, applied per-space (NT 3, NTPJ 2, others 0).
5. **Configurable 7/14/30/90 window works honestly?** — **NO (unchanged from WP7A).** Every window returns `windowDays:30`; invalid windows (`999/0/-5/abc`) are silently accepted as default. With zero multi-day data the window currently has no observable consumer, so this is a **bounded gap, not a material blocker today** — but it will become material the moment supported trends exist (a user asking for 7 days would silently receive 30).
6. **Isolated from legacy / free of regression?** — **YES.** Legacy trends routes 404; siblings 200/ok; auth gate 401.

---

## Material blocker

**None.** The surface is reachable, isolated, regression-free, and — within the data available — behaviourally honest. The one behaviour that cannot be confirmed (supported multi-day rendering) is blocked by environmental data accumulation, not by any observed defect.

## Bounded, non-blocking gaps

1. **Supported multi-day trend rendering is unobservable.** No metric in any of the 8 spaces has ≥2 frozen EOD days (max history length = 1). The `supported` path therefore cannot be exercised with real data. The honesty of the surrounding states gives reasonable confidence the gate is correct, but the positive rendering itself remains *unverified pending a second EOD freeze*. Not fixable by the evaluator and not a defect.
2. **Configurable window inert and unvalidated.** `windowDays` is always 30 regardless of `?window=`; garbage windows are silently swallowed rather than rejected. Low impact while there is no multi-day data to window over; should be closed before supported trends go live.

---

## Next best step

**One more bounded hardening/parity pass before final checkpoint — do not converge yet.**

The honest-classification core of this slice is solid and could be checkpointed on its own merits (no fabrication; awaiting and not-wired states are honest and per-space accurate; isolation and non-regression hold). However, two of the six intended behaviours are not yet demonstrably met, so the phase has not fully reached its intended outcome:

- **Fix the window parameter** so `?window=7/14/30/90` is honoured and echoed, and invalid windows are rejected honestly rather than silently defaulted. This is the only repeatable build-side defect on the surface and is a small, well-scoped fix.
- **Confirm the supported path on a second EOD freeze.** Once any metric accumulates ≥2 frozen days, re-run this evaluation to verify that the metric moves `awaiting → supported`, renders a real multi-day `history` series with a populated `stats` object, and is not a thin placeholder. This is operational (data accumulation), not a build task.

Recommend the manager fix the window parameter now and re-request a short confirmation evaluation once a second EOD freeze exists; at that point the Trends parity slice can be converged and checkpointed.
