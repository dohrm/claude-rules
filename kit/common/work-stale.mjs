#!/usr/bin/env node

// work-stale — what `.work/` still holds for work that is over (#57). Two kinds:
//
// - a marker-only directory: nothing, or nothing but per-developer gate files (`.latest_review`,
//   `.latest_mutate`, `review-context.md`, all gitignored), no state file, no local
//   branch that resolves to it (`work-slug.mjs`: the branch name sanitized, or a phase
//   branch `phase/<dir>/<n>`), and no unlanded local branch that contains a commit its
//   files name. That last test keeps an RFC's directory alive between the commit that
//   deletes its `rfc.md` and the merge: its slug is no branch's name, but its review
//   marker is that branch's commit. Every gate run on a branch leaves one, and nothing
//   else ever removed it. `--prune` deletes them: untracked, so no shared state is lost.
// - a state file (`rfc.md`, `defect.md`) whose `**Branch**` is gone, or
//   has landed on `base` (`landed.mjs`). The PR that ends the work deletes it now
//   (`/rfc`, `/defect`); this points at the ones that predate that. It is committed,
//   so it is reported and never deleted here: removing it is a commit.
//
// Usage: node work-stale.mjs [--prune] [base]   (default base origin/main). Exit 0.

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headerOf, sanitize } from './work-slug.mjs'
import { landed } from './landed.mjs'

const PRIVATE = new Set(['.latest_review', '.latest_mutate', 'review-context.md'])
const STATE = ['rfc.md', 'defect.md']
const BRANCH = /^[ \t]*-[ \t]*\*\*Branch\*\*:[ \t]*`?([^`\s]+)`?/m

// The commits a gate file names: a marker holds a sha, the ticket cache says `at <sha>`.
const SHAS = /\b[0-9a-f]{40}\b/g

/** Does an unlanded local branch still contain a commit that `dir`'s gate files name? */
function claimed(cwd, dir, files, base) {
  const shas = new Set(files.flatMap((f) => {
    try {
      return readFileSync(join(dir, f), 'utf8').slice(0, 4096).match(SHAS) || []
    } catch {
      return []
    }
  }))
  for (const sha of shas) {
    const holders = (spawnSync('git', ['branch', '--format=%(refname:short)', '--contains', sha], { cwd, encoding: 'utf8' })
      .stdout || '').split('\n').filter(Boolean)
    if (holders.some((b) => landed(b, base, cwd) !== true)) return true
  }
  return false
}

const refs = (cwd, ...patterns) => (spawnSync('git', ['for-each-ref', '--format=%(refname:short)', ...patterns],
  { cwd, encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean)

/** `{ markerOnly: [dir], landedState: [{ file, branch, why }] }` for `<cwd>/.work`. */
export function staleWork(cwd = '.', base = 'origin/main') {
  const root = join(cwd, '.work')
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return { markerOnly: [], landedState: [] }
  }
  const local = refs(cwd, 'refs/heads')
  const live = new Set(local.flatMap((b) => [sanitize(b), b.match(/^phase\/([^/]+)\/[^/]+$/)?.[1]]).filter(Boolean))
  const known = new Set([...local, ...refs(cwd, 'refs/remotes').map((r) => r.replace(/^[^/]+\//, ''))])
  const markerOnly = [], landedState = []
  for (const { name } of entries) {
    let inside
    try {
      inside = readdirSync(join(root, name), { withFileTypes: true })
    } catch {
      continue // unreadable: someone else's, and `just status` must never crash on it
    }
    if (inside.every((e) => e.isFile() && PRIVATE.has(e.name))) {
      if (!live.has(name) && !claimed(cwd, join(root, name), inside.map((e) => e.name), base)) markerOnly.push(name)
      continue
    }
    for (const file of STATE.filter((f) => inside.some((e) => e.isFile() && e.name === f))) {
      let head
      try {
        head = headerOf(readFileSync(join(root, name, file), 'utf8'))
      } catch {
        continue
      }
      // An RFC not started yet carries no branch name — a placeholder, `—`: nothing to judge.
      const branch = head.match(BRANCH)?.[1]
      if (!branch || !/^[\w./-]+$/.test(branch)) continue
      const why = !known.has(branch) ? 'branch gone' : landed(branch, base, cwd) ? `landed on ${base}` : null
      if (why) landedState.push({ file: `.work/${name}/${file}`, branch, why })
    }
  }
  return { markerOnly: markerOnly.sort(), landedState }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const prune = args.includes('--prune')
  const base = args.find((a) => !a.startsWith('--')) ?? 'origin/main'
  const { markerOnly, landedState } = staleWork('.', base)
  for (const dir of markerOnly) {
    if (prune) rmSync(join('.work', dir), { recursive: true, force: true })
    console.log(`${prune ? '✗' : '•'} .work/${dir}/  (gate markers only, no branch)`)
  }
  for (const s of landedState) console.log(`• ${s.file}  (${s.branch}: ${s.why}) — delete it in a commit`)
  if (!markerOnly.length && !landedState.length) console.log('.work/: nothing stale.')
}
