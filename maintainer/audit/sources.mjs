// Index of every skill in the pinned inspiration clones, for the audit's `harvest`
// mode: name + description, one row per skill, so an auditor picks what to read in
// full instead of sampling. Some sources ship one skill per harness; a name is
// listed once per source, from its shortest path. Prints Markdown on stdout.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'

const root = process.argv[2] ?? '.work/audit-sources'
const skillFiles = dir => readdirSync(dir, { recursive: true })
  .filter(f => basename(f) === 'SKILL.md' && !f.split('/').includes('.git'))
  .map(f => join(dir, f))
  .filter(f => statSync(f).isFile())
// A YAML block scalar (`>-`, `|`) carries its value on the indented lines that follow.
const field = (text, key) => {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)\\n((?:[ \\t]+.*\\n)*)`, 'm'))
  if (!m) return ''
  const value = /^[>|][-+]?$/.test(m[1]) ? m[2].replace(/\s+/g, ' ').trim() : m[1]
  return value.replace(/^["']|["']$/g, '')
}
const cell = s => s.replace(/\|/g, '\\|').slice(0, 240)

const out = ['# Inspiration skills', '', 'One row per skill name and source. Read a description first; open the file only for a candidate.', '']
for (const source of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const dir = join(root, source)
  const byName = new Map()
  for (const file of skillFiles(dir).sort((a, b) => a.length - b.length)) {
    const text = readFileSync(file, 'utf8')
    const name = field(text, 'name') || basename(dirname(file))
    if (!byName.has(name)) byName.set(name, { path: relative(root, file), description: field(text, 'description') })
  }
  out.push(`## ${source} (${byName.size})`, '', '| skill | description | path |', '|---|---|---|')
  for (const [name, s] of [...byName].sort()) out.push(`| ${cell(name)} | ${cell(s.description)} | ${s.path} |`)
  out.push('')
}
console.log(out.join('\n'))
