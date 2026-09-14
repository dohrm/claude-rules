# Experience — edit-assisted

- **ID**: edit-assisted
- **Actor**: occasional operator
- **Scope**: editing an existing order, from opening through save or cancellation
- **Status**: stable
- **Visual policy**: toolkit
- **Validation source**: 2026-09-13 developer selected this behavior in a walkthrough

## Outcome
Update an order without losing unsaved work on a failed request.

## Flow
Open → guided details → review → save.

## Invariants
Failed saves preserve the draft and allow retry.

## Recovery
On failure retain the draft, explain the error, and allow retry.

## Freedom
Composition and step count may differ by actor. Shared toolkit tokens remain.

## Evidence
Source review only; runtime and usability checks are unverified.

## Visual references
None — toolkit only.
