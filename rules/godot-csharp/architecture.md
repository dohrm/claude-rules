---
paths:
  - "**/*.cs"
  - "**/*.tscn"
title: "Godot Project Architecture"
---

GODOT003 (`just godot-lint`) fails `GetNode` / `GetNodeOrNull` with a
string-literal path. Wire an `[Export]` typed handle or an `[Export]
NodePath` resolved once in `_Ready`. Resolve once; never call `GetNode`
in `_Process`.

What the analyzer cannot see:

## Co-location by entity

One entity = one folder holding everything it owns: scene (`.tscn`),
script (`.cs`), data (`.tres`), its assets, and its `states/`. Never
split an entity's pieces across sibling folders.

Root layout: `actors/` (`player/`, `monsters/`, `shared/`), `levels/`,
`systems/` (cross-cutting singletons and the event bus), `ui/`.

## Composition over inheritance

Behaviour is assembled from components attached to a scene, not baked
into a deep class hierarchy. Standard pieces: `StateMachine` + its
`states/`, `StatsComponent`, `SkillComponent`, `HitboxComponent`,
`DropComponent`. Component class names end in `Component`. A new
capability is a new component, not a new subclass of an existing entity.
