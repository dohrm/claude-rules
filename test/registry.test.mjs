// Static consistency of the asset tree — fast, no spawn, no network.
// Catches the silent breakages: a renamed directory the registry still points
// at, a skill whose frontmatter name no longer matches its dir (so `/name`
// stops resolving), an asset nobody can install, a stale gating table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { REPO, registry, allEntries, readFm, walk, dirsIn, read } from './helpers.mjs'

const KINDS = new Set(['skill', 'kit', 'rule', 'agent'])
const label = e => `${e.from} (${e.kind})`

test('registry: every entry is well formed and its source exists', () => {
  assert.ok(allEntries.length > 0, 'registry has no entries')
  for (const e of allEntries) {
    assert.ok(e.from, `entry without "from": ${JSON.stringify(e)}`)
    assert.ok(e.to, `${e.from}: missing "to"`)
    assert.ok(KINDS.has(e.kind), `${e.from}: unknown kind "${e.kind}"`)
    assert.ok(existsSync(join(REPO, e.from)), `${label(e)}: source path does not exist`)
  }
})

test('registry: no duplicate "from" within a profile', () => {
  for (const [name, entries] of Object.entries(registry.profiles)) {
    const froms = entries.map(e => e.from)
    assert.equal(new Set(froms).size, froms.length, `profile "${name}" installs the same path twice`)
  }
})

test('skills: SKILL.md exists, name matches the directory, description is present', () => {
  for (const e of allEntries.filter(e => e.kind === 'skill')) {
    const dir = join(REPO, e.from)
    const skillMd = join(dir, 'SKILL.md')
    assert.ok(existsSync(skillMd), `${e.from}: no SKILL.md (the skill would not be discovered)`)
    const { fm } = readFm(skillMd)
    assert.ok(fm, `${e.from}/SKILL.md: no frontmatter`)
    // The invocation `/name` resolves on the frontmatter name, the installer
    // copies to a dir named after `from` — a mismatch breaks the slash command.
    assert.equal(fm.name, basename(e.from), `${e.from}/SKILL.md: frontmatter name must equal the directory name`)
    assert.ok(fm.description && fm.description.length > 40,
      `${e.from}/SKILL.md: description drives auto-triggering — it must be substantial`)
  }
})

test('rules: every markdown rule has a title, and paths entries are globs', () => {
  for (const file of walk(join(REPO, 'rules')).filter(f => f.endsWith('.md'))) {
    const rel = file.slice(REPO.length + 1)
    const { fm } = readFm(file)
    assert.ok(fm, `${rel}: no frontmatter`)
    assert.ok(fm.title, `${rel}: missing "title" (used as the Cursor rule description)`)
    if ('paths' in fm) {
      assert.ok(Array.isArray(fm.paths) && fm.paths.length, `${rel}: "paths" present but empty`)
      for (const p of fm.paths) assert.match(p, /\*/, `${rel}: path "${p}" is not a glob`)
    }
  }
})

test('agents: frontmatter carries name + description', () => {
  for (const file of walk(join(REPO, 'agents')).filter(f => f.endsWith('.md'))) {
    const rel = file.slice(REPO.length + 1)
    const { fm } = readFm(file)
    assert.ok(fm, `${rel}: no frontmatter`)
    assert.ok(fm.name, `${rel}: missing "name"`)
    assert.ok(fm.description, `${rel}: missing "description" (drives delegation)`)
  }
})

// Orphan detection: an asset no registry entry reaches is dead weight — it can
// never be installed, and it rots unnoticed.
test('no orphan assets: every skill and rule directory is reachable from the registry', () => {
  const froms = new Set(allEntries.map(e => e.from))
  for (const name of dirsIn(join(REPO, 'skills')))
    assert.ok(froms.has(`skills/${name}`), `skills/${name} is not installable — no registry entry points at it`)
  for (const name of dirsIn(join(REPO, 'rules')))
    assert.ok(froms.has(`rules/${name}`), `rules/${name} is not installable — no registry entry points at it`)
  for (const name of dirsIn(join(REPO, 'kit')))
    assert.ok(froms.has(`kit/${name}`), `kit/${name} is not installable — no registry entry points at it`)
})

