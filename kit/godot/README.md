# kit/godot — the Godot 4 + C# validation chain

This is a **jalon**: the toolchain already sees types (`dotnet build
-warnaserror`), the three Roslyn analyzers (GODOT001–003), the no-new-`.gd`
file-set, tests, and (when the engine is present) a headless export.
The recipes own the commands. The installer copies this directory to
`.dev/kit/godot/` and **never merges** the analyzer reference into the
game `.csproj` — you add it once.

`claude-rules init` writes `import '.dev/kit/godot/godot.just'`. It does
**not** add `godot-check` to `check`: override `godot_dir`, `godot_bin`
and `godot_export_preset` first (the lock cannot derive a binary or a
preset), then add the recipe. Lefthook is a thin trigger: merge
`lefthook.snippet.yml`.

There is no Tier 3. Godot has no production-grade mutation tool.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just godot-lint` | 1 | pre-commit | `dotnet build -warnaserror` (GODOT001–003 in-process) · `check-no-new-gd.sh` |
| `just godot-check` | 2 | pre-push, and `check` once wired | godot-lint · `dotnet test --no-build` · `godot --headless --import` · `--export-release` |

`check-no-new-gd.sh` stays a script: it is a question about which files
*exist*, not about code. Everything about *code* is an analyzer.

## Configs — copy once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `analyzers/` | referenced from `<godot_dir>/*.csproj` | `dotnet build` | nothing |
| `analyzers/.editorconfig` | merge into `<godot_dir>/.editorconfig` | Roslyn | severities (error) |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just godot-*` exists |
| `.godot-gd-allowlist` | repo root | `check-no-new-gd.sh` | shrink only |

```xml
<ItemGroup>
  <ProjectReference Include=".dev/kit/godot/analyzers/Factory.Godot.Analyzers.csproj"
                    OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
</ItemGroup>
```

`.csproj` must also set `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`,
`<Nullable>enable</Nullable>`. Needs Godot 4 **.NET**, export templates,
GDUnit4 (or any `dotnet test` runner), and an export preset matching
`godot_export_preset`.

GODOT001's opt-out — define this once and mark genuine technical constants:

```csharp
[AttributeUsage(AttributeTargets.Field | AttributeTargets.Property | AttributeTargets.Method)]
public sealed class TechnicalConstantAttribute : System.Attribute { }
```

## What this chain cannot see

Co-location by entity, composition / `*Component`, typed `[Export]`
handles (GODOT003 only sees a string `GetNode`), EventBus-as-the-only-bus
beyond `[Signal]` placement (GODOT002), typed `.tres` Resources, docs↔`.tres`
coherence, migrate-producer-and-consumers-together. Those stay in
`rules/godot-csharp/` as mentions. Do not invent a fourth analyzer to
"translate" them.

GODOT001 is not sound: syntax cannot prove a number is a design
parameter. Mark a genuine technical constant; do not fight the analyzer.
GODOT002/003 are sound.

The factory's own CI witnesses `godot-lint` and `dotnet test`. Headless
export needs the engine on the consuming runner — that line is why
`godot-check` is not in `check` until `godot_bin` is a real binary.
