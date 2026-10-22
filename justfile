# This repository's composition. It is self-hosted: the gates are the kit library it
# edits, imported in place (kit/common), never a copy under .dev/kit that could drift.
# The installer never writes this file — it is not a consuming repo.

set allow-duplicate-recipes
set allow-duplicate-variables

import 'kit/common/gate.just'

# The library defaults to an installed copy and to origin/main as the trunk.
kit  := "kit/common"
base := "origin/next"

# The local loop. CI runs the same suite (npm test) per job.
check: test adr-check docs-check

test:
    npm test

# ── Repo audit (maintainer/audit/README.md) ────────────────────────────────
# Manual, one call per agent per round. Read-only like the reviewer: the claude deny
# list IS the kit's, minus the web (vendor conventions are part of the audit), so a
# re-enumeration of review_deny reaches this recipe too.
# A run spans days: `audit-prep` names it after today, `audit` resumes the latest one.
# Override either with audit_run=<name>.
export audit_run := ""
audit_deny := replace(review_deny, "WebFetch,WebSearch,", "")

audit-prep:
    #!/usr/bin/env bash
    set -euo pipefail
    run=.work/audit-${audit_run:-$(date +%Y-%m-%d)}
    manifest=$run/manifest.md
    # Findings cite the pinned SHAs: re-fetching under a written finding moves its ground.
    [ ! -f "$manifest" ] || { echo "$manifest exists — this run is pinned; start another with audit_run=<name>" >&2; exit 1; }
    mkdir -p "$run" .work/audit-sources
    printf '# Audit %s\n\n- repo: %s\n' "${run#.work/audit-}" "$(git rev-parse HEAD)" > "$manifest"
    grep -v '^#' maintainer/audit/sources.txt | while read -r name url; do
        [ -n "$name" ] || continue
        dir=.work/audit-sources/$name
        if [ -d "$dir/.git" ]; then
            git -C "$dir" fetch --quiet --depth 1 origin HEAD && git -C "$dir" reset --quiet --hard FETCH_HEAD
        else
            git clone --quiet --depth 1 "$url" "$dir"
        fi
        printf -- '- %s: %s@%s\n' "$name" "$url" "$(git -C "$dir" rev-parse HEAD)" >> "$manifest"
    done
    node maintainer/audit/cost.mjs > "$run/cost.md"
    node maintainer/audit/sources.mjs > "$run/sources.md"
    # Open tickets, so an auditor does not re-propose what is already filed.
    gh issue list --state open --limit 100 --json number,title,body \
        --template '{{"{{"}}range .{{"}}"}}## #{{"{{"}}.number{{"}}"}} {{"{{"}}.title{{"}}"}}{{"{{"}}"\n\n"{{"}}"}}{{"{{"}}.body{{"}}"}}{{"{{"}}"\n\n"{{"}}"}}{{"{{"}}end{{"}}"}}' > "$run/issues.md" \
        || echo "(gh unavailable: open tickets not listed)" > "$run/issues.md"
    cat "$manifest"

audit mode agent model:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{mode}}" in
        explore|harvest) ext=jsonl ;;
        synthesize|challenge) ext=md ;;
        *) echo "mode: explore | harvest | synthesize | challenge" >&2; exit 2 ;;
    esac
    run=${audit_run:+.work/audit-$audit_run}
    run=${run:-$(ls -d .work/audit-20* 2>/dev/null | sort | tail -1)}
    [ -f "$run/manifest.md" ] || { echo "no run with a manifest${run:+ at $run} — run: just audit-prep" >&2; exit 1; }
    out=$run/{{agent}}-{{model}}.{{mode}}.$ext
    prompt=$(printf 'MODE: %s\nRUN DIR: %s\nYOU ARE: %s, model %s (your own files start with %s)\n\n' \
        "{{mode}}" "$run" "{{agent}}" "{{model}}" "{{agent}}-{{model}}."; cat maintainer/audit/PROCEDURE.md)
    case "{{agent}}" in
        claude) agent_cli() { claude -p --model '{{model}}' --disallowedTools '{{audit_deny}}' --allowedTools 'Read,Glob,Grep,WebFetch,WebSearch'; } ;;
        codex)  agent_cli() { codex exec --sandbox read-only -m '{{model}}' -; } ;;
        *) echo "agent: claude | codex" >&2; exit 2 ;;
    esac
    printf '%s\n' "$prompt" | agent_cli > "$out" || { rm -f "$out"; exit 1; }
    echo "$out"
