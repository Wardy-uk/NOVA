# KPI Trends Parity — Window Hardening Evaluation — 2026-05-31

**Work Package:** `KPX-WP7B` — Trends window-parameter hardening (follow-up to the `KPX-WP7` qualified pass, which carried the inert/unvalidated window as the one repeatable build-side defect)
**Evaluator:** Independent Claude Code session — behavioural only, no source/diff/build-status inspection
**Runtime base:** `http://127.0.0.1:3001` (probed via the `127.0.0.1` literal; `localhost` on this box is a SPA catch-all returning 200 HTML for any path and would mask 404s)
**Auth path:** Short-lived admin JWT (25-min expiry) minted via the established, approved KPX local-eval auth path — signing secret read from the NOVA runtime settings store (`settings` table via `NOVA_SQL_CONNECTION`, `.env` `JWT_SECRET` fallback). No production credentials and no application source were used to derive signing material. Unauthenticated control (`GET /api/kpi/trends/NT` with no token → **401 "Not authenticated"**) confirms the auth gate is intact.
**Raw captures:** `_wp7b_results.json` (window sweep, days alias, invalid/out-of-range, per-window classification, all-8-space census, space validation, legacy isolation, sibling non-regression).

---

## Verdict: **PASS** (with one bounded, environmental non-blocking gap)

The single repeatable build-side defect carried forward from `KPX-WP7`/`WP7A` — the `window` parameter being **inert** (`windowDays` always 30) and invalid windows **silently absorbed** — is now **fixed and behaves honestly**. The Trends route honours canonical window values, echoes the value it actually applied, clamps out-of-range input to a sane bound while telling the truth about the clamp, exposes a consistent legacy `days` alias, and preserves the awaiting-history and not-wired classifications unchanged across every window. Legacy isolation and clean-sheet sibling non-regression still hold.

It is a **PASS rather than a qualified pass** because every item inside this work package's stated evaluate-only scope was directly observed and verified. The one Trends behaviour that still cannot be exercised — the window's *filtering effect on a real multi-day history series* — is the same environmental data-scarcity gap already logged in `KPX-WP7` (only one EOD freeze exists; no metric has ≥2 frozen days), is operational rather than a build defect, and lies outside the window-hardening scope. It is recorded below as a bounded non-blocking gap, not a blocker.

---

## What observable behaviour was verified

### 1. Canonical `window` values are now honoured and echoed — VERIFIED (this is the fix)
On a valid space (NT), `windowDays` now reflects the requested value rather than a fixed 30:

| Request | Status | `windowDays` echoed |
| --- | --- | --- |
| `…/trends/NT?window=7` | 200 | **7** |
| `…/trends/NT?window=14` | 200 | **14** |
| `…/trends/NT?window=30` | 200 | **30** |
| `…/trends/NT?window=90` | 200 | **90** |
| `…/trends/NT?window=60` | 200 | **60** |
| `…/trends/NT` (no window) | 200 | 30 (honest default) |

This is the direct reversal of the `WP7A`/`WP7` observation where every window returned `windowDays:30`. The parameter is live, applied, and echoed.

### 2. Honest clamping / defaulting of invalid and out-of-range values — VERIFIED
The route does not reject with a 400; it **clamps to a `[2, 90]` range** and **echoes the value it actually applied**, so the response never claims to honour a window it did not use:

| Request | Status | `windowDays` returned | Interpretation |
| --- | --- | --- | --- |
| `window=999` | 200 | **90** | clamped to max — echoed honestly |
| `window=3650` | 200 | **90** | clamped to max |
| `window=0` | 200 | **2** | clamped to min (a trend needs ≥2 days) |
| `window=-5` | 200 | **2** | clamped to min |
| `window=1` | 200 | **2** | clamped to min |
| `window=2` | 200 | **2** | min boundary honoured exactly |
| `window=7.5` | 200 | **7** | floored to integer |
| `window=abc` | 200 | **30** | non-numeric → honest default |
| `window=` (empty) | 200 | **30** | empty → honest default |

This is the integrity-critical improvement over `WP7A`: previously garbage input was silently treated as 30 with the response telling the user nothing. Now `windowDays` always reports the value genuinely applied (e.g. `999` → `90`, not `90`-disguised-as-`999`). The behaviour is predictable, bounded, and self-describing. Clamping (not 400-rejection) is the chosen contract, and it is honest because the echoed window is the truth.

### 3. Legacy `days` alias present and consistent — VERIFIED
A legacy `days` alias exists and carries identical semantics to `window`:

| Request | Status | `windowDays` |
| --- | --- | --- |
| `…/trends/NT?days=7` | 200 | 7 |
| `…/trends/NT?days=14` | 200 | 14 |
| `…/trends/NT?days=90` | 200 | 90 |
| `…/trends/NT?window=7&days=90` | 200 | **7** (canonical `window` wins) |

The alias resolves consistently, and when both parameters are supplied the canonical `window` takes precedence — predictable, no ambiguity, no error.

### 4. Awaiting-history and not-wired classifications preserved across windows — VERIFIED
Changing the window does not reclassify, fabricate, or drop metrics. The NT classification census is **identical at every window** (`window=7` and `window=90` shown; all of 7/14/30/60/90/1 match):

```
NT  window=7  → awaiting:23, unsupported(not-wired):3, supported:0, maxHistLen:1
NT  window=90 → awaiting:23, unsupported(not-wired):3, supported:0, maxHistLen:1
```

The honest per-metric notes are unchanged — wired-but-thin metrics still read *"No frozen daily history yet — a trend appears once EOD freezes accumulate"* / *"Only one frozen day so far…"*, and not-wired metrics still read *"No data source wired yet — no trend can be drawn (not fabricated)."* No fabrication is introduced by windowing.

