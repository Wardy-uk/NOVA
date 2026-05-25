# Account Setup / Office Changes — Ambiguity & Collision Scenarios

## Purpose

This document defines the specific cross-domain collision points for Account Setup / Office Changes and how each should be resolved. These scenarios test the boundaries between this domain and all other active or protected domains.

---

## Collision Class 1: Login vs Permissions

### Scenario A — "I'm locked out of the reports"

**Domains in play:** Account Setup (login/auth) vs Data/Reporting (report access scope)

**Resolution:** Ask about the symptom. "What happens when you try to access them — do you get an error, or can you log in but the reports aren't there?"
- Error / can't log in → Account Setup
- Can log in but reports empty/missing → depends on further context, but default Account Setup (permissions likely cause)

**Why Account Setup is the safe default:** If access isn't working, the root cause is more often provisioning/permissions than a reporting pipeline issue. Support can reclassify if needed.

---

### Scenario B — "My password isn't working for the email builder"

**Domains in play:** Account Setup (password) vs Template/Email (builder issue)

**Resolution:** No disambiguation needed. "Password isn't working" is unambiguously an access issue regardless of which product is named. Route to Account Setup. Preserve the product context ("email builder") in the summary.

---

### Scenario C — "I can't log in to update the website"

**Domains in play:** Account Setup (login) vs Website Design (content update)

**Resolution:** The primary complaint determines routing. "Can't log in" = Account Setup. "Need to update the website" = Website Design. When both are present, the blocker (login) takes priority because the content update can't happen until access is restored. Route to Account Setup with website update intent noted in summary.

---

## Collision Class 2: Office Move vs CRM/Display Issue

### Scenario D — "We've moved offices and the website still shows the old address"

**Domains in play:** Account Setup (office change) vs Website Design (content update)

**Resolution:** No disambiguation needed. The website display complaint is the actionable request. Route to Website Design. Note the office move context in summary — support may need to update both the website AND the account record.

---

### Scenario E — "We've moved offices and nothing is working"

**Domains in play:** Account Setup (office restructure) vs potentially everything

**Resolution:** Route to Account Setup. The office move is the root context. Follow up with "What specifically isn't working?" — this is operational discovery, not disambiguation. Whatever they describe feeds into the summary.

---

### Scenario F — "The new office isn't getting any leads"

**Domains in play:** Account Setup (office not configured) vs Integration (lead routing broken)

**Resolution:** Disambiguation allowed. One question: "Is this a recently opened office, or has it been receiving leads before?" 
- Recently opened → Account Setup (provisioning incomplete)
- Was working, now stopped → Integration (routing failure)
- Still ambiguous → Account Setup (safe default, provisioning is the more common cause for new offices)

---

## Collision Class 3: Missing User vs Sync Delay

### Scenario G — "The new starter can't see anything"

**Domains in play:** Account Setup (user not provisioned) vs Integration (data sync delay) vs Data/Reporting (data scope)

**Resolution:** Strong Account Setup signal ("new starter"). Route directly — no disambiguation. A new person who can't see anything is almost always a provisioning gap.

---

### Scenario H — "One of our users can't see the leads anymore"

**Domains in play:** Account Setup (permissions changed) vs Integration (leads stopped arriving) vs Data/Reporting (report scope changed)

**Resolution:** Disambiguation allowed. "Anymore" implies it was working before, which shifts away from provisioning. One question: "When they look for the leads, are they getting an error or just seeing nothing there?"
- Error → Account Setup (permissions/access revoked)
- Nothing there → Integration/Data (leads stopped or scope changed) — route to Integration as the more actionable default
- Still ambiguous → Account Setup (safe default)

---

### Scenario I — "A user says their data is missing"

**Domains in play:** Account Setup (access scope) vs Data/Reporting (data gap) vs Integration (data not synced)

**Resolution:** Disambiguation allowed. One question: "Is the data something they used to be able to see, or are they looking for something they've not accessed before?"
- Used to see it → less likely provisioning, more likely Data/Integration
- Never accessed before → Account Setup (access not set up)
- Unclear → Account Setup (safe default)

---

## Collision Class 4: Account Setup vs Reporting Visibility

### Scenario J — "The branch manager can't see the performance data"

**Domains in play:** Account Setup (permissions) vs Data/Reporting (report scope/availability)

**Resolution:** Disambiguation allowed. One question: "Is this a new branch manager, or have they been able to see this data before?"
- New person/role → Account Setup
- Was working, now broken → Data/Reporting or Account Setup (could be either)
- Still ambiguous → Account Setup (safe default; permissions is the most common cause when a specific person can't see specific data)

---

### Scenario K — "I can't export the data for our other branch"

**Domains in play:** Account Setup (cross-branch access) vs Data/Reporting (export functionality)

**Resolution:** No disambiguation needed for most cases. "Can't export" combined with "other branch" suggests access scope. Route to Account Setup. If they add detail like "the export runs but the data is wrong," that shifts to Data/Reporting — but let context accumulate naturally rather than asking.

---

## Collision Class 5: Three-Way Collisions

### Scenario L — "The new office isn't set up properly — the website shows old info, leads aren't coming through, and the team can't log in"

**Domains in play:** Account Setup + Website Design + Integration

**Resolution:** No disambiguation. The root context is clearly "new office setup" — this is Account Setup. All three symptoms are noted in the summary. Support will coordinate across teams.

---

### Scenario M — "Something's wrong with our account — reports are showing the wrong branch, users can't see the right data, and the website has the old office name"

**Domains in play:** Account Setup + Data/Reporting + Website Design

**Resolution:** No disambiguation. "Our account" anchors to Account Setup. The multiple symptoms suggest an account/branch configuration issue that cascades to other systems. Route to Account Setup with all symptoms preserved.

---

## Resolution Priority Order

When signals conflict and no disambiguation resolves the ambiguity, use this priority:

1. **Security-sensitive signals** always win (removal, revocation, terminated employee) → Account Setup, fast-tracked
2. **Explicit login/password signals** → Account Setup (no disambiguation needed)
3. **New person/office signals** → Account Setup (provisioning is most likely cause)
4. **"Used to work, now doesn't" signals** → requires disambiguation; if unresolved, default to Account Setup for access issues or Integration for data flow issues
5. **Display/visual complaints** → Website Design (even if account context is present)
6. **"Data is wrong" without access context** → Data/Reporting

---

## Key Principle

When a customer describes multiple symptoms rooted in a structural change (new office, office closure, merger), route to Account Setup regardless of which individual symptoms touch other domains. The structural change is the root cause signal, and support needs that context to coordinate the response.

When a customer describes a single symptom that could be access OR something else, disambiguation is permitted — but only one question, and only about the customer's experience.
