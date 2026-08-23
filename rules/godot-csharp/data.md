---
paths:
  - "**/*.cs"
  - "**/*.tres"
title: "Gameplay Data"
---

GODOT001 (`just godot-lint`) flags numeric literals in a type that
derives from `Godot.*`. Move the value into a `.tres`, or — for a
genuine technical constant — mark the member `[TechnicalConstant]`. The
analyzer skips 0/1, `const`, enums, and attributes. It is not sound:
syntax cannot prove a number is a design parameter. Use the attribute as
a deliberate, visible opt-out, not a reflex.

What the analyzer cannot see:

- A `.tres` is backed by a `[GlobalClass]` C# `Resource` subclass with
  `[Export]` fields — not a bag of untyped `Dictionary` entries.
- The design doc under `docs/` carries the intent; the `.tres` is its
  materialisation. Keep them coherent. Docs↔`.tres` coherence is itself
  checkable if the doc is structured; the factory does not ship that
  check.
