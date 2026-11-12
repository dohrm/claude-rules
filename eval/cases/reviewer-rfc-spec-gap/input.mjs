// Archive and restore — step 1 of the RFC in .work/archive/rfc.md.
//
// An archived task leaves `tasks` for `archived`, so `list` no longer shows it; a
// restored one moves back. Both are pure, like the operations in src/tasks.mjs.
import { findTask, TaskError } from './src/tasks.mjs'

export function archiveTask(state, id) {
  const task = findTask(state, id)
  return {
    state: { ...state, tasks: state.tasks.filter(t => t.id !== id), archived: [...(state.archived || []), task] },
    task,
  }
}

export function restoreTask(state, id) {
  const archived = state.archived || []
  const task = archived.find(t => t.id === id)
  if (!task) throw new TaskError(`no archived task #${id}`)
  return {
    state: { ...state, tasks: [...state.tasks, task], archived: archived.filter(t => t.id !== id) },
    task,
  }
}
