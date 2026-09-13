# Experience — edit-expert

- **ID**: edit-expert
- **Actor**: expert operator
- **Scope**: editing an existing order, from opening through save or cancellation
- **Status**: stable
- **Visual policy**: specified
- **Validation source**: 2026-09-13 developer selected this behavior in a walkthrough

## Outcome
Update an order without losing unsaved work on a failed request.

## Flow
Open → edit → save → confirmation.

## Invariants
The supplied editor action specification applies to this screen.

## Recovery
On failure retain the draft, explain the error, and allow retry.

## Freedom
Composition and step count may differ by actor. Shared toolkit tokens remain.

## Evidence
Source review only; runtime and usability checks are unverified.

## Visual references
[Required editor actions, revision 1](../specs/editor.md)
