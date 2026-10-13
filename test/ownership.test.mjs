// Ownership (ADR-0010): the installer writes only over what it owns, and refuses a tree
// it cannot explain. Black-box, offline (--local), every target.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
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
