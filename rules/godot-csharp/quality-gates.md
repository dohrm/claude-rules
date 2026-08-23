---
paths:
  - "**/*.cs"
title: "Godot C# Quality Gates"
---

```bash
just godot-check     # godot-lint → dotnet test → headless import + export
```

`godot-lint` is pre-commit (`dotnet build -warnaserror` + `check-no-new-gd.sh`).
`godot-check` is pre-push — and `just check` only after you override
`godot_dir` / `godot_bin` / `godot_export_preset` (the lock cannot derive a
binary or a preset). No Tier 3. Wiring: `.dev/kit/godot/README.md`.

| Recipe | Command | Config |
|---|---|---|
| `godot-lint` | `dotnet build -warnaserror` | `.csproj` (`TreatWarningsAsErrors`, `Nullable`) + analyzers GODOT001–003 |
| `godot-lint` | `check-no-new-gd.sh` | `.godot-gd-allowlist` (shrink only) |
| `godot-check` | `dotnet test --no-build` | GDUnit4 (or any `dotnet test` runner) |
| `godot-check` | `godot --headless --import` then `--export-release` | `export_presets.cfg` matching `godot_export_preset` |

The C# compiler does not see the scene graph. Headless export is the only
gate that loads every `.tscn` / `.tres` — treat a failure like a build
failure.

No `#pragma warning disable` without a reason on the same line. Never
loosen `.editorconfig` (GODOT001–003 as error) to pass.

Sibling rules cover what the chain cannot see: co-location, composition,
typed `.tres`, EventBus-as-the-only-bus beyond `[Signal]` placement,
migrate-producer-and-consumers-together.
