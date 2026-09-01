# 02 — Parcel state

**For** a dispatcher, **so that** they can answer "where is this parcel" without
phoning the driver.

## User Stories

*"As a `dispatcher`, I want `to see a parcel's current state`, so that `I can answer a phone call without radioing the driver`"*

- US-1: As a dispatcher, I want to open a parcel by its tracking number and see its current state, so that I can answer a phone call in under 2 seconds.
- US-2: As a dispatcher, I want to see the full scan history of a parcel in order, so that I can explain what happened when a delivery is disputed.
- US-3: As a dispatcher, I want a parcel with no scans in 48 hours to show as stalled, so that I notice a lost parcel before the customer calls.
- US-4: As a dispatcher, I want state to update within 60 seconds of a scan arriving, so that I never repeat what I already told the last caller.

## Behavior decisions

State is derived from the scan history, never stored independently — a state
that disagrees with its own history is not trusted. "Stalled" is a read-time
computation (no scan in 48h), not a written flag.

## Out of scope for this capability

- Editing or correcting a scan after the fact.
- Predicting a delivery time.
