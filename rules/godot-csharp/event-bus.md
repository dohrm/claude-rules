---
paths:
  - "**/*.cs"
title: "Event Bus & Inter-domain Communication"
---

Cross-domain communication goes through the single typed event-bus autoload:
`systems/event_bus/EventBus.cs`.

## One bus, typed, extended in place

- Declare every cross-domain signal on `EventBus` as a typed Godot signal:

  ```csharp
  [Signal] public delegate void PlayerDiedEventHandler(Player player);
  ```

- **Extend the bus — never duplicate the signal list elsewhere.** A new
  cross-domain event is a new signal on `EventBus`, not a private signal on some
  actor that another domain reaches into.
- Emit and connect through the bus; arguments are typed. A typo or wrong type is
  now a compile error — which is the entire point.

## Direct calls (tolerated)

Direct calls to utility autoloads are fine — they are not cross-domain events:
`FeedbackSystem.Emit(...)`, `AudioManager`, `Inventory`, `GameManager.RegisterPlayer(...)`.

## When the bus splits (future)

A single central bus is a god-file and the seam that will not survive a
mono-repo → submodule split: a domain extracted into its own module cannot depend
on the host's bus. If that split ever happens, group events by domain (typed
event records per domain) rather than one flat central list. Not a concern while
solo/mono-repo — just do not let the flat list grow assumptions that block it.
