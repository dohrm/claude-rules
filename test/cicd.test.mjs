// The `ci-ok` aggregator is the ONE required check, so it is code and gets a test —
// the kit's snippet and this repo's own CI, which runs the same step. No runner here:
// the step's `${{ }}` expressions are expanded the way each forge expands them, then
// its shell runs for real.
// Gitea's runner expands the `needs.*` object filter to nothing (two downstream
// repos, #53); a named `needs.<job>.result` it expands like GitHub does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const AUDITED = /^\s*(?:-\s+)?(?:run:\s+)?just (?:base=\S+ )?(rust|go|python)-check\b/m

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

{
  const file = 'kit/cicd/ci.snippet.yaml'
  test(`${file}: every audited gate job passes base= and never fetches shallow`, () => {
    const gated = jobs(file).filter(j => AUDITED.test(j.block))
    assert.deepEqual(gated.map(j => j.name), ['rust', 'go', 'python'], 'the snippet ships the rust, go and python gate jobs')
    for (const { name, block } of gated) {
      for (const line of block.split('\n').filter(l => AUDITED.test(l)))
        assert.match(line, /just base="?\$base"? (rust|go|python)-check/, `${name}: ${line.trim()}`)
      assert.doesNotMatch(block, /--depth[= ]1\b|fetch-depth:\s*1\b/, `${name} fetches shallow`)
      assert.match(block, /git fetch [^\n]*"\+refs\/heads\/\$BASE:refs\/remotes\/origin\/\$BASE"/, `${name} must fetch the PR base`)
      assert.match(block, /BASE: \$\{\{ github\.base_ref \}\}/, `${name} must take the base through env:`)
    }
  })
}

// The step's shell, run for real: a shallow clone (what actions/checkout leaves), a
// `just` on PATH that prints its arguments, a PR base on the remote.
for (const tech of ['rust', 'go', 'python']) test(`kit/cicd/ci.snippet.yaml: the ${tech} gate step fetches the PR base and passes it, HEAD on a push`, () => {
  const block = jobs('kit/cicd/ci.snippet.yaml').find(j => j.name === tech).block
  const lines = block.split('\n')
  const named = lines.findIndex(l => l.trim() === `- name: just ${tech}-check`)
  const at = lines.findIndex((l, i) => i > named && /^ {8}run: \|$/.test(l))
  assert.ok(named !== -1 && at !== -1, `no run block under the ${tech}-check step`)
  const run = []
  for (let i = at + 1; i < lines.length && (lines[i] === '' || lines[i].startsWith(' '.repeat(10))); i++) run.push(lines[i].slice(10))

  withTmpRepo((dir) => {
    const sh = (cmd, cwd = dir) => {
      const r = spawnSync('bash', ['-e', '-c', cmd], { cwd, encoding: 'utf8' })
      assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`)
      return r.stdout
    }
    const git = 'git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null'
    sh(`git init -q -b main origin && cd origin && ${git} commit -q --allow-empty -m one && ${git} commit -q --allow-empty -m two`
      + ` && git branch next HEAD~1`)
    sh(`git clone -q --depth 1 file://${dir}/origin work`)
    sh(`mkdir bin && printf '#!/bin/sh\\necho "just $*"\\n' > bin/just && chmod +x bin/just`)
    const step = (BASE) => {
      const r = spawnSync('bash', ['-e', '-c', run.join('\n')], {
        cwd: join(dir, 'work'), encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, BASE },
      })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      return r.stdout
    }
    assert.match(step('next'), new RegExp(`^just base=origin/next ${tech}-check$`, 'm'))
    sh('git rev-parse --verify --quiet origin/next', join(dir, 'work'))
    assert.match(step(''), new RegExp(`^just base=HEAD ${tech}-check$`, 'm'))
  })
})
