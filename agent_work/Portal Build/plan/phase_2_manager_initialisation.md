# Phase 2 — Conversational Intake Continuity

## Why A New Phase Is Required
Phase 1 should be treated as materially successful within its intended scope. The key behaviours targeted there are now considered converged: customer-facing ticket status consistency, removal of raw internal terminology from tested customer surfaces, clearer ticket tracking, successful request submission, improved conversational progression, and lower restart risk than the original baseline.

The newly observed problem is different in kind. It is not a failure of submission, status handling, or terminology cleanup. It is a broader behavioural conflict in how the support journey is structured once a customer begins conversationally. Because the problem concerns the continuity and integrity of the overall intake model, it should be treated as a separate convergence phase rather than an extension of Phase 1.

This separation matters because the remaining gap is no longer about making isolated parts of the journey work. It is about establishing a stable behavioural contract for how the whole intake experience should feel from first contact through request formation.

## Behavioural Problem Statement
The current experience presents two competing support behaviours within the same journey:

- conversational support intake
- category-driven or form-driven routing

The customer can begin in a conversational mode, with the interaction appearing to gather intent naturally. However, the journey then shifts back toward explicit category selection or other traditional routing behaviour. After that shift, progression becomes inconsistent, confirmation states become less reliable, and the customer experience loses its sense of continuity.

The core problem is not merely that both behaviours exist. It is that the customer is exposed to an unstable transition between them. The journey does not reliably behave as one coherent support conversation, and the customer can feel moved between two different operating models without a clear or trustworthy reason.

## Intended Customer Experience
The desired behavioural model is a single coherent conversational support intake experience.

The customer should begin by describing their issue in natural language. Clarification should continue conversationally, with follow-up questions feeling like a natural extension of the same interaction rather than a handoff into an internal workflow. Any underlying routing complexity should remain hidden from the customer.

As the request becomes clearer, the support journey should continue to feel unified. The customer should experience steady forward progress, understandable confirmation, and confidence that their request is being captured properly. At no point should they feel pushed into internal operational taxonomy, category trees, or form logic that breaks the conversational frame.

## Operational Goal
Operationally, support should still receive a request that is structured enough to be triaged, understood, and actioned efficiently.

The behavioural aim is not to remove operational structure. It is to ensure that the structure is produced without exposing customers to the underlying routing model. Support should receive a usable, coherent intake outcome while the customer experiences a consistent conversational journey.

## Behavioural Risks
If the current mixed-model behaviour remains, several risks persist:

- customers may lose trust when the interaction changes mode unexpectedly
- customers may become unsure whether the system understood their issue
- confirmation may feel unreliable or incomplete
- customers may repeat themselves when conversational progress appears to reset
- category or taxonomy exposure may reintroduce the very internal framing that Phase 1 worked to reduce
- apparent progress may not feel dependable, increasing abandonment or restart risk
- the experience may appear inconsistent or improvised rather than guided and intentional

## Scope Boundaries
Phase 2 should focus specifically on intake continuity and conversational coherence.

It should preserve all converged Phase 1 behaviour, including customer-facing status consistency, successful submission behaviour, clearer tracking, and the removal of raw internal terminology from tested customer surfaces. Phase 2 should not reopen those areas except where necessary to maintain continuity within the conversational intake journey.

Phase 2 should not attempt a portal-wide redesign. It should not attempt to replace the underlying support platform. It should not become a broad information architecture project, a general UX cleanup effort, or a full reconsideration of every support entry point.

The phase should stay tightly centred on one behavioural outcome: a customer who starts in a conversational intake flow should experience coherent continuation of that model through clarification, request shaping, and submission-oriented progression.

## Proposed Evaluation Themes
Future evaluation for Phase 2 should focus on broad behavioural themes such as:

- ambiguous customer requests
- conversational clarification continuity
- transitions between intake states
- maintaining conversational trust
- avoiding visible operational taxonomy
- graceful fallback when confidence is low
- stability of confirmation behaviour within a conversational journey
- preservation of progress without apparent mode switching

## Recommended First Slice For Phase 2
The smallest practical first slice should focus on the core journey where a customer begins with a free-text support request and then needs one or two rounds of clarification before the request becomes actionable.

That slice should aim to validate a single behavioural promise: once the customer begins conversationally, the experience continues to feel conversational through clarification and onward progression, without dropping the customer back into category-led routing behaviour.

This is the narrowest slice likely to expose the central continuity problem while keeping the phase disciplined. It is large enough to test whether the conversational model can remain intact across a real transition in understanding, but still small enough to anchor the next attractor loop around one coherent behavioural outcome.