// The installer is dumb on purpose: the gating ("which profile for which shape")
// lives in the architect skill. If the two drift, profiles become invisible.
test('architect gating table lists exactly the registry profiles', () => {
  const text = read(REPO, 'skills', 'architect', 'SKILL.md')
  const section = text.split('### 2.')[1]?.split('### 3.')[0]
  assert.ok(section, 'architect SKILL.md: could not find the profile gating section')
  const listed = new Set()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cell = line.split('|')[1] || ''
    for (const m of cell.matchAll(/`([a-z0-9-]+)`/g)) listed.add(m[1])
  }
  for (const p of Object.keys(registry.profiles))
    assert.ok(listed.has(p), `profile "${p}" exists but the architect gating table never mentions it`)
  for (const p of listed)
    assert.ok(registry.profiles[p], `architect gating table offers "${p}" — no such profile in the registry`)
})

// GitHub/Gitea Actions expressions accept ONLY single-quoted string literals; a double
// quote inside `${{ … }}` is a syntax error that no YAML parser catches — it takes a real
// runner to reject the file. Shipping a broken workflow in the kit breaks every consumer.
test('workflow expressions use single quotes for string literals', () => {
  const files = [...walk(join(REPO, 'kit')), ...walk(join(REPO, '.github'))]
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  assert.ok(files.length > 0, 'no workflow files found — did the kit move?')
  for (const file of files) {
    const rel = file.slice(REPO.length + 1)
    for (const m of read(file).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      assert.doesNotMatch(m[1], /"/,
        `${rel}: double quote inside \${{ ${m[1].trim()} }} — Actions expressions only accept 'single quotes'`)
    }
  }
})

// The README's catalogue drifts exactly the way /architect's gating table did.
test('README profile catalogue lists every profile', () => {
  const readme = read(REPO, 'README.md')
  const section = readme.split('### The profile catalogue')[1]?.split('### What the installer')[0]
  assert.ok(section, 'README: could not find the profile catalogue section')
  const listed = new Set([...section.matchAll(/`([a-z0-9-]+)`/g)].map(m => m[1]))
  for (const p of Object.keys(registry.profiles))
    assert.ok(listed.has(p), `profile "${p}" is missing from the README catalogue`)
})

test('kit entries that need wiring say so', () => {
  for (const e of allEntries.filter(e => e.kind === 'kit')) {
    const files = walk(join(REPO, e.from))
    assert.ok(files.length, `${e.from}: empty kit directory`)
    assert.ok(e.wire, `${e.from}: kit is copied but never wired — add a "wire" note or make it a rule`)
  }
})

// `node --test <dir>` is not portable across the Node versions we support, so the
// script lists its files. This keeps that list from silently going stale.
test('npm test runs every test file', () => {
  const pkg = JSON.parse(read(REPO, 'package.json'))
  for (const f of readdirSync(join(REPO, 'test')).filter(n => n.endsWith('.test.mjs')))
    assert.ok(pkg.scripts.test.includes(`test/${f}`), `test/${f} is never run — add it to the "test" script`)
})

test('registry references a real repo and default ref', () => {
  assert.match(registry.repo, /^[\w.-]+\/[\w.-]+$/)
  assert.ok(registry.defaultRef)
  assert.ok(statSync(join(REPO, 'bin', 'cli.mjs')).isFile())
})

// One review contract, two invocations: the Claude subagent (agents/code-reviewer.md)
// and the headless prompt every CLI can run (kit/common/review-prompt.md). Generating
// one from the other would buy an emitter for two files; duplicating the block is
// cheaper — as long as THIS test is what hurts when the copies drift.
test('review contract: the shared block is byte-identical in the agent and the headless prompt', () => {
  const OPEN = '<!-- shared:review-contract -->'
  const CLOSE = '<!-- /shared:review-contract -->'
  const block = rel => {
    const text = read(REPO, ...rel.split('/'))
    const start = text.indexOf(OPEN), end = text.indexOf(CLOSE)
    assert.ok(start !== -1 && end > start, `${rel}: no "${OPEN} … ${CLOSE}" block`)
    return text.slice(start + OPEN.length, end)
  }
  const agent = block('agents/code-reviewer.md')
  assert.match(agent, /<!-- CI_VERDICT: CRITICAL\|WARNINGS\|CLEAN -->/,
    'the shared block is where the report contract lives — review-guard parses that marker')
  assert.match(agent, /<!-- REVIEWED: /, 'a verdict without the sha it describes cannot be judged stale')
  assert.equal(block('kit/common/review-prompt.md'), agent,
    'agents/code-reviewer.md and kit/common/review-prompt.md have drifted — edit both, or neither')
})
