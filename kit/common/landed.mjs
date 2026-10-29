#!/usr/bin/env node

// landed — has a branch's work reached `base`? One answer for `just tree-rm` and
// `just status`, so the recipe that deletes and the report that points agree.
//
// `git merge-base --is-ancestor` alone answers only for a merge commit or a
// fast-forward. A squash merge — the default on many forges — leaves the branch
// forever "unmerged", and `tree-rm` refused every one of them (#57). The second test
// recognises it without a forge, a CLI or a token: the patch-id of the branch's
// cumulative diff since its merge base matches a commit on `base` since then.
//
// Measured, and rejected: `git cherry` compares commit by commit, so it misses a
// squash of several commits; "the paths are identical on base" fails as soon as a
// later PR edits a shared file (the CHANGELOG); `git merge-tree` conflicts on two
// adjacent CHANGELOG entries. A squash edited at merge time fails closed: unproven is
// not landed.
//
// Usage: node landed.mjs <branch> <base>   → exit 0 landed, 1 not, 2 unresolvable.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const git = (cwd, args, input) => {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 30 })
  return r.status === 0 ? r.stdout : null
}
const RAW = ['--binary', '--no-ext-diff', '--no-color', '--no-textconv']
const patchIds = (cwd, patch) => new Set((git(cwd, ['patch-id', '--stable'], patch) || '')
  .split('\n').map((l) => l.split(' ')[0]).filter(Boolean))

/** true when `branch` is an ancestor of `base`, or its cumulative diff is a commit on
 *  `base` (a squash). null when either ref does not resolve. */
const seen = new Map()
export function landed(branch, base, cwd = '.') {
  const key = `${cwd}\0${branch}\0${base}`
  if (!seen.has(key)) seen.set(key, judge(branch, base, cwd))
  return seen.get(key)
}

function judge(branch, base, cwd) {
  for (const ref of [branch, base]) if (git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) return null
  if (spawnSync('git', ['merge-base', '--is-ancestor', branch, base], { cwd }).status === 0) return true
  const mb = git(cwd, ['merge-base', base, branch])?.trim()
  if (!mb) return false
  // Plumbing-stable text: a user's external diff, colour or textconv would change what
  // patch-id reads, and a real squash would go unrecognised.
  const [own] = patchIds(cwd, git(cwd, ['diff', ...RAW, mb, branch]) || '')
  if (!own) return false // a branch whose changes cancel out proves nothing
  return patchIds(cwd, git(cwd, ['log', '-p', ...RAW, '--format=commit %H', `${mb}..${base}`]) || '').has(own)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [branch, base] = process.argv.slice(2)
  if (!branch || !base) { console.error('usage: landed.mjs <branch> <base>'); process.exit(2) }
  const r = landed(branch, base)
  process.exit(r === null ? 2 : r ? 0 : 1)
}
