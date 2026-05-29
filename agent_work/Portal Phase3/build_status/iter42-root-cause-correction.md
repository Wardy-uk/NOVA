# Iteration 42 — Root-Cause Correction Slice

**Date:** 2026-05-29
**Scope:** Close the live defects that survived iter41. Root-cause fixes only — no new heuristic keyword branches.

## META FINDING (explains why iter41 "failed")

The running dev server was **stale**. It was started as `tsx src/server/index.ts` (no `watch`)
on 28 May 12:09 — *before* iter40 (28 May 20:52) and iter41 (29 May 08:24) were written.
With no watcher it never hot-reloaded, so the independent evaluation was testing code that
did **not** contain the iter40/iter41 fixes at all.

- Verified by reproducing every blocker against the stale process, then restarting with the
  correct `npm run dev:server` (`tsx watch`) and reproducing again.
- Against fresh code, the email-marketing and property-specificity fixes from iter41 already
  **pass**. They never failed on their merits — they were simply not loaded.

Restarted the server with `tsx watch` so it now reflects current source.

## Root causes found & fixed

### A. `stripVerbatimEcho` corrupts URLs and guts intentional echoes — fixes Defect #1 (domain) AND #5 (garble)

A single shared sanitiser (`sanitizeCustomerResponse` → `stripVerbatimEcho`, run on the final
response at the end of `sendMessage`) caused two of the listed blockers:

1. **Domain truncation.** It split the user message into "sentences" on every `.`/`!`/`?`,
   which splits a URL on its internal dots. `www.smithandjonesproperty.co.uk` became the
   fragments `www.`, `smithandjonesproperty.`, `co.`, `uk …`. It then deleted each fragment
   (≥12 chars) from anywhere in the response — including from *inside the real domain* — leaving
   `www.co.uk`. This ran **after** iter41's `repairTruncatedDomains`, which is why that fix
   could never help; the metadata kept the full domain while the displayed text was corrupted.

2. **Garbled "I can see — " fragments.** The deterministic follow-up builders deliberately echo
   the customer's words ("I can see {your issue} — which property is affected?"). The sanitiser
   then deleted that echoed sentence as a "verbatim parrot", leaving dangling connectives:
   `I can see  — which property…`, `I'll help you get that set up — .`

**Fix (`stripVerbatimEcho` rewritten):**
- Mask emails **and** URLs with placeholders before splitting/matching, then unmask — a domain
  is never fragmented on its dots.
- Boundary-anchored stripping: only remove an echoed user sentence when it stands as its **own**
  sentence (start of text or directly after `. ! ?`). Echoes embedded mid-assistant-sentence
  (the builders' intentional "I can see {context} —") are preserved. Genuine standalone LLM
  parroting is still stripped; "You mentioned …" prefixes are still handled by `TONE_SANITIZATIONS`.
- Net effect: strips strictly *less*, never more.

### B. Strict optional enums discard valid LLM classifications — the deep plumbing defect

`ConversationalIntakeSchema` declared `websiteSubcategory` / `propertySubcategory` /
`accountSubcategory` / `urgency` as strict optional `z.enum`. The model frequently returns an
**empty string** `""` for a "not applicable" enum. Zod rejected `""` (`invalid_enum_value`),
which failed the **entire** parse, so `llm.call` reported *"All LLM providers failed: Validation
failed"* and `handleIntentWithLlm` fell into the degraded **no-LLM fallback** path
(`handleIntentWithoutLlm`).

This was a hidden, intermittent driver of *several* symptoms at once: misrouting, the garbled
fallback templates, the false "you've been in touch before" claim (the fallback has its own
chase block), and weak/blank summaries — all because a perfectly good classification was being
thrown away.

**Fix:** added an `optionalEnum()` helper using `z.preprocess` that coerces `""` / any
non-matching value to `undefined` before enum validation, and applied it to every optional enum
in `ConversationalIntakeSchema` and `FieldExtractSchema`. The LLM service uses `safeParse` (no
JSON-schema generation), so `z.preprocess` is fully compatible. Server log confirms **zero**
validation failures after the change.

### C. Chase detection claims prior contact with no evidence — fixes Defect #4

`ESCALATION_CHASE_PATTERNS` includes `is not (fixed|resolved|sorted|done|working)` and
`happen(ed|ing|s) again`, which match ordinary first-time reports ("my website is not working",
"it keeps happening again"). On a fresh session with no ticket reference the chase block still
emitted *"I can see you've been in touch about this before."*

**Fix:** added `EXPLICIT_PRIOR_CONTACT_PATTERNS` (the genuine subset: "raised this", "chasing",
"following up", "weeks ago", "still waiting", "originally raised", etc.). Both the LLM-path and
no-LLM-path chase blocks now require a ticket reference **or** explicit prior-contact language;
otherwise the message falls through to normal routing. Genuine chases ("I raised this last week
and chasing it up") are still acknowledged.

### D. Redundant context echo in builders — supports #5

Removed the now-redundant "I can see {context} —" echo from the three question builders
(`buildPropertyFollowUp`, `buildAccountFollowUp`, `buildFeedFollowUp`) and the
"— {context}" appendage from `buildAccountAcknowledgement`. The acknowledgement already conveys
understanding; the question carries the specifics. This removes the duplicated/awkward
first-person echo (e.g. "set up — i need to set up a new user…") seen in account-setup flows.
Removed the now-dead `briefContext` helper.

## Verification (live, against fresh server)

| Blocker | Result |
|---|---|
| #1 full domain preserved in all surfaced paths | PASS (`www.smithandjonesproperty.co.uk` intact in description + URL line) |
| #2 BYM password / account-create / new-user / login stay out of email marketing | PASS (all 4) |
| #3 property missing / wrong-status / listing-count / visibility get property follow-up | PASS (no generic website prompt) |
| #4 fresh session does not claim prior contact | PASS ("site is not working", "login page is not working") |
| #5 no garbled / duplicated / broken concatenation | PASS (no "I can see —" / "set up — ." anywhere) |
| #6 subject + description never blank when input exists | PASS (all summary cards populated) |
| genuine email marketing still routes to email team | PASS ("campaign didn't send to my mailing list") |
| website content amendment | PASS |
| feed / integration | PASS ("Rightmove feed stopped syncing" → technical team) |
| blank-input protection | PASS (whitespace-only handled, no crash) |
| genuine prior-contact chase still acknowledged | PASS ("I raised this last week and chasing it up") |

TypeScript: `tsc -p tsconfig.server.json --noEmit` passes with **zero** errors.

## Uncertain / residual risk

- `stripVerbatimEcho` now strips less. A rare standalone verbatim parrot that is *not* prefixed
  by "You mentioned…" could survive, but it would read as natural language, not a jarring echo.
- The LLM validation failure was reproduced **in this environment**; if the independent eval
  environment's LLM was healthy, it would have hit the LLM-path chase block (B did not apply
  there) — the chase evidence-gate (C) covers both paths regardless.
- Minor, pre-existing, not a blocker: a website content request that names the page ("contact
  page") may still get "Which page is this on?" from the deterministic vague-website fallback.
- `optionalEnum` uses a `const` type parameter + a type-only cast into `z.enum`; runtime behaviour
  is confirmed by live tests (classifications now parse) and the typecheck is clean.

## Readiness

Ready for independent evaluation. Run the eval against a **freshly started** server
(`npm run dev:server`) — confirm the process is `tsx watch`, not a stale `tsx` invocation.
No convergence claimed; this slice closes the live defects only.
