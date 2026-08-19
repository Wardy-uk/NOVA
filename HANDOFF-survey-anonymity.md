# Handoff — survey anonymity is claimed but not delivered

**Status:** not started. Raised 19 Aug 2026.
**Scope:** `src/server/routes/surveys.ts`, `src/server/db/schema.ts`, and the survey admin UI.
**Urgency:** blocking. A monthly team sentiment survey and CSM/KAM satisfaction
surveys are about to be sent using this mechanism. Do not send them until this
is fixed or the wording is corrected.

---

## The problem, in one sentence

The survey invitation email tells recipients their responses are **"completely
anonymous"**, and the data model does not support that claim — a single SQL join
re-identifies every response and every free-text comment.

## Evidence

Line numbers were gathered by a code survey and should be re-verified rather
than trusted; the file is ~878 lines and moves.

- `survey_recipients` holds `token` (UNIQUE, `crypto.randomUUID()`) **in the same
  row as `email` and `display_name`** — `src/server/db/schema.ts`, survey tables
  around 3341–3406.
- `survey_responses` holds `token` (UNIQUE) as its link back to the invitation.
- **The two token values are identical.** Therefore:

  ```sql
  SELECT r.email, resp.answers
    FROM survey_responses resp
    JOIN survey_recipients r ON r.token = resp.token;
  ```

  returns every answer against the person who gave it, including open text.

- The anonymity promise is made in the invite and reminder email bodies
  (`surveys.ts` ~126 and ~144).
- Anonymity is currently enforced **only at the API layer**: admin detail returns
  aggregates, open-text answers are Fisher-Yates shuffled (~235–238), CSV export
  shuffles rows (~664–667), and the recipient list is returned without tokens
  (~399). None of that constrains anyone with database access.
- `survey_recipients.completed_at` and `survey_responses.submitted_at` correlate
  closely, so timing alone narrows identity even without the token.
- There is **no minimum-response gate**. A three-person team's "aggregate" is not
  anonymous regardless of what the schema does.

## What must NOT be broken

`GET /api/surveys/:id` for a **non-admin** deliberately replays that user's own
answers back to them via their token (~419). That linkage is a designed feature,
not an oversight. Any fix that simply nulls the token removes it — decide
consciously whether to keep it, and say which you chose in the commit.

Also do not disturb:
- The scheduler (`runSurveyScheduler`, ~794; registered in `index.ts` ~5252) which
  auto-activates, reminds, closes and spawns recurring child surveys.
- The public unauthenticated respond path `/api/survey/:token` (`index.ts` ~696).
- `GET /api/surveys/satisfaction-scores` (~332) and the Trends metrics
  `survey_team_sat` / `survey_kam_sat` / `survey_csm_sat` (`routes/trends.ts`
  ~227–230, computed ~707–732), which read from these tables.

## Suggested fix

Three parts. The first is the actual fix; the other two are what make the claim
survive scrutiny.

**1. Break the join.**
Preferred: on submit, write the response with a **one-way hash** of the token
(e.g. HMAC with a server-side secret) instead of the raw token, and null
`survey_recipients.token` once `completed = 1`. Self-replay can still work — hash
the presented token and look it up — while an attacker with only the database
has no reversible link, because the recipient's raw token no longer exists.

Simpler alternative if self-replay is expendable: null both tokens on submit and
drop the replay feature. Fewer moving parts, one less thing to get subtly wrong.

Either way, also coarsen the timing correlation: store `submitted_at` to the day,
or stop writing `completed_at` on the recipient row.

**2. Add a minimum-N gate.**
Below a threshold (5 is a defensible default), return no aggregate and no open
text — just "not enough responses to report anonymously". Applies to the admin
detail endpoint, the CSV export, `satisfaction-scores` and the Trends feed.

**3. Make the wording true.**
Whatever level of anonymity ends up being delivered, the invite and reminder text
must describe exactly that. If responses are pseudonymous rather than anonymous,
say so. Overpromising here is worse than a weaker promise honestly stated,
because the survey's entire value depends on people believing it.

## Also worth knowing (not blocking)

- `GET /api/surveys/satisfaction-scores` and Trends both read **only the most
  recent survey per category**. Monthly recurrence will therefore produce a
  series that nothing can currently plot. If monthly team sentiment is going to
  be tracked over time, that query needs a period dimension.
- Question types are limited to `scale_5` and `open_text`. No NPS, no multiple
  choice, no matrix.
- There is **no CSM/KAM roster** anywhere in the codebase — "Key Accounts" and
  "Customer Success" exist only as ticket cohorts derived from Jira labels on
  organisations, which label customers rather than people. Recipients for those
  two surveys must be added as NOVA users in a team, or hand-entered as
  `{display_name, email}`.

## Testing

- Submit a response as a recipient, then confirm the join above returns nothing.
- Confirm self-replay still behaves as intended (or is deliberately gone).
- Confirm a survey with fewer than the threshold returns no aggregate.
- Confirm the scheduler still activates, reminds and closes — it is the piece
  most likely to be broken by accident.
- Existing rows: decide whether to migrate historical responses. Leaving old
  identifiable data in place while promising anonymity going forward is a
  half-fix; either purge the old tokens or be explicit that the promise starts
  from a date.

## Deploying NOVA — two traps that have already cost time

1. **`deploy.ps1` pulls from `azdo`, not `origin`.** Pushing to GitHub alone
   leaves the deploy pulling nothing and reporting "Already up to date". Push to
   both, or push to `azdo` before deploying.
2. **A stale `dist` deploys silently.** `deploy.ps1` now verifies both build
   outputs are freshly written, but if `npm run build` is run by hand first,
   check it actually succeeded — `vite` is pruned from `node_modules` after each
   deploy, so a manual build will fail with "vite is not recognized" and that is
   expected, not a fault.

Deploy is `.\deploy\deploy.ps1 -Branch nova-codex`, run **on** BYM-AAPP01,
elevated.
