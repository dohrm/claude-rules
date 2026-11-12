// How the CLI prints tasks. One line per task: `#<id> [x] <title>`.

const ID_WIDTH = 4

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function renderTask(task) {
  return `${pad(`#${task.id}`, ID_WIDTH)} [${task.done ? 'x' : ' '}] ${task.title}`
}

export function renderList(tasks, empty = 'no tasks') {
  if (!tasks.length) return empty
  return [...tasks].sort((a, b) => a.id - b.id).map(renderTask).join('\n')
}
