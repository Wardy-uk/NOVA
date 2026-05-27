# Admin Email Echo Preservation Plan

## Slice

Portal Phase3 Iteration 28

Name: Admin email echo preservation

## Why This Slice Exists

Iteration 27 closed two of the three remaining admin-context blockers. One isolated issue remains:

- displayed conversational acknowledgements can still corrupt email addresses when echo stripping runs against LLM text that contains the user’s email

This is a display-layer quality bug, not a routing or metadata-preservation problem.

## Behavioural Goal

When the portal acknowledges an admin/account request, any email address that appears in the conversational response should remain intact and human-readable.

## Scope

In scope:

- email-safe echo stripping in displayed replies
- preservation of the already-fixed billing framing and name capture behaviour

Out of scope:

- broader admin-context redesign
- non-admin replay failure families
- summary-card or metadata changes that are already working
