#!/bin/sh
# Replays #43: run the "Compute PR diff" step of kit/rust/mutation-ci.yaml, verbatim,
# in a full clone (checkout fetch-depth: 0) of a PR whose base moved after the cut.
# Exit 0 = the step works; non-zero = the bug. Usage: repro.sh <path to mutation-ci.yaml>
set -eu
yaml=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c user.email=r@x -c user.name=r -c init.defaultBranch=base "$@"; }
g init -q --bare "$tmp/origin.git"
g clone -q "$tmp/origin.git" "$tmp/dev" 2>/dev/null
cd "$tmp/dev"
echo a > a; g add a; g commit -qm A; g push -q origin base
g switch -qc pr; echo f > f; g add f; g commit -qm F; g push -q origin pr
g switch -q base; echo b > b; g add b; g commit -qm B; g push -q origin base
g clone -q "$tmp/origin.git" "$tmp/ci" 2>/dev/null   # fetch-depth: 0 — the whole history
cd "$tmp/ci"; g switch -q pr
# The step's run block, taken from the YAML, with the base ref substituted.
awk '/- name: Compute PR diff/{f=1;next} f&&/run: \|/{r=1;next} r&&/^      - name:/{exit} r{sub(/^          /,"");print}' "$yaml" \
  | sed 's/\${{ github.base_ref }}/base/g' > step.sh
[ -s step.sh ] || { echo "repro: could not extract the step from $yaml" >&2; exit 2; }
sh -e step.sh
