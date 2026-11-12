// Hidden from the agent: copied into the workspace only after the run. Drives the CLI
// alone — the RFC fixes the commands, the file format and the exit codes, never the
// modules — so any implementation of the RFC passes it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'tasks.mjs')
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'oracle-')), 'tasks.json')
const ids = (out) => [...out.matchAll(/#(\d+)/g)].map(m => Number(m[1]))
const V1 = { version: 1, tasks: [{ id: 1, title: 'renew passport', done: true }, { id: 3, title: 'book dentist', done: false }] }

function cli(file, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, TASKS_FILE: file } })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}

test('oracle: a v1 file is read by list, which never writes it', () => {
  const file = tmpFile()
  writeFileSync(file, JSON.stringify(V1))
  const before = readFileSync(file, 'utf8')
  const r = cli(file, 'list')
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(ids(r.out), [1, 3])
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('oracle: the next save writes v2, with every v1 task kept and the counter past its ids', () => {
  const file = tmpFile()
  writeFileSync(file, JSON.stringify(V1))
  assert.equal(cli(file, 'add', 'call bank').status, 0)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(data.version, 2)
  assert.equal(data.nextId, 5)
  const byId = Object.fromEntries(data.tasks.map(t => [t.id, t]))
  assert.deepEqual(Object.keys(byId).map(Number).sort((a, b) => a - b), [1, 3, 4])
  assert.deepEqual([byId[1].title, byId[1].done, byId[1].archived], ['renew passport', true, false])
  assert.deepEqual([byId[3].done, byId[3].archived, byId[4].archived], [false, false, false])
})

test('oracle: archive hides, list --archived shows, restore brings back', () => {
  const file = tmpFile()
  cli(file, 'add', 'a'); cli(file, 'add', 'b'); cli(file, 'add', 'c')
  assert.equal(cli(file, 'archive', '2').status, 0)
  assert.deepEqual(ids(cli(file, 'list').out), [1, 3])
  assert.deepEqual(ids(cli(file, 'list', '--archived').out), [2])
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).tasks.find(t => t.id === 2).archived, true)
  assert.equal(cli(file, 'restore', '2').status, 0)
  assert.deepEqual(ids(cli(file, 'list').out), [1, 2, 3])
  assert.deepEqual(ids(cli(file, 'list', '--archived').out), [])
})

test('oracle: an id is never handed out twice', () => {
  const file = tmpFile()
  cli(file, 'add', 'a'); cli(file, 'add', 'b')
  cli(file, 'archive', '2')
  assert.equal(cli(file, 'add', 'c').status, 0)
  cli(file, 'rm', '3')
  cli(file, 'add', 'd')
  assert.equal(cli(file, 'restore', '2').status, 0)
  const all = JSON.parse(readFileSync(file, 'utf8')).tasks.map(t => t.id).sort((a, b) => a - b)
  assert.deepEqual(all, [1, 2, 4])
})

test('oracle: archive and restore refuse the wrong state and unknown ids with exit 1', () => {
  const file = tmpFile()
  cli(file, 'add', 'a')
  assert.equal(cli(file, 'restore', '1').status, 1)
  assert.equal(cli(file, 'archive', '1').status, 0)
  assert.equal(cli(file, 'archive', '1').status, 1)
  assert.equal(cli(file, 'archive', '7').status, 1)
  assert.equal(cli(file, 'restore', '7').status, 1)
})

test('oracle: done and rm still act on an archived task', () => {
  const file = tmpFile()
  cli(file, 'add', 'a'); cli(file, 'add', 'b')
  cli(file, 'archive', '1')
  assert.equal(cli(file, 'done', '1').status, 0)
  assert.equal(cli(file, 'rm', '1').status, 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).tasks.map(t => t.id), [2])
})

test('oracle: an unknown version, or a counter not above every id, is refused', () => {
  const file = tmpFile()
  writeFileSync(file, JSON.stringify({ version: 3, tasks: [] }))
  const r = cli(file, 'list')
  assert.equal(r.status, 1)
  assert.match(r.err, /\b3\b/)
  for (const nextId of [2, 1]) {
    writeFileSync(file, JSON.stringify({ version: 2, nextId, tasks: [{ id: 2, title: 'a', done: false, archived: false }] }))
    assert.equal(cli(file, 'add', 'b').status, 1, `nextId ${nextId} with id 2 in the file`)
  }
})
