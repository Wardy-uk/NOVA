# Property / Listing Issues — Behavioural Specification

## Domain

Property / Listing Issues conversational intake.

This workstream covers customer requests relating to:
- missing property listings
- incorrect property details
- broken property media
- Rightmove/Zoopla feed issues
- sold/STC state issues
- property sync delays
- image/floorplan problems
- portal display inconsistencies
- listing visibility problems

---

## Behavioural Goal

The portal should allow customers to describe property-related problems naturally without needing to:
- understand portal/feed architecture
- know integration terminology
- identify the affected subsystem
- classify the request manually

The intake experience should feel conversational, operationally useful, and context-aware.

---

## Protected Customer Experience

Customers should be able to say things like:

- "One of our properties isn't showing on Rightmove."
- "The photos for 12 High Street are missing."
- "A sold property is still appearing as available."
- "The floorplan upload failed."
- "Our listing isn't syncing properly."
- "The property description is wrong."
- "Zoopla is showing outdated details."
- "This property disappeared from the website."

without being forced into:
- feed terminology
- integration terminology
- category pickers
- duplicate re-description loops

---

## Expected Behaviour

### Invisible Classification
NOVA should determine internally whether the issue relates to:
- property data
- media
- feed syndication
- portal sync
- listing visibility
- website rendering
- CRM integration
- cache/state mismatch

without exposing this taxonomy to the customer.

---

### Context Preservation
Customer-provided details must persist through intake.

Examples:
- property address
- listing ID
- portal name
- branch
- timestamps
- screenshots
- URLs
- affected portal(s)

must survive into the Request Summary.

---

### Conversational Follow-Up

Follow-up questions should be operationally useful.

Examples:
- "Which property is affected?"
- "Is this affecting your website, property portals, or both?"
- "When did you first notice this?"
- "Do you have a link to the listing?"

Questions should not:
- repeat known information
- expose internal routing logic
- ask the customer to diagnose the issue technically

---

## Human Escalation Behaviour

Frustrated or urgent users should:
- be acknowledged appropriately
- be able to continue conversationally
- receive graceful escalation paths where required

---

## Attachment Expectations

Customers may provide:
- screenshots
- floorplans
- EPCs
- property photos
- export files

The intake flow should acknowledge attachment capability naturally.

---

## Operational Requirements

The resulting Request Summary must preserve:
- the affected property
- the operational symptom
- affected systems/portals
- customer-provided evidence
- urgency/context
- chronology where relevant

Support agents should not need to restart discovery manually.

---

## Protected Behaviour Rules

Customers must not:
- see internal taxonomy
- classify their own request
- be forced to repeat themselves
- lose operationally important details
- encounter hard conversational resets

---

## Convergence Target

Convergence is achieved when:
- property-related requests behave conversationally
- operationally important context survives intake
- portal/feed complexity remains hidden
- evaluator regression suite passes
- operational usability is trusted by support staff