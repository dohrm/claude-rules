---
paths:
  - "**/*.cs"
  - "**/*.tscn"
title: "Godot Project Architecture"
---

## Co-location by entity

One entity = one folder holding everything it owns: scene (`.tscn`), script
(`.cs`), data (`.tres`), its assets, and its `states/`. Never split an entity's
pieces across sibling folders.

Root layout:

- `actors/` — `player/`, `monsters/`, `shared/`
- `levels/`
- `systems/` — cross-cutting singletons and the event bus
- `ui/`

## Composition over inheritance

Behaviour is assembled from components attached to a scene, not baked into a deep
class hierarchy. Standard components:

- `StateMachine` + its `states/` (one node per state)
- `StatsComponent`, `SkillComponent`, `HitboxComponent`, `DropComponent`

Component class names end in `Component`. A new capability is a new component, not
a new subclass of an existing entity.

## Node access

- Wire dependencies with exported, typed handles (`[Export] private Node2D foo;`
  or an `[Export] private NodePath` resolved once in `_Ready`) — **not** string
  `GetNode("some/path")` scattered through the code. String paths are the untyped
  hole C# was chosen to close.
- Resolve once, cache the typed reference; never call `GetNode` in `_Process`.
