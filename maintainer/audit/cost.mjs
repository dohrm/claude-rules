// Token cost of every skill and rule in the library, for the audit's `cost` axis.
// Deterministic on purpose: a model estimating tokens gives each auditor its own
// number. Same ~4:1 bytes→tokens heuristic as `claude-rules budget`; the ranking is
// what matters, not the absolute count. Prints Markdown on stdout.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const tok = n => Math.round(n / 4)
const files = dir => readdirSync(dir, { recursive: true }).map(f => join(dir, f)).filter(f => statSync(f).isFile())
const frontmatter = text => text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''
const description = fm => fm.match(/^description:\s*(.*)$/m)?.[1] ?? ''

const skills = readdirSync('skills').map(name => {
  const dir = join('skills', name)
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const extra = files(dir).filter(f => !f.endsWith('SKILL.md'))
  return {
    name,
    desc: Buffer.byteLength(description(frontmatter(text))),
    body: Buffer.byteLength(text),
    extra: extra.reduce((n, f) => n + statSync(f).size, 0),
    extraCount: extra.length,
  }
}).sort((a, b) => b.body + b.extra - (a.body + a.extra))

const rules = files('rules').filter(f => f.endsWith('.md')).map(f => ({
  rel: relative('rules', f),
  size: statSync(f).size,
  scoped: /^paths:/m.test(frontmatter(readFileSync(f, 'utf8'))),
})).sort((a, b) => b.size - a.size)

const sum = xs => xs.reduce((n, x) => n + x, 0)
const always = rules.filter(r => !r.scoped)
const out = []
out.push('# Token cost (~4 bytes per token)', '')
out.push('Paid **per session**: every skill description, plus the unscoped rules of the installed profiles.')
out.push('Paid **per file opened**: rules scoped by `paths:`. Paid **per invocation**: a skill body, then the extra files it reads.', '')
out.push(`- skill descriptions (${skills.length}): ~${tok(sum(skills.map(s => s.desc)))} tokens`)
out.push(`- unscoped rules (${always.length}), if every profile were installed: ~${tok(sum(always.map(r => r.size)))} tokens`)
out.push(`- scoped rules (${rules.length - always.length}): ~${tok(sum(rules.filter(r => r.scoped).map(r => r.size)))} tokens in total`, '')
out.push('## Skills', '', '| skill | description | body | extra files |', '|---|--:|--:|--:|')
for (const s of skills) out.push(`| ${s.name} | ${tok(s.desc)} | ${tok(s.body)} | ${s.extraCount ? `${tok(s.extra)} (${s.extraCount})` : '—'} |`)
out.push('', '## Rules', '', '| rule | loads | tokens |', '|---|---|--:|')
for (const r of rules) out.push(`| ${r.rel} | ${r.scoped ? 'per file' : 'per session'} | ${tok(r.size)} |`)
console.log(out.join('\n'))
