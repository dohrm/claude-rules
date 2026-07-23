---
paths:
  - "**/*.cs"
title: "Godot C# Quality Gates"
---

Every change must pass all gates before being considered done:

```bash
dotnet build                                        # Compiles clean — warnings are errors
dotnet test                                         # GDUnit4 tests pass
godot --headless --export-release <preset> <out>    # Headless export succeeds
```

## Why headless export is mandatory

The C# compiler validates code, **not** the scene graph. A renamed node, a moved
`.tscn`, or a missing `.tres` is a broken reference the build never sees — it
crashes at runtime. A headless export loads every scene and resource, so it is
the only gate that catches these. Treat an export failure exactly like a build
failure.

## Warnings are errors

`.csproj` must set:

```xml
<TreatWarningsAsErrors>true</TreatWarningsAsErrors>
<Nullable>enable</Nullable>
<AnalysisLevel>latest-recommended</AnalysisLevel>
```

Strong typing is the reason C# was chosen over GDScript — do not undercut it by
suppressing warnings. No `#pragma warning disable` without a justification comment
on the same line.

## Project-specific gates

Enforced by `kit/godot` (see `just godot-check`):

- **No broken resource references** — every `.tscn`/`.tres` `ext_resource` path resolves (headless export).
- **No hardcoded gameplay values** — see `data.md`.
- **No new `.gd`** — see `migration.md`.
