# Holdout Scenarios Template

> DO NOT LEAK TO BUILD AGENT.
>
> This file is for evaluator-only scenarios that should not be used to guide implementation.

## Feature

- Name:
- Phase:

## Hidden Scenarios

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 |  |  |  |
| H2 |  |  |  |
| H3 |  |  |  |

## Edge Inputs

- Input:
- Input:

## Regression Traps

- Trap:
- Trap:

## SaaS Example

| ID | Scenario | Why it matters | Expected behaviour |
| --- | --- | --- | --- |
| H1 | Apply a saved ticket filter, then refresh the browser | Mature apps often break state restore | The saved filter remains applied and the results stay valid |
| H2 | Call the export endpoint with no matching records | Empty datasets are easy to mishandle | The API returns a valid empty export response, not a 500 |
| H3 | Open the customer list in two tabs with different filters | Existing state containers may bleed across tabs | Each tab keeps its own filter state |
