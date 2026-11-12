#!/usr/bin/env node
// A deterministic stand-in for an implementing agent: applies the patch it is given
// (an eval case's reference solution) to the workspace and hands back, so an
// implementation case's oracle can be proven satisfiable without spending a token.
//   node patch-agent.mjs <patch> <prompt>
import { spawnSync } from 'node:child_process'

const patch = process.argv[2]
const r = spawnSync('git', ['apply', patch], { encoding: 'utf8' })
if (r.status !== 0) {
  console.error(`patch-agent: ${patch} does not apply:\n${r.stderr}`)
  process.exit(1)
}
console.log('patch-agent: applied the reference patch; `just check` is green.')
console.log('Hand-back: no `code-review` recipe exists in this justfile, so Tier 3 did not run.')
