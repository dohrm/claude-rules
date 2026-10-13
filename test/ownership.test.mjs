// Ownership (ADR-0010): the installer writes only over what it owns, and refuses a tree
// it cannot explain. Black-box, offline (--local), every target.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
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
