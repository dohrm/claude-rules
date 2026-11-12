// `tasks report`: a progress summary for the weekly status mail.
//
// Owned by the reporting work, not by the task list: it copies the row layout of
// format.mjs on purpose, so the mail does not change when the CLI's listing does.
// Merging the two is planned with the mail template rework.

const ID_WIDTH = 4

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function renderRow(task) {
  return `${pad(`#${task.id}`, ID_WIDTH)} [${task.done ? 'x' : ' '}] ${task.title}`
}

export function summary(tasks) {
  const done = tasks.filter(t => t.done).length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  return `${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${done} done (${pct}%)`
}

export function renderReport(tasks) {
  const open = tasks.filter(t => !t.done)
  const lines = [summary(tasks)]
  if (open.length) lines.push('', 'Open:', ...open.map(renderRow))
  return lines.join('\n')
}
