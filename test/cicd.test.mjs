// The `ci-ok` aggregator of kit/cicd/ci.snippet.yaml is the ONE required check, so it
// is code and gets a test. No runner here: the step's `${{ }}` expressions are
// expanded the way each forge expands them, then its shell runs for real.
// Gitea's runner expands the `needs.*` object filter to nothing (two downstream
// repos, #53); a named `needs.<job>.result` it expands like GitHub does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'

const SNIPPET = readFileSync(join(REPO, 'kit', 'cicd', 'ci.snippet.yaml'), 'utf8')

// The ci-ok job is the last one: its `needs:` list, its step's `env:` map and `run:` body.
function ciOk() {
  const job = SNIPPET.slice(SNIPPET.indexOf('\n  ci-ok:'))
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

function verdict(forge, results) {
  const { env, run } = ciOk()
  const vars = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expand(v, forge, results)]))
  const r = spawnSync('bash', ['-e', '-c', expand(run, forge, results)], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...vars },
  })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const all = (result) => Object.fromEntries(ciOk().needs.map(j => [j, result]))

for (const forge of ['github', 'gitea']) {
  test(`ci-ok on ${forge}: every gate green → green`, () => {
    const r = verdict(forge, all('success'))
    assert.equal(r.status, 0, r.out)
  })

  test(`ci-ok on ${forge}: one gate red → red`, () => {
    const [first] = ciOk().needs
    const r = verdict(forge, { ...all('success'), [first]: 'failure' })
    assert.notEqual(r.status, 0, `a failed ${first} must fail ci-ok:\n${r.out}`)
  })

  test(`ci-ok on ${forge}: one gate skipped → red`, () => {
    const last = ciOk().needs.at(-1)
    const r = verdict(forge, { ...all('success'), [last]: 'skipped' })
    assert.notEqual(r.status, 0, `a skipped ${last} must fail ci-ok:\n${r.out}`)
  })
}

test('ci-ok fails closed when a result expands to nothing', () => {
  const r = verdict('github', {})
  assert.notEqual(r.status, 0, `no result at all must fail ci-ok:\n${r.out}`)
})
