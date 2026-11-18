// The managed `.gitattributes` block: installed copies marked linguist-generated, so a
// forge collapses them in an update's pull request. Outside the markers the file is the
// repo's, byte for byte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, runCli, runCliBare, withTmpRepo, read, has, fixtureGit } from './helpers.mjs'
import { patternsOf } from '../bin/gitattributes.mjs'

const ok = r => { assert.equal(r.status, 0, r.stderr + r.stdout); return r }
const START = '# claude-rules:start (managed — do not edit inside this block)'
const END = '# claude-rules:end'
const ATTR = '.gitattributes'
const lock = dir => JSON.parse(read(dir, '.claude-rules.lock'))
const inventory = dir => {
  const l = lock(dir)
  return [...new Set([...Object.keys(l.codex?.files || {}), ...l.installed.flatMap(r => Object.keys(r.files))])]
}
const block = text => text.slice(text.indexOf(START), text.indexOf(END) + END.length)
const add = (dir, ...profiles) => ok(runCli(['add', ...(profiles.length ? profiles : ['agent', 'rust']), '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))

// ------------------------------------------------------------ the pattern function
test('patterns: four segments or more become the first three as a directory, shorter stays the file', () => {
  const { patterns, skipped } = patternsOf([
    '.claude/skills/rfc/SKILL.md', '.claude/skills/rfc/ticket.md', '.claude/agents/code-reviewer.md',
    '.dev/kit/common/hooks/guard.mjs', '.dev/kit/CHANGELOG.md', '.agents/rules/agent/autonomy.md',
  ])
  assert.deepEqual(patterns, ['.agents/rules/agent/**', '.claude/agents/code-reviewer.md', '.claude/skills/rfc/**', '.dev/kit/CHANGELOG.md', '.dev/kit/common/**'])
  assert.deepEqual(skipped, [])
})

test('patterns: a path no pattern line can express is left out, a deeper odd name is covered by its directory', () => {
  const { patterns, skipped } = patternsOf(['.claude/skills/my skill/SKILL.md', '.claude/agents/a*b.md', '.claude/skills/rfc/odd name.md'])
  assert.deepEqual(patterns, ['.claude/skills/rfc/**'])
  assert.deepEqual(skipped, ['.claude/skills/my skill/SKILL.md', '.claude/agents/a*b.md'])
})

// ------------------------------------------------------------------- lifecycle
test('created: an absent .gitattributes is written with the block only, one pattern per inventoried path', () => withTmpRepo(dir => {
  add(dir)
  const text = read(dir, ATTR)
  assert.ok(text.startsWith(START + '\n'), text)
  assert.ok(text.endsWith(END + '\n'), text)
  assert.equal(text, block(text) + '\n')
  const lines = text.split('\n').filter(l => l && !l.startsWith('#'))
  assert.ok(lines.length > 0)
  for (const line of lines) assert.match(line, /^\S+ linguist-generated=true$/)
  assert.deepEqual(lines.map(l => l.split(' ')[0]), patternsOf(inventory(dir)).patterns)
  assert.ok(lines.includes('.claude/skills/debrief/** linguist-generated=true'))
  assert.ok(lines.includes('.claude/agents/code-reviewer.md linguist-generated=true'))
  assert.equal(text.split('\n').filter(l => l.startsWith('#')).length, 3, 'markers plus one comment line')
}))

test('git sees the block: every inventoried path is generated, the lock, AGENTS.md and the repo\'s own file are not', () => withTmpRepo(dir => {
  fixtureGit(dir, ['init', '-q'])
  add(dir)
  writeFileSync(join(dir, 'main.rs'), 'fn main() {}\n')
  const paths = inventory(dir)
  const out = fixtureGit(dir, ['check-attr', '--stdin', 'linguist-generated'], [...paths, '.claude-rules.lock', 'AGENTS.md', 'main.rs'].join('\n') + '\n')
  const answer = Object.fromEntries(out.split('\n').map(l => { const [path, , value] = l.split(': '); return [path, value] }))
  for (const path of paths) assert.equal(answer[path], 'true', path)
  for (const path of ['.claude-rules.lock', 'AGENTS.md', 'main.rs']) assert.equal(answer[path], 'unspecified', path)
}))

test('already there, no markers: the block is appended and every byte before it kept', () => withTmpRepo(dir => {
  const mine = '*.png binary\r\n# mine\r\n'
  writeFileSync(join(dir, ATTR), mine)
  add(dir)
  const text = read(dir, ATTR)
  assert.ok(text.startsWith(mine))
  assert.equal(text, mine + block(text) + '\n')
}))

test('already there, no trailing newline: one newline goes before the block', () => withTmpRepo(dir => {
  writeFileSync(join(dir, ATTR), '*.png binary')
  add(dir)
  const text = read(dir, ATTR)
  assert.equal(text, '*.png binary\n' + block(text) + '\n')
}))

test('already there, one block: replaced in place, a hand edit inside overwritten, the rest untouched', () => withTmpRepo(dir => {
  add(dir)
  const expected = read(dir, ATTR)
  writeFileSync(join(dir, ATTR), `*.png binary\r\n${START}\nhand edit\n${END}\n*.rs diff=rust`)
  ok(runCli(['update'], dir))
  assert.equal(read(dir, ATTR), `*.png binary\r\n${block(expected)}\n*.rs diff=rust`)
}))

test('update twice leaves the file byte-identical', () => withTmpRepo(dir => {
  writeFileSync(join(dir, ATTR), '*.png binary\n')
  add(dir)
  ok(runCli(['update'], dir))
  const once = read(dir, ATTR)
  const r = ok(runCli(['update'], dir))
  assert.equal(read(dir, ATTR), once)
  assert.doesNotMatch(r.stdout, /\.gitattributes/, 'an unchanged file is not reported')
}))

test('an install whose lock predates the block gets it on its next update, with no adoption step', () => withTmpRepo(dir => {
  add(dir)
  const expected = read(dir, ATTR)
  rmSync(join(dir, ATTR))
  const r = ok(runCli(['update'], dir))
  assert.match(r.stdout, /✓ \.gitattributes/)
  assert.equal(read(dir, ATTR), expected)
}))

test('removed: remove all drops the block and the newline after it; a file left empty is deleted', () => withTmpRepo(dir => {
  add(dir)
  const r = ok(runCli(['remove', 'all'], dir))
  assert.match(r.stdout, /✗ \.gitattributes/)
  assert.ok(!has(dir, ATTR))
}))

test('round trip add then remove all: byte-identical with a final newline, one gained without', () => {
  for (const [mine, after] of [['*.png binary\r\n# mine\n', '*.png binary\r\n# mine\n'], ['*.png binary', '*.png binary\n'], ['\n', null]]) withTmpRepo(dir => {
    writeFileSync(join(dir, ATTR), mine)
    add(dir)
    ok(runCli(['remove', 'all'], dir))
    if (after === null) assert.ok(!has(dir, ATTR), 'a file left with only whitespace is deleted')
    else assert.equal(read(dir, ATTR), after)
  })
})

test('reused after removal: a later add meets an absent file and writes the same block', () => withTmpRepo(dir => {
  add(dir)
  const first = read(dir, ATTR)
  ok(runCli(['remove', 'all'], dir))
  add(dir)
  assert.equal(read(dir, ATTR), first)
}))

test('a partial remove recomputes the block from the kept inventory', () => withTmpRepo(dir => {
  add(dir)
  assert.match(read(dir, ATTR), /^\.claude\/rules\/rust\/\*\* /m)
  ok(runCli(['remove', 'rust'], dir))
  const text = read(dir, ATTR)
  assert.doesNotMatch(text, /rules\/rust/)
  assert.deepEqual(text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(' ')[0]), patternsOf(inventory(dir)).patterns)
}))

// The CLI never installs a path outside the expressible set, so this drives the module
// in a scratch cwd, as the CLI does.
const prepare = (dir, paths) => {
  const src = `import { prepareGitattributes, applyGitattributes } from ${JSON.stringify(join(REPO, 'bin/gitattributes.mjs'))}
const plan = prepareGitattributes(${JSON.stringify(paths)}); applyGitattributes(plan); console.log(JSON.stringify({ action: plan.action, skipped: plan.skipped }))`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('an inventory left with no expressible path drops the block, as remove all does', () => withTmpRepo(dir => {
  writeFileSync(join(dir, ATTR), '*.png binary\n')
  assert.equal(prepare(dir, ['.claude/agents/ok.md']).action, 'write')
  assert.deepEqual(prepare(dir, ['.claude/agents/not ok.md']), { action: 'write', skipped: ['.claude/agents/not ok.md'] })
  assert.equal(read(dir, ATTR), '*.png binary\n')
  assert.equal(prepare(dir, []).action, null)
}))

test('a path the block cannot express leaves the block not stale for doctor', () => withTmpRepo(dir => {
  ok(runCli(['add', 'agent', '--agent', 'claude'], dir))
  const l = lock(dir)
  l.installed[0].files['.claude/agents/not ok.md'] = l.installed[0].files[Object.keys(l.installed[0].files)[0]]
  writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(l))
  const r = runCliBare(['doctor'], dir)
  assert.doesNotMatch(r.stdout, /\.gitattributes/, 'a left-out path does not make the block stale')
}))

// -------------------------------------------------------------------- refusals
const refused = (dir, setup, why) => {
  setup()
  const before = lstatSync(join(dir, ATTR)).isFile() ? read(dir, ATTR) : null
  const r = runCli(['add', 'agent', 'rust', '--agent', 'claude'], dir)
  assert.notEqual(r.status, 0, why)
  assert.match(r.stderr + r.stdout, /\.gitattributes/, `${why}: the path is named`)
  assert.ok(!has(dir, '.claude-rules.lock') && !has(dir, '.claude'), `${why}: nothing was written`)
  if (before !== null) assert.equal(read(dir, ATTR), before, `${why}: the file is untouched`)
}

test('malformed markers are refused before anything is written', () => {
  for (const [why, text] of [
    ['a start without an end', `${START}\nx\n`],
    ['an end without a start', `x\n${END}\n`],
    ['two starts', `${START}\n${START}\n${END}\n`],
    ['two ends', `${START}\n${END}\n${END}\n`],
    ['the end before the start', `${END}\n${START}\n`],
  ]) withTmpRepo(dir => refused(dir, () => writeFileSync(join(dir, ATTR), text), why))
})

test('a .gitattributes that is not a regular file is refused before anything is written', () => {
  withTmpRepo(dir => refused(dir, () => mkdirSync(join(dir, ATTR)), 'a directory'))
  withTmpRepo(dir => refused(dir, () => { writeFileSync(join(dir, 'real'), '*.png binary\n'); symlinkSync('real', join(dir, ATTR)) }, 'a symlink'))
})

test('a malformed block refuses remove too, with the tree and lock unchanged', () => withTmpRepo(dir => {
  add(dir)
  writeFileSync(join(dir, ATTR), `${START}\n`)
  const before = read(dir, '.claude-rules.lock')
  const r = runCli(['remove', 'all'], dir)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Malformed managed markers in \.gitattributes/)
  assert.equal(read(dir, '.claude-rules.lock'), before)
  assert.ok(has(dir, '.claude/skills/debrief/SKILL.md'))
}))

// ---------------------------------------------------------------------- doctor
const coherent = dir => {
  ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/main.rs'), 'fn main() {}\n')
  writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n')
  mkdirSync(join(dir, 'docs/adr'), { recursive: true })
  writeFileSync(join(dir, 'docs/adr/0001-x.md'), '- **Status**: Proposed\n')
}

test('doctor warns, never fails, on a missing or stale block; --strict fails', () => {
  for (const [why, spoil] of [
    ['missing', dir => rmSync(join(dir, ATTR))],
    ['stale', dir => writeFileSync(join(dir, ATTR), read(dir, ATTR).replace('linguist-generated=true\n', 'linguist-generated=false\n'))],
    ['malformed', dir => writeFileSync(join(dir, ATTR), `${START}\n`)],
  ]) withTmpRepo(dir => {
    coherent(dir)
    ok(runCliBare(['doctor', '--strict'], dir))
    spoil(dir)
    const r = ok(runCliBare(['doctor'], dir))
    assert.match(r.stdout, /! .*\.gitattributes/, why)
    assert.match(r.stdout, /0 problem\(s\), 1 warning\(s\)/, why)
    assert.equal(runCliBare(['doctor', '--strict'], dir).status, 1, `${why}: --strict must fail`)
  })
})
