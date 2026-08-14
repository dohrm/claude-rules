// Static lint of the prose assets. These are prompts, not code, so nothing here
// claims they *work* — that is eval/'s job. What it does catch is the rot that
// makes them silently wrong: a rule renamed under a skill's feet, a `/command`
// that no longer exists, an unclosed template tag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { REPO, readFm, walk, dirsIn } from './helpers.mjs'

const SKILLS = dirsIn(join(REPO, 'skills'))
const proseFiles = () => [
  ...walk(join(REPO, 'rules')),
  ...walk(join(REPO, 'skills')),
  ...walk(join(REPO, 'agents')),
].filter(f => f.endsWith('.md'))

const rel = f => f.slice(REPO.length + 1)
const read = f => readFileSync(f, 'utf8')

test('every skill description carries its own /trigger', () => {
  for (const name of SKILLS) {
    const { fm } = readFm(join(REPO, 'skills', name, 'SKILL.md'))
    assert.ok(fm.description.includes(`/${name}`),
      `skills/${name}: the description must name "/${name}" — it is what the user types`)
  }
})

// A rule reference is written `dir/file.md` (relative to rules/) or `rules/dir/file.md`.
test('rule references resolve', () => {
  for (const file of proseFiles()) {
    for (const m of read(file).matchAll(/`((?:rules\/)?[a-z0-9-]+\/[a-z0-9-]+\.md)`/g)) {
      const ref = m[1]
      const abs = join(REPO, ref.startsWith('rules/') ? ref : join('rules', ref))
      assert.ok(existsSync(abs) || existsSync(join(REPO, ref)),
        `${rel(file)}: references \`${ref}\`, which does not exist`)
    }
  }
})

test('kit references resolve', () => {
  for (const file of proseFiles()) {
    for (const m of read(file).matchAll(/`(kit\/[a-z0-9./-]+)`/g)) {
      const ref = m[1]
      if (ref.includes('*')) continue                       // a glob, not a path
      assert.ok(existsSync(join(REPO, ref)), `${rel(file)}: references \`${ref}\`, which does not exist`)
    }
  }
})

// `/name` in prose means "invoke that skill". A dangling one sends the reader nowhere.
test('slash-command references resolve to a skill', () => {
  const known = new Set(SKILLS)
  // Recipes and flags are written the same way; these are not skills.
  const NOT_SKILLS = new Set(['check', 'name', 'strict', 'local', 'agent', 'ref'])
  for (const file of proseFiles()) {
    for (const m of read(file).matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
      const n = m[1]
      if (NOT_SKILLS.has(n)) continue
      assert.ok(known.has(n), `${rel(file)}: mentions \`/${n}\`, which is not a skill in skills/`)
    }
  }
})

test('template tags are balanced', () => {
  for (const name of SKILLS) {
    const file = join(REPO, 'skills', name, 'SKILL.md')
    const text = read(file)
    const open = [...text.matchAll(/^<([a-z-]+-(?:template|unit|rules))>$/gm)].map(m => m[1])
    const close = [...text.matchAll(/^<\/([a-z-]+-(?:template|unit|rules))>$/gm)].map(m => m[1])
    assert.deepEqual(open, close, `skills/${name}: template tags are unbalanced or out of order`)
  }
})

// A copied asset must never carry a path from the machine that authored it.
test('no absolute local path leaked into a shipped asset', () => {
  for (const file of [...proseFiles(), ...walk(join(REPO, 'kit'))]) {
    assert.doesNotMatch(read(file), /\/(?:home|Users)\/[a-z]/i, `${rel(file)}: contains an absolute local path`)
  }
})

