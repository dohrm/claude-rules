#!/usr/bin/env node
// tasks — a to-do list in one JSON file.
//
//   tasks add <title…>   add a task
//   tasks list           every task
//   tasks done <id>      mark a task done
//   tasks rm <id>        delete a task
//   tasks report         progress summary
//
// The file is `TASKS_FILE`, else ./tasks.json. Exit codes: 0 ok, 1 refused (a task
// or file error), 2 usage.
import { dataFile, load, save, StoreError } from '../src/store.mjs'
import { addTask, completeTask, removeTask, parseId, TaskError } from '../src/tasks.mjs'
import { renderList, renderTask } from '../src/format.mjs'
import { renderReport } from '../src/report.mjs'

const USAGE = 'usage: tasks <add <title…> | list | done <id> | rm <id> | report>'

function run(argv, file) {
  const [command, ...args] = argv
  switch (command) {
    case 'add': {
      const { state, task } = addTask(load(file), args.join(' '))
      save(file, state)
      return `added ${renderTask(task)}`
    }
    case 'list':
      return renderList(load(file).tasks)
    case 'done': {
      const { state, task } = completeTask(load(file), parseId(args[0]))
      save(file, state)
      return `done ${renderTask(task)}`
    }
    case 'rm': {
      const { state, task } = removeTask(load(file), parseId(args[0]))
      save(file, state)
      return `removed #${task.id}`
    }
    case 'report':
      return renderReport(load(file).tasks)
    default:
      return null
  }
}

try {
  const out = run(process.argv.slice(2), dataFile())
  if (out === null) {
    console.error(USAGE)
    process.exit(2)
  }
  console.log(out)
} catch (e) {
  if (!(e instanceof TaskError || e instanceof StoreError)) throw e
  console.error(`tasks: ${e.message}`)
  process.exit(1)
}
