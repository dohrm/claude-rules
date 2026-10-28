#!/usr/bin/env node
// The npx spec of the CLI this repo's lock installed from: core's url at its locked
// rev (#54), else its ref. `rules-check` runs the doctor through it, so the audit is
// the one that matches the install — never whatever the default branch is today.
// Usage: node cli-spec.mjs [lock]   (default .claude-rules.lock)
import { readFileSync } from 'node:fs'

const file = process.argv[2] || '.claude-rules.lock'
let lock
try { lock = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
  console.error(`cli-spec: cannot read ${file} (${e.message}) — run the installer's \`add\` first`)
  process.exit(1)
}
// A lock from before sources (`repo` + `ref`) still names core.
const core = lock.sources?.[0] ?? (lock.repo && { url: `github:${lock.repo}`, ref: lock.ref })
if (!core?.url || !(core.rev || core.ref)) {
  console.error(`cli-spec: ${file} names no core source`)
  process.exit(1)
}
const at = core.rev || core.ref
if (/^-|\s/.test(core.url) || /^-|\s/.test(at)) {
  console.error(`cli-spec: ${file} core url/ref must not start with "-" or hold spaces`)
  process.exit(1)
}
console.log(`${core.url.startsWith('github:') ? core.url : `git+${core.url}`}#${at}`)
