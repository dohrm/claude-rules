---
paths:
  - "**/*.cs"
title: "Event Bus & Inter-domain Communication"
---

GODOT002 (`just godot-lint`) fails a `[Signal]` delegate declared
outside a class named `EventBus`. Cross-domain signals belong on the
single typed autoload `systems/event_bus/EventBus.cs`. Emit and connect
through the bus; arguments are typed.

What the analyzer cannot see:

Direct calls to utility autoloads are fine — they are not cross-domain
events: `FeedbackSystem.Emit(...)`, `AudioManager`, `Inventory`,
`GameManager.RegisterPlayer(...)`.

A single central bus is a god-file and the seam that will not survive a
mono-repo → submodule split. If that split ever happens, group events by
domain rather than one flat list. Not a concern while solo/mono-repo —
just do not let the flat list grow assumptions that block it.
