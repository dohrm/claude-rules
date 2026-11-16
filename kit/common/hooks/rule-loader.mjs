#!/usr/bin/env node
// rule-loader — Codex hook (PreToolUse on Bash|apply_patch, SessionStart).
//
// Codex reads the path-scoped rules only because AGENTS.md asks it to. This hook
// hands a rule to the model when the session touches a file its globs match:
//
//   apply_patch  paths are exact (the patch headers) → an unloaded matching rule
//                DENIES the patch once, with the rules as the reason; the retry passes.
//   Bash         paths are guessed from the command's tokens → a match INJECTS the
//                rules as additionalContext and never blocks: a read is never refused
//                on a guess.
//
// Rules come from `codex.rules` in .claude-rules.lock (root-relative globs, written
// by the installer), re-read on every call. A rule is delivered once per session:
// the delivered rule files are kept in a state file under the OS temp directory,
// keyed by session_id, never inside the repository. SessionStart `compact` clears it,
// because compaction may drop the injected text.
//
// Fails open: an unreadable payload, no lock, a lock without codex.rules, a rule file
// missing on disk or a patch path outside the repo root answers nothing (exit 0, one
// line on stderr). When the state file cannot be written it injects instead of
// denying — a deny it cannot remember would block the patch forever.
//
// Plain Node, no dependency, no import from the installer: the kit is copied into
// consuming repos.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const LOCK = '.claude-rules.lock'
const INLINE_BUDGET = 6 * 1024   // Codex spills hook output to disk at about 2,500 tokens

// Copy of globToRe in bin/glob.mjs — test/rule-loader.test.mjs runs both on one
// table. Covers `**/`, `**`, `*`, `?`, `{a,b}`.
function globToRe(glob) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re = '', i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3 } else { re += '.*'; i += 2 }
    } else if (c === '*') { re += '[^/]*'; i += 1 }
    else if (c === '?') { re += '[^/]'; i += 1 }
    else if (c === '{' && glob.includes('}', i)) {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map(esc).join('|') + ')'
      i = end + 1
    } else { re += esc(c); i += 1 }
  }
  return new RegExp(`^${re}$`)
}

class Refusal extends Error {}
const refuse = msg => { throw new Refusal(msg) }

function findRoot(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, LOCK))) return dir
    if (dirname(dir) === dir) return null
  }
}

// Root-relative POSIX path, or null when it lies outside the root.
function inRoot(root, cwd, path) {
  const rel = relative(root, resolve(cwd, path))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

function patchPaths(patch) {
  const out = []
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/gm)) out.push(m[1])
  return out
}

