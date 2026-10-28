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
import { REPO } from './helpers.mjs'

const WORKFLOWS = ['kit/cicd/ci.snippet.yaml', '.github/workflows/ci.yml']

// The ci-ok job: its `needs:` list, its step's `env:` map and `run:` body.
function ciOk(file) {
  const text = readFileSync(join(REPO, file), 'utf8')
  // Up to the next job, so a later job's `run: |` can never stand in for ci-ok's.
  const rest = text.slice(text.indexOf('\n  ci-ok:') + 1)
  const next = rest.search(/\n  [\w-]+:\n/)
  const job = next === -1 ? rest : rest.slice(0, next)
  const needs = job.match(/needs: \[([^\]]*)\]/)[1].split(',').map(s => s.trim())
  const lines = job.split('\n')
  const env = {}
  let run = null
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^ {10}([A-Z_][A-Z0-9_]*): (.*)$/)
    if (kv && run === null) env[kv[1]] = kv[2].replace(/\s+#.*$/, '')
    if (/^ {8}run: \|$/.test(lines[i])) {
      run = []
      for (i++; i < lines.length && (lines[i] === '' || lines[i].startsWith(' '.repeat(10))); i++)
        run.push(lines[i].slice(10))
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
