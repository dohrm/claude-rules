# ADR-0002: Hosted vector search for campaign notes

**Statut :** Rejeté

## Context

The proposal sends campaign note text to a hosted embedding and vector-search service, then queries it over the network.

## Decision

Reject the hosted service for campaign search. The product must search offline and campaign text must not leave the device.

## Consequences

The team must operate search locally or change those product constraints through a new decision.