// Path-like tokens of a shell command: split on whitespace and operators, unquoted,
// `--flag=value` reduced to its value. Heuristic on purpose — it only ever injects.
function shellPaths(command) {
  const out = []
  for (let tok of command.split(/[\s;|&()<>]+/)) {
    tok = tok.replace(/^['"]+|['"]+$/g, '').replace(/^-[^=]*=/, '')
    if (!tok || tok.startsWith('-') || /[$`*?{}]/.test(tok) || /^[a-z]+:\/\//i.test(tok)) continue
    if (tok.includes('/') || /\.[A-Za-z0-9]+$/.test(tok)) out.push(tok)
  }
  return out
}

// One delivered rule file per line, appended: Codex may run tool calls in parallel, and
// an append of a short line does not lose a concurrent one the way a rewrite would.
const statePath = session => join(tmpdir(), 'claude-rules-rule-loader', createHash('sha256').update(session).digest('hex'))

function readState(file) {
  let lines
  try { lines = readFileSync(file, 'utf8').split('\n').filter(Boolean) } catch { return { loaded: [], clean: true } }
  const loaded = lines.filter(l => isAbsolute(l))
  return { loaded, clean: loaded.length === lines.length }
}

// A file holding anything but paths is rewritten whole; otherwise the new lines are appended.
function writeState(file, state, add) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const lines = add.map(p => `${p}\n`).join('')
    if (state.clean) appendFileSync(file, lines)
    else writeFileSync(file, state.loaded.map(p => `${p}\n`).join('') + lines)
    return true
  } catch { return false }
}

const body = text => text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

// Rule bodies inline while the answer stays under INLINE_BUDGET; the rest as paths.
function render(rules, root) {
  const inline = [], pointers = []
  let used = 0
  for (const r of rules) {
    const text = `## ${r.title} (${r.path})\n\n${body(readFileSync(r.abs, 'utf8'))}\n`
    const n = Buffer.byteLength(text)
    if (!pointers.length && used + n <= INLINE_BUDGET) { inline.push(text); used += n } else pointers.push(r.path)
  }
  let out = inline.join('\n')
  if (pointers.length) out += `${out ? '\n' : ''}Read these rules before going on (paths relative to ${root}):\n${pointers.map(p => `- ${p}`).join('\n')}\n`
  return out
}

function answer(payload) {
  if (payload.hook_event_name === 'SessionStart') {
    if (payload.source === 'compact' && typeof payload.session_id === 'string' && payload.session_id)
      rmSync(statePath(payload.session_id), { force: true })
    return null
  }
  if (payload.hook_event_name !== 'PreToolUse') return null
  const tool = payload.tool_name, command = payload.tool_input?.command
  if ((tool !== 'apply_patch' && tool !== 'Bash') || typeof command !== 'string') return null
  if (typeof payload.cwd !== 'string' || !payload.cwd) refuse('payload has no cwd')

  const root = findRoot(payload.cwd)
  if (!root) refuse(`no ${LOCK} at or above ${payload.cwd}`)
  let lock
  try { lock = JSON.parse(readFileSync(join(root, LOCK), 'utf8')) } catch (e) { refuse(`${LOCK} unreadable: ${e.message}`) }
  if (!Array.isArray(lock?.codex?.rules)) refuse(`${LOCK} has no codex.rules — is Codex an installed target?`)

  let paths
  if (tool === 'apply_patch') {
    paths = patchPaths(command).map(p => inRoot(root, payload.cwd, p) ?? refuse(`patch path outside the repository root: ${p}`))
  } else {
    paths = shellPaths(command).map(p => inRoot(root, payload.cwd, p)).filter(Boolean)
  }
  if (!paths.length) return null

  const matched = []
  for (const r of lock.codex.rules) {
    if (!r || typeof r.path !== 'string' || !Array.isArray(r.globs) || !r.globs.length) continue
    if (!r.globs.some(g => { const re = globToRe(g); return paths.some(p => re.test(p)) })) continue
    if (inRoot(root, root, r.path) === null) refuse(`rule path outside the repository root: ${r.path}`)
    const abs = resolve(root, r.path)
    if (!existsSync(abs) || !statSync(abs).isFile()) refuse(`rule file missing on disk: ${r.path}`)
    matched.push({ path: r.path, title: typeof r.title === 'string' ? r.title : r.path, abs })
  }

  const session = typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : null
  const file = session && statePath(session)
  const state = file ? readState(file) : { loaded: [], clean: true }
  const pending = matched.filter(r => !state.loaded.includes(r.abs))
  if (!pending.length) return null

  const remembered = file ? writeState(file, state, pending.map(r => r.abs)) : false
  const rules = render(pending, root)
  if (tool === 'apply_patch' && remembered) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `claude-rules: this patch touches files governed by rules not yet loaded in this session. Apply them, then send the same patch again — it will not be stopped twice.\n\n${rules}` } }
  }
  if (tool === 'apply_patch') process.stderr.write('rule-loader: session state not writable — injecting instead of denying\n')
  return { hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: `claude-rules: rules that govern files this ${tool === 'Bash' ? 'command reads' : 'patch touches'} — apply them to any edit of those files.\n\n${rules}` } }
}

let payload
try { payload = JSON.parse(readFileSync(0, 'utf8')) } catch (e) {
  process.stderr.write(`rule-loader: unreadable payload, nothing loaded (${e.message})\n`)
  process.exit(0)
}
try {
  const out = answer(payload ?? {})
  if (out) process.stdout.write(JSON.stringify(out))
} catch (e) {
  process.stderr.write(`rule-loader: ${e instanceof Refusal ? e.message : `unexpected error, nothing loaded (${e.message})`}\n`)
}
process.exit(0)
