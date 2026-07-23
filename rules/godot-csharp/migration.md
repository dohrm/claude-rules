---
paths:
  - "**/*.gd"
  - "**/*.cs"
title: "GDScript → C# Migration"
---

This project is C#. Existing `.gd` files are **legacy pre-migration** — tolerated
but frozen.

## The rule: no new `.gd`

- Never create a `.gd` file. New code is C#.
- Existing `.gd` files live on a shrinking allowlist (`.godot-gd-allowlist`). The
  allowlist only ever loses entries.
- The allowlist is also the map of where strict gates are suspended: "no hardcoded
  values" and "typed signals" apply to C# only. Inside legacy `.gd` they do not —
  do not retrofit code that is on its way out.

## Migrate producer and consumers together

The event bus is the first migration target — it is the seam where typing pays off
most. When you convert an event, convert its consumers in the same change (see
`event-bus.md`). Half-migrated, a typed signal is still dynamic on the `.gd` side,
so you gain nothing until the last consumer is C#.

## C# ↔ GDScript interop during transition

The boundary is untyped by nature. Keep it thin, keep it one-directional where you
can, and shrink it every time you touch adjacent code.
