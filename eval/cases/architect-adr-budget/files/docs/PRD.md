# PRD — Parcel tracking for a regional carrier

## Problem

Dispatchers phone drivers to find out where a parcel is. Customers phone dispatchers.
Nobody has a single answer, and the call volume grows with the fleet.

## Solution

One service that ingests scan events from handheld devices and exposes a parcel's
current state and history, to the dispatcher console and to a public tracking page.

## Target User

A dispatcher managing 40–60 drivers from a depot, and the recipient of a parcel who
has a tracking number and no account.

## Capabilities

| # | Capability | For whom, and the job it does |
|---|---|---|
| 01 | Ingest scan events | drivers' handhelds push scans, often hours late from a truck with no signal |
| 02 | Parcel state | a dispatcher sees where a parcel is and what happened to it |
| 03 | Public tracking | a recipient with a tracking number sees a simplified status |
| 04 | Depot dashboard | a dispatcher sees the parcels stuck at their depot |

## Success Criteria

- A scan taken offline appears in the parcel history within 60 s of the device regaining signal.
- A dispatcher opens a parcel's history in under 2 s at the 99th percentile.
- Public tracking never exposes a recipient's address or phone number.
- 200 depots, ~2 M scan events per day, retained 18 months.

## Out of Scope

Route optimisation. Driver payroll. Anything the handheld app itself does. Real-time
GPS positions — scans only.

## Additional Notes

The handhelds are Android, already deployed, and their firmware release cycle is
quarterly: the ingest contract cannot change on our schedule.
