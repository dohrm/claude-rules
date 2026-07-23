---
paths:
  - "**/*.cs"
  - "**/*.tres"
title: "Gameplay Data"
---

## Zero hardcoded gameplay values

Every gameplay parameter — stats, damage, speeds, drop rates, cooldowns, prices —
lives in a `.tres` Resource, never as a literal in a script. Scripts read values
off a typed `Resource`; designers tune the `.tres`.

Allowed literals: engine/technical constants with no design meaning (a
normalisation `1f`, an array index, a physics layer bit). Everything a designer
would ever want to tweak is data.

The `kit/godot` Roslyn analyzer (GODOT001) flags numeric literals in Godot types
outside this allowance. Move the value into a `.tres`, or — for a genuine
technical constant — mark the member `[TechnicalConstant]`. Use the attribute as
a deliberate, visible opt-out, not a reflex to silence the analyzer.

## Resources are typed

- A `.tres` is backed by a `[GlobalClass]` C# `Resource` subclass with `[Export]`
  fields — not a bag of untyped `Dictionary` entries.
- The design doc under `docs/` carries the intent; the `.tres` is its
  materialisation. Keep them coherent — a value in the doc but not the `.tres`
  (or the reverse) is silent drift. If the doc is structured, the docs↔`.tres`
  coherence is itself checkable.
