# Behavioural Contract Enforcement Review

**Date:** 2026-05-19
**Author:** Manager Agent
**Trigger:** Human + Orchestrator review — observed pattern of path-dependent protected behaviour survival
**Scope:** Behavioural contract enforcement across all response execution paths

---

## Review Decision

**The current consistency layer is necessary but not sufficient.**

The 2026-05-19 consistency hardening (vocabulary firewall, template enrichment, context-aware follow-ups) closed the most dangerous structural gaps. However, the enforcement model remains **layered rather than contractual** — it stacks defences rather than requiring proof of compliance before a response exits.

A protected behaviour is not truly protected if it can only be verified after the fact by an evaluator. It must be structurally enforced at the point of response emission.

The current system does not need a platform redesign. It needs a **shared post-processing contract** applied at the single response exit point (portal-chat.ts line 647) that enforces behavioural guarantees regardless of which upstream path produced the response.

---

## Evidence of Path-Dependent Behaviour

The system has two primary response generation paths:

| Aspect | LLM Path (`handleIntentWithLlm`) | Template/Fallback Path (`handleIntentWithoutLlm`) |
|--------|----------------------------------|---------------------------------------------------|
| **Acknowledgement source** | LLM-generated — instructed to mirror customer voice, include phone numbers, addresses, names verbatim | `buildTemplateAcknowledgement()` — constructed from collected field values |
| **Detail inclusion** | LLM prompt mandates inclusion of phones, addresses, names, error messages, reference numbers | Template interpolates available fields; phone numbers added via regex extraction post-consistency-layer |
| **Follow-up question** | LLM contextual (`nextQuestion` field) or template fallback | Static template via `buildConversationalQuestion()` / `buildPropertyFollowUp()` / `buildAccountFollowUp()` |
| **Customer-voice mirroring** | LLM instructed to use customer's exact words | Templates construct from field values — no voice mirroring |
| **Vocabulary shielding** | Dual: LLM prompt firewall (first line) + runtime `sanitizeCustomerResponse()` (second line) | Single: runtime `sanitizeCustomerResponse()` only (safe because templates don't introduce jargon, but the defence is shallower) |
| **Confidence-driven routing** | Graded thresholds (0.4, 0.6) with distinct conversational responses | Binary: keyword detected → route immediately |
| **Multi-issue handling** | LLM prompted to capture all issues in description | Single-category focus; second issue may not be acknowledged |
| **Disambiguation** | LLM can ask contextual clarifying question | No disambiguation — routes to first keyword match |

**Critical observation:** The LLM path has 6 behavioural advantages that the template path partially or fully lacks. The consistency layer closed the 3 most dangerous (vocabulary shielding, phone preservation, context survival) but 3 remain:

1. **Customer-voice mirroring** — LLM mirrors exact words; templates construct from field values
2. **Multi-issue acknowledgement** — LLM acknowledges all issues; templates acknowledge the routed category only
3. **Disambiguation quality** — LLM asks symptom-based questions; templates route on first keyword match

---

## Behaviours Currently Protected Globally

These behaviours survive regardless of execution path:

| # | Behaviour | Enforcement Mechanism | Confidence |
|---|-----------|----------------------|------------|
| 1 | **Vocabulary shielding** | `sanitizeCustomerResponse()` at line 647 — runtime, path-independent, 37+ regex patterns | HIGH — structural, not probabilistic |
| 2 | **Opening message preservation** | `meta.openingMessage = content` at intake entry; never overwritten by either path | HIGH — structural |
| 3 | **Raw description accumulation** | Multi-turn: `description += '\n' + content`; both paths append, neither replaces | HIGH — structural |
| 4 | **Security-sensitive fast-track** | `SECURITY_SENSITIVE_PATTERNS` pre-empts both LLM and template paths before they diverge | HIGH — structural |
| 5 | **Frustration detection** | `FRUSTRATION_PATTERNS` fires before path divergence; empathy builder shared | HIGH — structural |
| 6 | **Escalation/chase detection** | `ESCALATION_CHASE_PATTERNS` fires in both paths with identical responses | HIGH — structural |
| 7 | **No category picker for protected domains** | Keyword/LLM detection routes to conversational intake before picker is reached | HIGH — structural |
| 8 | **Hidden taxonomy** | No internal category names in any template string; sanitizer catches leaks | HIGH — structural + safety net |
| 9 | **Bounded disambiguation limit** | One-question limit enforced structurally in disambiguation logic | HIGH — structural |
| 10 | **Summary card field preservation** | `buildSummaryCard()` is shared; all fields reach the ticket regardless of path | HIGH — structural |

---

## Behaviours Still Path-Dependent

These behaviours are NOT equally enforced across all paths:

| # | Behaviour | LLM Path | Template Path | Gap Severity |
|---|-----------|----------|---------------|-------------|
| A | **Customer-voice mirroring in acknowledgement** | LLM mirrors exact customer words ("she can't see anything") | Template constructs from field values ("Thanks for those details about Sarah") | MEDIUM — operational detail preserved, but customer doesn't hear their own words back |
| B | **Phone number inclusion in acknowledgement** | LLM MUST-include rules (prompt-enforced) | `extractPhoneNumbers()` regex from description (consistency-layer fix) | LOW — both paths now surface phone numbers, but LLM path is more natural |
| C | **Multi-issue acknowledgement** | LLM prompted to acknowledge ALL issues raised | Template acknowledges the routed category only | MEDIUM — second issue survives in description/transcript but isn't acknowledged conversationally |
| D | **Contextual follow-up questions** | LLM generates questions that reference what the customer said | Template uses `withContext()` prefix ("You mentioned...") but question body is static | LOW — consistency layer partially closed this gap |
| E | **Disambiguation quality** | LLM can ask symptom-based clarifying questions naturally | Template path routes on first keyword match — no disambiguation step | LOW — template path is more conservative (routes immediately), which is operationally safe if occasionally less smooth |
| F | **Address/name verbatim inclusion in acknowledgement** | LLM instructed to include exact address, exact name | Template includes name from `affectedPersonName` field, address from `propertyAddress` field — verbatim if extracted correctly | LOW — both paths include the data, but LLM includes it more naturally |

---

## Protected Behaviour Risk Assessment

| Risk Level | Behaviours | Assessment |
|------------|-----------|------------|
| **NO RISK** | Vocabulary shielding, opening message preservation, raw description accumulation, security fast-track, frustration detection, escalation handling, category picker suppression, hidden taxonomy, bounded disambiguation, summary card preservation | These are enforced structurally. A regression here would require deliberate code change. |
| **LOW RISK** | Phone number preservation (B), contextual follow-ups (D), disambiguation quality (E), verbatim detail inclusion (F) | The consistency layer closed the dangerous gaps. Remaining differences are quality/naturalness, not correctness. Both paths produce operationally sound output. |
| **MEDIUM RISK** | Customer-voice mirroring (A), multi-issue acknowledgement (C) | These affect customer experience quality. The customer's second issue or exact phrasing may not be reflected in the template path's acknowledgement, even though the data is preserved in the ticket. |
| **NOT A RISK** | Any behaviour that fires before path divergence (security-sensitive, frustration, escalation) or after path convergence (summary card, ticket creation) | These are inherently path-independent by architecture. |

---

## Required Behavioural Guarantees

Every customer-facing response — regardless of which path produced it — must satisfy:

| # | Guarantee | Current Status | Enforcement |
|---|-----------|---------------|-------------|
| G1 | **No internal vocabulary leaks** | ENFORCED | `sanitizeCustomerResponse()` at response exit point |
| G2 | **Operational details mentioned by the customer appear in the acknowledgement** | PARTIALLY ENFORCED | Template builders now interpolate fields + phone extraction; but multi-issue and customer-voice gaps remain |
| G3 | **No category picker for protected domains** | ENFORCED | Detection logic pre-empts picker |
| G4 | **Frustration/escalation is acknowledged, not processed** | ENFORCED | Pattern detection fires before path divergence |
| G5 | **Raw customer input is the canonical record** | ENFORCED | Never overwritten; LLM enrichment appended, not replaced |
| G6 | **Security-sensitive requests are fast-tracked** | ENFORCED | Pre-empts both paths |
| G7 | **Follow-up questions reference what the customer already said** | PARTIALLY ENFORCED | `withContext()` helper; but some static templates still lack context |
| G8 | **Multi-issue requests acknowledge all issues** | NOT ENFORCED in template path | LLM-only; template path routes to first keyword match |
| G9 | **Acknowledgement includes customer's exact phrasing where operationally relevant** | NOT ENFORCED in template path | LLM-only; templates construct from extracted fields |

---

## Candidate Enforcement Points

The system has a natural architectural chokepoint: **portal-chat.ts line 647** — the single exit point where `sanitizeCustomerResponse()` is already applied to all responses.

| Enforcement Point | What It Could Enforce | Feasibility |
|-------------------|----------------------|-------------|
| **Response exit point (line 647)** | Vocabulary shielding (already done), detail-presence assertion, structural response validation | HIGH — already proven with sanitizer; adding checks is incremental |
| **Acknowledgement builders (shared)** | Customer-voice fragments, multi-issue awareness | MEDIUM — would require passing the raw opening message to all acknowledgement builders consistently |
| **LLM prompt** | Customer-voice mirroring, detail inclusion, vocabulary | Already done, but probabilistic — the LLM can still violate instructions |
| **Post-acknowledgement validator** | Assert that key details (names, phones, addresses from collected fields) appear in the acknowledgement text | HIGH — purely additive; runs after acknowledgement is built, before response exits |
| **Shared acknowledgement contract function** | Single function that takes `(meta, rawAcknowledgement)` and ensures minimum detail inclusion | HIGH — replaces ad-hoc enrichment in each builder with a single enforcer |

---

## Minimum Viable Behavioural Contract Layer

The minimum viable change is NOT a new architectural layer. It is a **shared post-processing enforcement function** at the existing chokepoint (line 647) that verifies and repairs responses before they reach the customer.

### Proposed: `enforceResponseContract(responseContent, meta)`

Applied immediately after `sanitizeCustomerResponse()` at the response exit point. This function:

1. **Detail-presence assertion** — if `meta.collectedFields` contains a phone number, person name, property address, or account name, and the response is an acknowledgement (first response or post-disambiguation response), assert that at least one of these details appears in the response text. If not, append a brief detail reference.

2. **Multi-issue awareness** — if the opening message contains conjunctions indicating multiple issues ("and", "also", "as well as", "plus") and the response acknowledgement references only one concern, append a brief "I've noted both issues" clause.

3. **Customer-voice fragment injection** — extract the first actionable clause from `meta.openingMessage` and, if the response acknowledgement doesn't contain any substring of the customer's words (beyond 4+ word overlap), inject a brief contextual reference.

### What this does NOT do:

- Does not replace the LLM path or template path
- Does not add an LLM call to the template path
- Does not change the intake flow, disambiguation model, or routing logic
- Does not modify the summary card, ticket creation, or field extraction
- Does not require schema, route, frontend, or type changes
- Does not change evaluator logic or holdout scenarios

### Estimated scope:

- ~40-60 lines added to `portal-chat.ts`
- Applied at the existing chokepoint alongside `sanitizeCustomerResponse()`
- Testable via existing evaluator infrastructure

---

## Risks of Continued Local Patching

| Risk | Likelihood | Impact |
|------|-----------|--------|
| **Evaluator convergence illusion** — each patch improves the tested path but the untested path drifts | HIGH | Evaluator reports convergence; real customer experience on fallback path is lower quality. Protected behaviours appear met when they are only met on one path. |
| **Patch accumulation debt** — each domain expansion adds domain-specific template enrichments rather than shared enforcement | MEDIUM | Template builders grow with each domain; each requires separate verification. By domain 5-6, the builders are individually complex and collectively untestable. |
| **Regression surface expansion** — each new template enrichment is a new regression vector that evaluators must cover | MEDIUM | Evaluator scope grows linearly with patches. Holdout suites must test both paths for every behaviour, doubling evaluation cost. |
| **False regression protection** — a domain is marked "protected" when its behaviours are only enforced on the LLM path; LLM degradation or unavailability immediately violates protection | LOW-MEDIUM | Currently mitigated by the consistency layer, but the guarantee is structural only for vocabulary shielding. Other guarantees are "best effort" in the template path. |
| **Customer experience bifurcation** — customers who hit the LLM path get a materially better experience than those who hit the template path | MEDIUM | This is acceptable during convergence. It becomes a quality problem at scale if the template path is the fallback during LLM outages. |

---

## Minimum Safe Next Strategy

### Phase 1: Shared Response Contract (immediate — before next evaluator cycle)

1. Implement `enforceResponseContract(responseContent, meta)` as described in the Minimum Viable Behavioural Contract Layer section above.
2. Apply it at line 647 alongside the existing `sanitizeCustomerResponse()`.
3. This structurally enforces G2 (detail presence), G8 (multi-issue awareness), and partially G9 (customer-voice fragment).
4. No architectural change. Single file. Incremental. Reversible.

### Phase 2: Evaluator Retest (after Phase 1 build)

1. Run Account Setup evaluator retest with both LLM and template paths exercised.
2. Run Website Design frozen holdout suite (regression check).
3. Run Property / Listing Issues frozen holdout suite (regression check).
4. If all pass: promote Account Setup to Converged + Regression Protected.

### Phase 3: Contract Formalisation (after Phase 2 converges)

1. Document the shared response contract as a spec (`spec/orchestration/response_contract.md`).
2. All future domain expansions must satisfy the contract, not just pass evaluator checks.
3. The contract becomes the regression baseline — not the evaluator output.

### What NOT to do next:

- Do not redesign the intake flow
- Do not add an LLM call to the template path (too expensive, defeats the purpose of a fallback)
- Do not merge the LLM and template paths into a single path
- Do not optimise against holdout wording
- Do not relax the bounded disambiguation model

---

## Explicitly Out Of Scope

- Intake flow redesign
- Disambiguation model changes
- Frontend changes
- Schema or database changes
- Route changes
- Evaluator or holdout suite modifications
- LLM prompt changes (the prompt is already well-specified; the gap is enforcement, not instruction)
- Category taxonomy changes
- Summary card or ticket creation changes
- Any change that would affect Property / Listing Issues regression baseline
- Any change that would affect Website Design regression baseline
- Architecture beyond `portal-chat.ts`

---

## Recommended Next Agent

**Build Agent**

Scope: Implement `enforceResponseContract()` in `portal-chat.ts` at the existing response exit point (line 647). The function must:

1. Assert operational detail presence in acknowledgement-stage responses
2. Assert multi-issue awareness when the opening message indicates multiple concerns
3. Inject a customer-voice fragment when the response contains no overlap with the customer's own words
4. Not modify any existing path logic, template builders, LLM prompts, or acknowledgement generators
5. Pass TypeScript typecheck and production build

The Build Agent must NOT see holdout scenarios or evaluator logic.

---

## Build Guidance

### Implementation target

Single function: `enforceResponseContract(responseContent: string, meta: IntakeSessionMetadata): string`

### Application point

```typescript
// portal-chat.ts, after processStage() returns, before DB persist (line ~647)
responseContent = sanitizeCustomerResponse(responseContent);
responseContent = enforceResponseContract(responseContent, meta);
```

### Contract rules

**Rule 1 — Detail Presence:**
If `meta.stage` is `'detail'` (acknowledgement phase) and `meta.collectedFields` contains any of `[affectedPersonName, propertyAddress, account]` or `extractPhoneNumbers(description)` returns results, at least one of these must appear in `responseContent`. If none appear, append: `" I've noted the details you've provided — {detail}."` where `{detail}` is the most specific available (person name > address > account > phone).

**Rule 2 — Multi-Issue Awareness:**
If `meta.openingMessage` matches `/\b(and also|and|as well as|plus|both|too)\b/i` in a way that suggests multiple concerns (heuristic: two or more verb phrases separated by conjunction), and `responseContent` is under 200 characters (suggesting a single-concern acknowledgement), append: `" I've noted everything you've raised."`.

**Rule 3 — Customer-Voice Fragment:**
If `meta.stage` is `'detail'` and `meta.openingMessage` exists, extract the first clause (up to first comma, period, or 60 characters). If no 4+ word substring of this clause appears in `responseContent`, and the response is not an empathy acknowledgement (doesn't contain "frustrating" or "sorry"), prepend or append a brief reference: `" You mentioned {clause} — "` or similar natural phrasing. Use `briefContext()` if available.

### Constraints

- No LLM calls
- No new dependencies
- No schema/route/frontend changes
- No modification to existing template builders or LLM prompt
- Must not break empathy path, security-sensitive path, or escalation path
- Must not produce grammatically broken output (prefer omission over bad phrasing)
- Must not duplicate detail that's already in the response
- Must pass existing TypeScript compilation and production build
