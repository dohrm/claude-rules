# kit/godot — Godot 4 + C# quality gates

Wiring (the installer never merges build config — do this by hand):

1. Merge `lefthook.snippet.yml` into your root `lefthook.yml` (thin triggers → `just godot-lint` / `godot-check`).
2. Merge `justfile.snippet` into your root `justfile` and set `godot_dir`, `godot_bin`, `godot_export_preset`.
3. `chmod +x check-no-new-gd.sh` (copied to `.claude/kit/godot/`).
4. In the Godot project: enable C# (.NET), install export templates, add GDUnit4, and configure an export preset matching `godot_export_preset`.

## The gates

Prefer **predictive tooling** — analyzers that understand the code — over grep. Most gates
run *inside* `dotnet build` (the Roslyn analyzers), so they cost nothing extra and can't drift
from the compiler's view.

| Gate | Kind | When | Catches |
|---|---|---|---|
| `dotnet build -warnaserror` | compiler | commit | type errors, all warnings |
| GODOT001 | analyzer | commit (in build) | hardcoded gameplay value → move to `.tres` |
| GODOT002 | analyzer | commit (in build) | `[Signal]` declared outside `EventBus` |
| GODOT003 | analyzer | commit (in build) | `GetNode("string")` → use `[Export]` handle |
| `check-no-new-gd.sh` | file set | commit | new `.gd` off the allowlist (migration.md) |
| `dotnet test` | GDUnit4 | push | test regressions |
| headless `--export-release` | engine | push | broken `.tscn`/`.tres` refs the compiler can't see |

`check-no-new-gd.sh` stays a script on purpose: it is a question about which files *exist*, not
about code — an analyzer is the wrong tool. Everything about *code* is an analyzer.

## Wiring the analyzers

Reference the analyzer project from the game `.csproj` so it runs in every build:

```xml
<ItemGroup>
  <ProjectReference Include=".claude/kit/godot/analyzers/Factory.Godot.Analyzers.csproj"
                    OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
</ItemGroup>
```

Merge `analyzers/.editorconfig` into the project's `.editorconfig` (sets GODOT00x = error).

GODOT001's opt-out — define this attribute once in the game project and mark genuine technical
constants with it:

```csharp
[AttributeUsage(AttributeTargets.Field | AttributeTargets.Property | AttributeTargets.Method)]
public sealed class TechnicalConstantAttribute : System.Attribute { }
```

## Honest limits

- **GODOT001 is not sound.** Syntax can't prove a number is a design parameter. The analyzer
  is far tighter than grep (respects types, skips const/enum/attribute/0/1, honours
  `[TechnicalConstant]`) but will still have false positives — mark them, don't fight them.
  GODOT002/003 are sound (pure structural facts).
- **docs↔`.tres` coherence** — only checkable once the design doc under `docs/` is structured.
  Deferred; it too should be a parser, not a grep.
- The analyzers are a **starter**: authored against the Roslyn API, not yet built in this repo.
  Compile the analyzer project once and run it on the game before trusting severities.
