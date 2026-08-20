# Godot C# gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/godot/godot.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.
#
# The three variables below are the ones you MUST override in the root justfile — the
# lock knows nothing about a Godot binary or an export preset, so `init` cannot derive
# them, and the defaults here are guesses that only fit a game under game/.
# `godot-check` is not in `check` for the same reason: enable it once these are right.

godot_dir := "game"
godot_bin := "godot"                 # or an absolute path to the Godot 4 .NET build
godot_export_preset := "Linux/X11"   # must exist in export_presets.cfg

# Commit-time: build (runs the Roslyn analyzers GODOT001-003 in-process) + the file-level gate.
godot-lint:
    cd {{godot_dir}} && dotnet build -warnaserror
    sh .dev/kit/godot/check-no-new-gd.sh

# Push-time: tests + headless export (the only gate that catches broken scene/resource refs).
godot-check: godot-lint
    cd {{godot_dir}} && dotnet test
    cd {{godot_dir}} && {{godot_bin}} --headless --import
    cd {{godot_dir}} && {{godot_bin}} --headless --export-release "{{godot_export_preset}}" /tmp/godot-export-check
