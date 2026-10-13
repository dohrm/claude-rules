// Ownership (ADR-0010): the installer writes only over what it owns, and refuses a tree
// it cannot explain. Black-box, offline (--local), every target.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { runCli, withTmpRepo, read } from './helpers.mjs'

const LOCK = '.claude-rules.lock'
const ok = r => { assert.equal(r.status, 0, `cli failed (${r.status}):\n${r.stderr}${r.stdout}`); return r }

// Every file under `dir`, with its content: what "the tree is untouched" compares.
function snapshot(dir) {
  const out = {}
  const rec = rel => {
    for (const name of readdirSync(join(dir, rel))) {
      const path = rel ? `${rel}/${name}` : name
      if (lstatSync(join(dir, path)).isDirectory()) rec(path)
      else out[path] = read(dir, path)
    }
  }
  rec('')
  return out
}

test('update over an unchanged install rewrites nothing, for every target', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))
  const before = snapshot(dir)
  ok(runCli(['update'], dir))
  assert.deepEqual(snapshot(dir), before)
}))

const sha256 = text => createHash('sha256').update(text).digest('hex')
const ROOTS = ['.claude/rules', '.claude/skills', '.claude/agents', '.agents/rules', '.agents/skills', '.cursor/rules', '.dev/kit']
const owned = lock => Object.assign({}, ...lock.installed.map(i => i.files))

test('the inventory records every file written, with its hash, for every target and kind', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', 'agent', '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))
  const lock = JSON.parse(read(dir, LOCK))
  for (const record of lock.installed) assert.equal(typeof record.files, 'object', `${record.kind} ${record.from} has no files`)
  const files = owned(lock)
  const onDisk = Object.keys(snapshot(dir)).filter(p => ROOTS.some(r => p.startsWith(`${r}/`)))
  assert.deepEqual(Object.keys(files).sort(), onDisk.sort(), 'every installed file, and nothing else')
  for (const [path, digest] of Object.entries(files)) assert.equal(digest, sha256(read(dir, path)), path)
  for (const kind of ['rule', 'skill', 'kit', 'agent'])
    assert.ok(lock.installed.some(i => i.kind === kind && Object.keys(i.files).length), `a ${kind} with files`)
  for (const prefix of ['.claude/rules/', '.cursor/rules/', '.agents/rules/', '.agents/skills/', '.claude/skills/', '.dev/kit/', '.claude/agents/'])
    assert.ok(Object.keys(files).some(p => p.startsWith(prefix)), prefix)
  // Codex's own inventory is the same record, not a second one.
  for (const [path, asset] of Object.entries(lock.codex.files)) assert.equal(files[path], asset.hash, path)
}))

// -------------------------------------------------------- check before writing
// Each case: the run exits 1, lists every path it cannot explain, and changes nothing —
// the lock included.
function refused(dir, args, paths) {
  const before = snapshot(dir)
  const r = runCli(args, dir)
  assert.equal(r.status, 1, `expected a refusal:\n${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /not what claude-rules installed/)
  for (const [path, why] of paths) assert.match(r.stderr, new RegExp(`✗ ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — ${why}`), path)
  assert.deepEqual(snapshot(dir), before, 'tree untouched')
  return r
}
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }

test('an edited installed rule stops update, for every target that copies it', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude,codex,cursor'], dir))
  write(dir, '.claude/rules/rust/code-style.md', 'my edit\n')
  write(dir, '.cursor/rules/rust/code-style.mdc', 'my edit\n')
  write(dir, '.agents/rules/rust/code-style.md', 'my edit\n')
  refused(dir, ['update'], [
    ['.claude/rules/rust/code-style.md', 'edited since it was installed'],
    ['.cursor/rules/rust/code-style.mdc', 'edited since it was installed'],
    ['.agents/rules/rust/code-style.md', 'edited since it was installed'],
  ])
}))

test('a file the installer did not write, where it writes one, stops a first add', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md', 'hand-copied\n')
  refused(dir, ['add', 'rust', '--agent', 'claude'], [['.claude/rules/rust/code-style.md', 'not written by claude-rules']])
}))

test('a foreign file inside an installed skill stops update', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'claude,codex'], dir))
  write(dir, '.claude/skills/rfc/notes.md', 'mine\n')
  write(dir, '.agents/skills/rfc/notes.md', 'mine\n')
  refused(dir, ['update'], [
    ['.claude/skills/rfc/notes.md', 'not written by claude-rules, inside an installed directory'],
    ['.agents/skills/rfc/notes.md', 'not written by claude-rules, inside an installed directory'],
  ])
}))

test('foreign content where a directory goes stops add', () => withTmpRepo(dir => {
  write(dir, '.claude/skills/rfc', 'a file named like the skill\n')
  refused(dir, ['add', 'product', '--agent', 'claude'], [['.claude/skills/rfc', 'a file where a directory goes']])
}))

test('nested destinations: a repo directory where a file goes, a repo file above a destination', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md/mine.md', 'nested under a file destination\n')
  write(dir, '.cursor/rules/rust', 'a file above the destinations\n')
  refused(dir, ['add', 'rust', '--agent', 'claude,cursor'], [
    ['.claude/rules/rust/code-style.md', 'a directory where a file goes'],
    ['.cursor/rules/rust', 'a file where a directory goes'],
  ])
}))

test('a forged inventory path outside the installer\'s roots is refused, and the file survives', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
  write(dir, 'src/main.rs', 'fn main() {}\n')
  const lock = JSON.parse(read(dir, LOCK))
  lock.installed[0].files['src/main.rs'] = sha256('fn main() {}\n')
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  const r = runCli(['update'], dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /records src\/main\.rs — an inventoried file must be a sha256 under/)
  assert.equal(read(dir, 'src/main.rs'), 'fn main() {}\n')
}))
