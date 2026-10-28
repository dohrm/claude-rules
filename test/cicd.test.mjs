// The `ci-ok` aggregator is the ONE required check, so it is code and gets a test —
// the kit's snippet and this repo's own CI, which runs the same step. No runner here:
// the step's `${{ }}` expressions are expanded the way each forge expands them, then
// its shell runs for real.
// Gitea's runner expands the `needs.*` object filter to nothing (two downstream
// repos, #53); a named `needs.<job>.result` it expands like GitHub does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const WORKFLOWS = ['kit/cicd/ci.snippet.yaml', '.github/workflows/ci.yml']

// The ci-ok job: its `needs:` list, its step's `env:` map and `run:` body.
function ciOk(file) {
  const text = readFileSync(join(REPO, file), 'utf8')
  // Up to the next job, so a later job's `run: |` can never stand in for ci-ok's.
  const at = text.indexOf('\n  ci-ok:')
  if (at === -1) throw new Error(`${file}: no ci-ok job`)
  const rest = text.slice(at + 1)
  const next = rest.search(/\n  [\w-]+:\n/)
  const job = next === -1 ? rest : rest.slice(0, next)
  const needs = job.match(/needs: \[([^\]]*)\]/)[1].split(',').map(s => s.trim())
  const lines = job.split('\n')
  const env = {}
  let run = null
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^ {10}([A-Z_][A-Z0-9_]*): (.*)$/)
    if (kv) env[kv[1]] = kv[2].replace(/\s+#.*$/, '')
    if (/^ {8}run: \|$/.test(lines[i])) {
      run = []
      for (i++; i < lines.length && (lines[i] === '' || lines[i].startsWith(' '.repeat(10))); i++)
        run.push(lines[i].slice(10))
      break
    }
  }
  return { needs, env, run: run.join('\n') }
}

const expand = (text, forge, results) => text.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
  if (/^join\(needs\.\*\.result, ' '\)$/.test(expr))
    return forge === 'gitea' ? '' : Object.values(results).join(' ')
  const named = expr.match(/^needs\.([\w-]+)\.result$/)
  if (named) return results[named[1]] ?? ''
  throw new Error(`ci-ok uses an expression this test cannot expand: ${expr}`)
})

function verdict(file, forge, results) {
  const { env, run } = ciOk(file)
  const vars = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expand(v, forge, results)]))
  const r = spawnSync('bash', ['-e', '-c', expand(run, forge, results)], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...vars },
  })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

for (const file of WORKFLOWS) {
  const { needs } = ciOk(file)
  const all = (result) => Object.fromEntries(needs.map(j => [j, result]))

  // On the named form both forges take the same path. The gitea cases are the guard:
  // a reintroduced `join(needs.*.result)` turns them red, not the github ones.
  for (const forge of ['github', 'gitea']) {
    test(`${file} ci-ok on ${forge}: every gate green → green`, () => {
      const r = verdict(file, forge, all('success'))
      assert.equal(r.status, 0, r.out)
    })

    test(`${file} ci-ok on ${forge}: one gate red → red`, () => {
      const r = verdict(file, forge, { ...all('success'), [needs[0]]: 'failure' })
      assert.notEqual(r.status, 0, `a failed ${needs[0]} must fail ci-ok:\n${r.out}`)
    })

    test(`${file} ci-ok on ${forge}: one gate skipped → red`, () => {
      const r = verdict(file, forge, { ...all('success'), [needs.at(-1)]: 'skipped' })
      assert.notEqual(r.status, 0, `a skipped ${needs.at(-1)} must fail ci-ok:\n${r.out}`)
    })
  }

  // A job in `needs` but in neither list below it is never checked: the one way the
  // named form can still fail open. Hold the three lists equal.
  test(`${file} ci-ok checks every job it needs, by name`, () => {
    const { env, run } = ciOk(file)
    const upper = needs.map(j => j.toUpperCase().replace(/-/g, '_'))
    assert.deepEqual(Object.keys(env), upper, 'one env line per job in needs')
    for (const [k, v] of Object.entries(env)) assert.match(v, new RegExp(`needs\\.${needs[upper.indexOf(k)]}\\.result`))
    assert.deepEqual(run.match(/^for job in (.*); do$/m)?.[1].split(' '), upper, 'the loop walks every env line')
  })

  test(`${file} ci-ok fails closed when a result expands to nothing`, () => {
    const r = verdict(file, 'github', {})
    assert.notEqual(r.status, 0, `no result at all must fail ci-ok:\n${r.out}`)
  })
}

