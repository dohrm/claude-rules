// The task list's operations. Pure: each takes a state and returns a new one, so the
// CLI is the only place that touches the disk.

export class TaskError extends Error {}

/** One past the highest id in the list — 1 for an empty list. */
export function nextId(tasks) {
  return tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1
}

export function parseId(raw) {
  const id = Number(raw)
  if (!Number.isInteger(id) || id < 1) throw new TaskError(`not a task id: ${JSON.stringify(raw)}`)
  return id
}

export function findTask(state, id) {
  const task = state.tasks.find(t => t.id === id)
  if (!task) throw new TaskError(`no task #${id}`)
  return task
}

export function addTask(state, title) {
  const clean = (title || '').trim()
  if (!clean) throw new TaskError('a task needs a title')
  const task = { id: nextId(state.tasks), title: clean, done: false }
  return { state: { ...state, tasks: [...state.tasks, task] }, task }
}

export function completeTask(state, id) {
  const task = findTask(state, id)
  if (task.done) throw new TaskError(`task #${id} is already done`)
  const done = { ...task, done: true }
  return { state: { ...state, tasks: state.tasks.map(t => (t.id === id ? done : t)) }, task: done }
}

export function removeTask(state, id) {
  const task = findTask(state, id)
  return { state: { ...state, tasks: state.tasks.filter(t => t.id !== id) }, task }
}
