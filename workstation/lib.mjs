// Shared reading layer for `bench` and `fleet`.
//
// Everything here is READ-ONLY on a bench's tree and NEVER throws on a bench that
// is missing, moved, or half-written: a dashboard that fails is a dashboard nobody
// runs. The worklist/verdict parsers are deliberate duplicates of
// kit/common/worktree-status.mjs — that file must stay a standalone, dependency-free
// script installed INTO a repo, and this one lives outside every repo. Two readers,
// one contract; when the contract moves, both move.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── the registry ───────────────────────────────────────────────────────────
// One JSON file per bench, so two `bench start` in parallel can never race on a
// shared file, and pruning a dead record is one unlink.

export const REGISTRY = join(
  process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
  'claude-rules', 'benches',
)

const recordFile = (name) => join(REGISTRY, `${encodeURIComponent(name)}.json`)

/** Bench names double as zellij session names and as filenames. */
export function validName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

export function readBenches() {
  let names
  try {
    names = readdirSync(REGISTRY).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const file of names) {
    try {
      const rec = JSON.parse(readFileSync(join(REGISTRY, file), 'utf8'))
      if (rec && typeof rec.name === 'string' && typeof rec.path === 'string') out.push(rec)
    } catch { /* a truncated record is noise, not a reason to fail */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function writeBench(rec) {
  mkdirSync(REGISTRY, { recursive: true })
  writeFileSync(recordFile(rec.name), `${JSON.stringify(rec, null, 2)}\n`)
}

export function removeBench(name) {
  try {
    unlinkSync(recordFile(name))
    return true
  } catch {
    return false
  }
}

// ── git ────────────────────────────────────────────────────────────────────

/** git in `cwd`, stdout trimmed, or null when it exits non-zero. */
export function git(cwd, ...argv) {
  try {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+$/, '')
  } catch {
    return null
  }
}

/** The trunk to count commits against: what the remote calls its default, else a guess. */
export function baseRef(cwd) {
  const head = git(cwd, 'rev-parse', '--abbrev-ref', 'origin/HEAD')
  if (head) return head
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master'])
    if (git(cwd, 'rev-parse', '--verify', '--quiet', candidate) !== null) return candidate
  return null
}

// ── zellij ─────────────────────────────────────────────────────────────────

/** Zellij session names, split two ways because the two answers differ:
 *
 *  - `live`   — actually running. This is what makes a bench "live" vs "dormant".
 *  - `known`  — live OR exited. An exited session still OWNS its name, so this is
 *               what decides `zellij attach` (resurrect) vs `zellij --session` (create).
 *
 *  Returns null when zellij is absent or has no sessions at all — not an error:
 *  a bench registered from a GUI host has no session, and that is a valid state. */
export function sessions() {
  let out
  try {
    out = execFileSync('zellij', ['list-sessions', '-n'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
  const live = new Set()
  const known = new Set()
  for (const line of out.split('\n')) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue
    known.add(name)
    if (!line.includes('EXITED')) live.add(name)
  }
  return { live, known }
}

// ── the state files a loop writes ──────────────────────────────────────────

const VERDICTS = ['CLEAN', 'WARNINGS', 'CRITICAL']
const VERDICT_MARKER = /^<!--\s*CI_VERDICT:\s*(.*?)\s*-->\s*$/gm
const REVIEWED_MARKER = /^<!--\s*REVIEWED:\s*(.*?)\s*-->\s*$/gm
const SHA = /^[0-9a-f]{7,40}$/

const lastMatch = (re, text) => {
  re.lastIndex = 0
  let m, out = null
  while ((m = re.exec(text)) !== null) out = m[1]
  return out
}

/** What `just review-guard` would say in this tree. A REPORT of a gate, never the gate. */
export function reviewState(path) {
  const file = join(path, '.work', 'review-report.md')
  if (!existsSync(file)) return '—'
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 'unreadable'
  }
  const verdict = lastMatch(VERDICT_MARKER, text)
  const sha = lastMatch(REVIEWED_MARKER, text)
  if (!VERDICTS.includes(verdict) || !sha || !SHA.test(sha)) return 'malformed'
  if (verdict === 'CRITICAL') return 'CRITICAL'
  const head = git(path, 'rev-parse', 'HEAD')
  if (head && (head.startsWith(sha) || sha.startsWith(head))) return verdict
  return `${verdict} (stale)`
}

/** The blockers under `## Blocked on the human`, one entry per list item.
 *
 *  A real escalation is a paragraph, not a line — `hal` has eighty of them. So the
 *  unit here is the ITEM (a `- ` bullet plus its continuation lines), collapsed to
 *  one string. `fleet` then prints the head of the first few and points at the file:
 *  it reports THAT you are blocked and WHERE to read, it does not try to be the
 *  reader. Placeholders left over from the loop-setup template are not blockers. */
function blockedIn(text) {
  const start = text.search(/^##\s+Blocked on the human\s*$/mi)
  if (start === -1) return []
  const section = text
    .slice(start)
    .replace(/^##[^\n]*\n/, '')
    .split(/^##\s/m)[0]
    .replace(/<!--[\s\S]*?-->/g, '')

  const entries = []
  for (const raw of section.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^[-*]\s+/.test(raw.trimStart())) entries.push(line.replace(/^[-*]\s+/, ''))
    else if (entries.length) entries[entries.length - 1] += ` ${line}`
    else entries.push(line) // prose with no bullet: still an escalation
  }
  return entries
    // `**` and backticks are emphasis and go. A LONE `*` stays: these escalations
    // are full of globs, and `deploy/**/*.rs` stripped of every asterisk reads as
    // a different path.
    .map((e) => e.replace(/\s+/g, ' ').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter((e) => e && !/^<[^>]*>$/.test(e))
}

/** Checked / total items across the whole worklist, ignoring template placeholders. */
function progressIn(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '')
  const items = [...body.matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.*)$/gm)]
    .filter(([, , label]) => label.trim() && !/^<[^>]*>$/.test(label.trim()))
  if (!items.length) return null
  return { done: items.filter(([, mark]) => mark !== ' ').length, total: items.length }
}

/** Every file a loop escalates in, under `.work/<slug>/`. Newest label sorts last. */
function worklists(root) {
  const found = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    const add = (rel) => found.push({ label: `${slug}/${rel.replace(/\.md$/, '')}`, path: join(root, slug, ...rel.split('/')) })
    if (existsSync(join(root, slug, 'loop.md'))) add('loop.md')
    try {
      for (const n of readdirSync(join(root, slug, 'tasks'))) if (/\.md$/.test(n)) add(`tasks/${n}`)
    } catch { /* planned, not cut yet */ }
  }
  return found.sort((a, b) => a.label.localeCompare(b.label))
}

/** The newest worklist in a bench: its label, progress, mtime, and what blocks it.
 *  `mtime` is the liveness signal that works on every host — a state file untouched
 *  for an hour is a loop that stopped, whatever wrote it. */
export function loopState(path) {
  let found = []
  try {
    found = worklists(join(path, '.work'))
  } catch {
    return { label: '—', file: null, progress: null, mtime: null, blocked: [] }
  }
  if (!found.length) return { label: '—', file: null, progress: null, mtime: null, blocked: [] }
  const newest = found[found.length - 1]
  let text = ''
  try {
    text = readFileSync(newest.path, 'utf8')
  } catch { /* unreadable: report the label, claim nothing about the content */ }
  let mtime = null
  try {
    mtime = statSync(newest.path).mtimeMs
  } catch { /* gone between readdir and stat */ }
  return {
    label: newest.label + (found.length > 1 ? ` +${found.length - 1}` : ''),
    file: newest.path,
    progress: progressIn(text),
    mtime,
    blocked: blockedIn(text),
  }
}

/** Coarse, glanceable age. Precision past the unit is noise on a dashboard. */
export function age(mtime) {
  if (!mtime) return '—'
  const min = Math.max(0, Math.round((Date.now() - mtime) / 60000))
  if (min < 60) return `${min}m`
  if (min < 60 * 48) return `${Math.round(min / 60)}h`
  return `${Math.round(min / 1440)}d`
}