// ------------------------------------------------- gate jobs pass the PR base
// `<tech>-check` audits only when the lock changed against `base` (#50), and an
// unresolvable base fails closed into running the audit. So a gate job that does not
// fetch the PR base, or fetches it shallow, quietly turns every PR back into a daily
// advisory lottery. The audit-bearing gates are the ones checked.
// The token, not a YAML shape: any `just … <tech>-check` outside a comment or a step name.
const AUDITED = /^(?![ \t]*(?:-[ \t]*)?name:)[^#\n]*\bjust\b[^#\n]*\b(rust|go|python)-check\b/m

// The ci.yml test below is negative, so the matcher needs its own positive cases.
test('AUDITED matches a gate call, not its step label or a comment', () => {
  for (const l of ['run: just rust-check', '  - run: just base="$base" go-check', '- { name: x, run: just python-check }',
    '      - run: "just rust-check"', 'just -f justfile go-check', 'just  base=x python-check'])
    assert.match(l, AUDITED, l)
  for (const l of ['- name: just rust-check', '  # just go-check runs the audit', 'run: npm test # just python-check',
    'run: just ts-check'])
    assert.doesNotMatch(l, AUDITED, l)
})

function jobs(file) {
  const text = readFileSync(join(REPO, file), 'utf8')
  const body = text.slice(text.indexOf('\njobs:\n'))
  return [...body.matchAll(/\n {2}([\w-]+):[^\n]*\n([\s\S]*?)(?=\n {2}[\w-]+:[^\n]*\n|$)/g)]
    .map(([, name, block]) => ({ name, block }))
}

// This repo's own ci.yml runs the gates through `npm test` (the *-gates.test.mjs files
// build a fixture repo with its own base), never `just <tech>-check` directly. Stated,
// so a direct call added later fails here and has to be wired like the snippet's step.
test('.github/workflows/ci.yml calls no audited gate directly', () => {
  assert.deepEqual(jobs('.github/workflows/ci.yml').filter(j => AUDITED.test(j.block)).map(j => j.name), [])
})

// The base is resolved in ONE place, kit/common's `ci-base`: each job is the one line
// that calls it, with the branch passed through `env:`, never interpolated in shell.
const GATE_STEP = (tech) => `run: just base="$(just ci-base)" ${tech}-check`

test('kit/cicd/ci.snippet.yaml: every audited gate job resolves its base through ci-base', () => {
  const gated = jobs('kit/cicd/ci.snippet.yaml').filter(j => AUDITED.test(j.block))
  assert.deepEqual(gated.map(j => j.name), ['rust', 'go', 'python'], 'the snippet ships the rust, go and python gate jobs')
  for (const { name, block } of gated) {
    const calls = block.split('\n').filter(l => AUDITED.test(l)).map(l => l.trim())
    assert.deepEqual(calls, [GATE_STEP(name)], `${name}: the gate call`)
    assert.match(block, /BASE: \$\{\{ github\.base_ref \}\}/, `${name} must take the base through env:`)
    assert.doesNotMatch(block, /--depth[= ]1\b|fetch-depth:\s*1\b/, `${name} fetches shallow`)
  }
})

// The snippet's gate line and `ci-base`, run for real: the shipped gate.just in a
// shallow clone (what actions/checkout leaves), `<tech>-check` stubbed to print the
// base it received, a PR base with history on the remote.
test('ci-base fetches the PR base in full and the gate line passes it; HEAD on a push; nothing on a failed fetch', () => {
  withTmpRepo((dir) => {
    const sh = (cmd, cwd = dir, env = {}) => spawnSync('bash', ['-e', '-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
    const ok = (cmd, cwd, env) => {
      const r = sh(cmd, cwd, env)
      assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`)
      return r.stdout
    }
    const git = 'git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null'
    ok(`git init -q -b main origin && cd origin && for m in one two three; do ${git} commit -q --allow-empty -m $m; done`
      + ' && git branch next HEAD~1')
    ok(`git clone -q --depth 1 file://${dir}/origin work`)
    const work = join(dir, 'work')
    ok('mkdir -p .dev/kit/common', work)
    writeFileSync(join(work, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
    writeFileSync(join(work, 'justfile'), "set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n"
      + "import '.dev/kit/common/gate.just'\n"
      + ['rust', 'go', 'python'].map(t => `${t}-check:\n    @echo "${t}-check base={{base}}"\n`).join(''))

    assert.equal(ok('just ci-base', work, { BASE: 'next' }), 'origin/next\n')
    assert.equal(ok('git rev-list --count origin/next', work), '2\n', 'the base is fetched with its history, not shallow')
    assert.equal(ok('just ci-base', work, { BASE: '' }), 'HEAD\n')
    const failed = sh('just ci-base', work, { BASE: 'no-such-branch' })
    assert.notEqual(failed.status, 0)
    assert.equal(failed.stdout, '', 'a failed fetch prints no ref, so base is empty and the audit runs')

    for (const tech of ['rust', 'go', 'python']) {
      const line = GATE_STEP(tech).replace(/^run: /, '')
      assert.equal(ok(line, work, { BASE: 'next' }), `${tech}-check base=origin/next\n`)
      assert.equal(ok(line, work, { BASE: '' }), `${tech}-check base=HEAD\n`)
    }
  })
})
