#!/usr/bin/env sh
# Fail if a tracked .gd file is not on the migration allowlist.
# Allowlist: .godot-gd-allowlist at repo root, one repo-relative path per line.
# See rules/godot-csharp/migration.md — the allowlist only ever shrinks.
set -eu

allow=".godot-gd-allowlist"
[ -f "$allow" ] || : > "$allow"

violations=$(git ls-files '*.gd' | grep -vxF -f "$allow" 2>/dev/null || true)

if [ -n "$violations" ]; then
    echo "New .gd files not on $allow (migration.md: no new .gd):"
    echo "$violations" | sed 's/^/  /'
    echo "Convert to C#. Only to grandfather a truly-legacy file: add its path to $allow."
    exit 1
fi
