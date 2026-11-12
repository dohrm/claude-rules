// Persistence of the task list: one JSON file, format version 1.
//
//   { "version": 1, "tasks": [ { "id": 1, "title": "…", "done": false } ] }
//
// A missing file is an empty list; any other unreadable file is an error, never
// silently replaced — it holds the user's tasks.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'

export const VERSION = 1

/** The data file: `TASKS_FILE`, else `tasks.json` in the current directory. */
export function dataFile(env = process.env) {
  return env.TASKS_FILE || 'tasks.json'
}

export class StoreError extends Error {}

export function load(file) {
  if (!existsSync(file)) return { version: VERSION, tasks: [] }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new StoreError(`${file}: not valid JSON (${e.message})`)
  }
  if (data === null || typeof data !== 'object') throw new StoreError(`${file}: not a task list`)
  if (data.version !== VERSION) {
    throw new StoreError(`${file}: unsupported format version ${JSON.stringify(data.version)} (expected ${VERSION})`)
  }
  if (!Array.isArray(data.tasks)) throw new StoreError(`${file}: "tasks" must be an array`)
  data.tasks.forEach((t, i) => validateTask(t, `${file}: tasks[${i}]`))
  return { version: VERSION, tasks: data.tasks }
}

function validateTask(task, where) {
  if (task === null || typeof task !== 'object') throw new StoreError(`${where}: not an object`)
  if (!Number.isInteger(task.id) || task.id < 1) throw new StoreError(`${where}: "id" must be a positive integer`)
  if (typeof task.title !== 'string' || !task.title.trim()) throw new StoreError(`${where}: "title" must be a non-empty string`)
  if (typeof task.done !== 'boolean') throw new StoreError(`${where}: "done" must be a boolean`)
}

/** Writes through a temporary file and a rename: a crash mid-write leaves the previous file whole. */
export function save(file, data) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: VERSION, tasks: data.tasks }, null, 2) + '\n')
  renameSync(tmp, file)
}
