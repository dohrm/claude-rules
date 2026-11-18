// The managed block of the root `.gitattributes`: every installed copy is marked
// `linguist-generated`, so a forge collapses it in a pull request's diff. The block is a
// pure function of the lock's inventory; outside its markers the file is the repo's.
import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { safePath } from './ownership.mjs'
import { parts } from './codex.mjs'

export const FILE = '.gitattributes'
export const START = '# claude-rules:start (managed — do not edit inside this block)'
export const END = '# claude-rules:end'
const COMMENT = '# Installed claude-rules copies, collapsed in forge diffs: review an update through .claude-rules.lock and the CHANGELOG.'
// What a pattern line can hold without quoting or glob meaning in git.
const EXPRESSIBLE = /^[A-Za-z0-9._/@+-]+$/

// Four segments or more → the first three as a directory; shorter → the file itself.
// `skipped`: the paths no pattern line can express, left out of the block.
export function patternsOf(paths) {
  const patterns = new Set(), skipped = []
  for (const path of paths) {
    const segments = path.split('/')
    const stem = segments.length >= 4 ? segments.slice(0, 3).join('/') : path
    if (!EXPRESSIBLE.test(stem)) { skipped.push(path); continue }
    patterns.add(segments.length >= 4 ? `${stem}/**` : stem)
  }
  return { patterns: [...patterns].sort(), skipped }
}

export const blockText = patterns => [START, COMMENT, ...patterns.map(p => `${p} linguist-generated=true`), END].join('\n')

// Reads and refuses; writes nothing. `paths`: the inventory of the lock being written.
// `action`: 'write', 'delete', or null when the file already says what it should.
export function prepareGitattributes(paths) {
  const { patterns, skipped } = patternsOf(paths)
  safePath(FILE)
  const exists = existsSync(FILE)
  if (exists && !lstatSync(FILE).isFile()) throw new Error(`Not a regular file: ${FILE}; no files changed`)
  const text = exists ? readFileSync(FILE, 'utf8') : ''
  const split = parts(text, FILE, START, END)
  let content = text
  if (patterns.length) {
    const block = blockText(patterns)
    content = split ? split.before + block + split.after : text + (text && !text.endsWith('\n') ? '\n' : '') + block + '\n'
  } else if (split) content = split.before + split.after.replace(/^\n/, '')   // the newline the installer wrote after it
  const action = content === text ? null : content.trim() ? 'write' : 'delete'
  return { content, action, skipped }
}

export function applyGitattributes(plan) {
  if (plan.action === 'write') writeFileSync(FILE, plan.content)
  else if (plan.action === 'delete') rmSync(FILE)
  return plan.action
}
