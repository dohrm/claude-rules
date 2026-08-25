---
paths:
  - "**/*.gd"
  - "**/*.cs"
title: "GDScript → C# Migration"
---

`check-no-new-gd.sh` (`just godot-lint`) fails a tracked `.gd` that is
not on `.godot-gd-allowlist`. The allowlist only ever shrinks. Existing
`.gd` files are legacy pre-migration — tolerated but frozen. New code
is C#.

The allowlist is also the map of where strict gates are suspended:
GODOT001 / GODOT002 apply to C# only. Inside legacy `.gd` they do not —
do not retrofit code that is on its way out.

What the script cannot see:

The event bus is the first migration target. When you convert an event,
convert its consumers in the same change (`event-bus.md`). Half-migrated,
a typed signal is still dynamic on the `.gd` side. The C# ↔ GDScript
boundary is untyped by nature — keep it thin, one-directional where you
can, and shrink it every time you touch adjacent code.