// The skills that own a document say where it goes; keep those paths consistent with
// the living-documents rule, which is what docs-check enforces in the consuming repo.
test('document-producing skills name a path under docs/', () => {
  const OWNERS = {
    prd: 'docs/PRD.md', plan: 'docs/PLAN.md', architect: 'docs/ARCHITECTURE.md',
    'design-system': 'docs/DESIGN.md', experience: 'docs/EXPERIENCE.md',
    observability: 'docs/OBSERVABILITY.md', runbook: 'docs/runbook/',
    postmortem: 'docs/postmortem/', 'pre-mortem': 'docs/premortem/',
  }
  for (const [name, path] of Object.entries(OWNERS)) {
    assert.ok(SKILLS.includes(name), `skills/${name} is gone — update the OWNERS map`)
    assert.ok(read(join(REPO, 'skills', name, 'SKILL.md')).includes(path),
      `skills/${name}: must state its output path (${path})`)
  }
})

// The mirror of the map above. These two skills produce scaffolding, not documents:
// it lives in .work/, it is gitignored, it dies with the branch. A root-level PLAN.md
// would collide head-on with the durable docs/PLAN.md that /plan owns — the two have
// opposite lifetimes, and one name for both is how they get confused.
test('working-memory skills write under .work/, never a bare PLAN.md', () => {
  for (const name of ['tasks', 'loop-setup']) {
    const text = read(join(REPO, 'skills', name, 'SKILL.md'))
    assert.match(text, /`\.work\//, `skills/${name}: must state its output path under .work/`)
    assert.doesNotMatch(text, /`(?:PLAN|MEMORY)\.md`/,
      `skills/${name}: names a bare PLAN.md/MEMORY.md — working memory goes under .work/`)
  }
})

// An eval case costs tokens to run and nothing to validate. Catch the authoring
// mistakes here rather than three minutes into a headless session.
test('eval cases are well formed', () => {
  const casesDir = join(REPO, 'eval', 'cases')
  const cases = dirsIn(casesDir).filter(n => existsSync(join(casesDir, n, 'expect.json')))
  assert.ok(cases.length > 0, 'no eval cases found')
  const agents = walk(join(REPO, 'agents')).map(f => basename(f, '.md'))

  for (const name of cases) {
    const dir = join(casesDir, name)
    const where = `eval/cases/${name}`
    let expect
    assert.doesNotThrow(() => { expect = JSON.parse(read(join(dir, 'expect.json'))) }, `${where}: expect.json does not parse`)

    assert.ok(!(expect.skill && expect.agent), `${where}: targets both a skill and an agent`)
    if (expect.skill) assert.ok(SKILLS.includes(expect.skill), `${where}: unknown skill "${expect.skill}"`)
    if (expect.agent) assert.ok(agents.includes(expect.agent), `${where}: unknown agent "${expect.agent}"`)

    for (const d of expect.rules || [])
      assert.ok(existsSync(join(REPO, 'rules', d)), `${where}: requests rules/${d}, which does not exist`)

    for (const spec of expect.gates || []) {
      const script = spec.split(/\s+/)[0]
      assert.ok(existsSync(join(REPO, 'kit', 'common', script)), `${where}: gate "${script}" is not in kit/common/`)
    }

    // A skill case has no default prompt, and an agent case needs something to review.
    if (expect.skill) assert.ok(expect.prompt, `${where}: a skill case must set "prompt"`)
    else assert.ok(readdirSync(dir).some(f => f.startsWith('input.')), `${where}: an agent case needs an input.* fixture`)

    // Assertions that can never fire are worse than none.
    const hasAssertion = ['stdout_matches', 'stdout_not_matches', 'file_matches', 'file_not_matches',
      'artifacts', 'gates', 'ci_verdict_in', 'file_changed'].some(k => expect[k] !== undefined)
    assert.ok(hasAssertion, `${where}: asserts nothing`)

    for (const pattern of Object.keys(expect.artifacts || {}))
      assert.doesNotMatch(pattern, /^\//, `${where}: artifact "${pattern}" must be workspace-relative`)
  }
})

test('a skill directory holds exactly one SKILL.md at its root', () => {
  for (const name of SKILLS) {
    const files = walk(join(REPO, 'skills', name))
    const roots = files.filter(f => basename(f) === 'SKILL.md' && basename(dirname(f)) === name)
    assert.equal(roots.length, 1, `skills/${name}: expected exactly one SKILL.md at the root`)
  }
})