### 5. All-8-space census at a non-default window matches the WP7 baseline — VERIFIED (no regression)
At `window=14`, the per-space classification census is identical to the `KPX-WP7` baseline census, confirming windowing did not perturb classification on any space:

| Space | status | windowDays | hasData | awaiting | not-wired | maxHist |
| --- | --- | --- | --- | --- | --- | --- |
| COMMS | 200 | 14 | false | 7 | 0 | 0 |
| CS | 200 | 14 | false | 20 | 0 | 1 |
| KAM | 200 | 14 | false | 12 | 0 | 0 |
| NT | 200 | 14 | false | 23 | 3 | 1 |
| NTPJ | 200 | 14 | false | 19 | 2 | 0 |
| ONBOARD | 200 | 14 | false | 5 | 0 | 0 |
| STBY | 200 | 14 | false | 17 | 0 | 0 |
| YO | 200 | 14 | false | 17 | 0 | 0 |

Every space carries the same honest top-level note as before (*"No multi-day clean-sheet history yet for this space — trends appear as EOD freezes accumulate (≥2 frozen days per metric)."*).

### 6. Space validation is not bypassed by the window parameter — VERIFIED
| Probe | Status | Body |
| --- | --- | --- |
| `…/trends/ZZZZNOTASPACE?window=7` | 404 | `{ok:false, error:"Unknown space"}` |
| `…/trends/SLT?window=14` | 404 | `{ok:false, error:"Unknown space"}` (aggregate leaderboard, not a space) |
| `…/trends/NT?window=7` | 200 | `{ok:true, data:{…}}` |

Adding a window does not let an unknown space slip through — validation order is preserved.

### 7. Legacy isolation and clean-sheet sibling non-regression — VERIFIED
| Route | Status |
| --- | --- |
| `GET /api/kpi-data/trends` | 404 (no such route) |
| `GET /api/kpi-engine/trends` | 404 (no such route) |
| `GET /api/kpi-data/trends?window=7` | 404 (no such route) |
| `GET /api/kpi/trends` (unscoped) | 404 |
| `GET /api/kpi/spaces` | 200 / ok |
| `GET /api/kpi/slt` | 200 / ok |
| `GET /api/kpi/qa-parity` | 200 / ok |
| `GET /api/kpi/escalations-parity` | 200 / ok |

Legacy KPI namespaces still expose no Trends route (the window param does not summon one); the unscoped form is still 404; all clean-sheet siblings remain 200/ok. The window-hardening change regressed nothing.

---

## Key questions — answers

1. **Does Trends honour canonical `window` values honestly?** — **YES.** 7/14/30/90 (and in-range 60) are applied and echoed in `windowDays`; no-window defaults honestly to 30. This is a clean reversal of the prior inert behaviour.
2. **If a legacy `days` alias exists, does it behave consistently?** — **YES.** `days=7/14/90` resolve identically to `window`; when both are present, canonical `window` wins. Predictable precedence, no error.
3. **Are invalid / out-of-range values handled honestly and predictably?** — **YES.** Clamped to `[2,90]` (`999`/`3650`→90, `0`/`-5`/`1`→2), fractional floored (`7.5`→7), non-numeric/empty → default 30. Critically, `windowDays` echoes the value actually applied, so the response never misrepresents the window used.
4. **Are awaiting-history and not-wired classifications preserved?** — **YES.** Census is identical across every window and matches the `WP7` baseline on all 8 spaces; per-metric honest notes unchanged; no fabrication introduced.
5. **Does legacy isolation and sibling non-regression still hold?** — **YES.** Legacy `/api/kpi-data/*` and `/api/kpi-engine/*` expose no Trends route (with or without `window`); unscoped form 404; all siblings 200/ok; auth gate 401.
6. **Next best step — checkpoint Trends parity now, or wait for a second EOD freeze?** — **Checkpoint the window-hardening slice now.** See below.

---

## Material blocker

**None.** Every behaviour in the `KPX-WP7B` evaluate-only scope was observed and verified. The auth gate, space validation, isolation, and sibling surfaces are all intact.

## Bounded, non-blocking gap

**The window's filtering effect on a populated multi-day series remains unobservable.** The window value is now correctly plumbed, clamped, and echoed at the contract level, but with `maxHist = 1` everywhere (only one EOD freeze exists; no metric in any space has ≥2 frozen days), the history arrays are unchanged between `window=7` and `window=90`. I can therefore confirm the parameter is *honoured and honestly reported*, but I cannot yet confirm it *correctly truncates/selects a longer real series*. This is the same environmental data-scarcity gap logged in `KPX-WP7` — operational (a second EOD freeze must accumulate), not a build defect, and outside the window-hardening scope. Low impact while there is no multi-day data to window over.

---

## Next best step

**Checkpoint the Trends window-parity slice now — the hardening work package is complete and honest.**

The one repeatable build-side defect that held `KPX-WP7` to a qualified pass is now closed: the `window` parameter is live, canonical values are honoured, out-of-range input is honestly clamped and self-described, the legacy `days` alias is consistent, classifications are preserved, and isolation/non-regression hold. There is no remaining build action on the window contract.

A **second, short confirmation evaluation should still follow a second EOD freeze** — but only to verify the *remaining environmental behaviour*: that a metric with ≥2 frozen days moves `awaiting → supported`, renders a real multi-day `history`/`stats` series, and that `window=7` vs `window=90` correctly bound that series. That is an operational data-accumulation step, not a gate on checkpointing the window hardening itself.

Recommendation to the manager: **converge and checkpoint `KPX-WP7B` window hardening now**, and re-request a brief supported-path confirmation once a second EOD freeze exists to close the carried-over environmental gap and finalise full Trends parity.
