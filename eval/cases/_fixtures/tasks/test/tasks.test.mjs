import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { addTask, completeTask, removeTask, nextId, parseId, TaskError } from '../src/tasks.mjs'
import { renderList } from '../src/format.mjs'

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'tasks.mjs')

function cli(file, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, TASKS_FILE: file } })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'tasks-')), 'tasks.json')

test('a task gets the next id and starts open', () => {
  const { state, task } = addTask({ tasks: [{ id: 4, title: 'a', done: false }] }, '  write tests ')
  assert.deepEqual(task, { id: 5, title: 'write tests', done: false })
  assert.equal(state.tasks.length, 2)
})

test('an empty title is refused', () => {
  assert.throws(() => addTask({ tasks: [] }, '   '), TaskError)
})

test('completing twice is refused', () => {
  const { state } = completeTask({ tasks: [{ id: 1, title: 'a', done: false }] }, 1)
  assert.throws(() => completeTask(state, 1), /already done/)
})

test('removing an unknown task is refused', () => {
  assert.throws(() => removeTask({ tasks: [] }, 3), /no task #3/)
})

test('ids are positive integers', () => {
  assert.equal(parseId('7'), 7)
  assert.throws(() => parseId('0'), TaskError)
  assert.throws(() => parseId('x'), TaskError)
  assert.equal(nextId([]), 1)
})

test('the list is sorted by id', () => {
  const text = renderList([{ id: 2, title: 'b', done: true }, { id: 1, title: 'a', done: false }])
  assert.equal(text, '#1   [ ] a\n#2   [x] b')
})

test('the CLI round-trips through the data file', () => {
  const file = tmpFile()
  assert.equal(cli(file, 'add', 'buy', 'milk').status, 0)
  assert.equal(cli(file, 'done', '1').status, 0)
  assert.match(cli(file, 'list').out, /#1 +\[x\] buy milk/)
  assert.equal(cli(file, 'done', '9').status, 1)
  assert.equal(cli(file, 'frobnicate').status, 2)
})

// Users upgrade with their file in place: whatever the format becomes, the file the
// previous release wrote must still open, with its ids and states intact.
test('a file written by the previous release still opens', () => {
  const file = tmpFile()
  writeFileSync(file, readFileSync(new URL('./v1-sample.json', import.meta.url)))
  const r = cli(file, 'list')
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /#1 +\[x\] renew passport/)
  assert.match(r.out, /#3 +\[ \] book dentist/)
})
