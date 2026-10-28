// The `ci-ok` aggregator is the ONE required check, so it is code and gets a test —
// the kit's snippet and this repo's own CI, which runs the same step. No runner here:
// the step's `${{ }}` expressions are expanded the way each forge expands them, then
// its shell runs for real.
// Gitea's runner expands the `needs.*` object filter to nothing (two downstream
// repos, #53); a named `needs.<job>.result` it expands like GitHub does.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
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
    assert.match(block, /- uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 0\b/, `${name}: HEAD needs its history for the merge base`)
  }
})

// The snippet's gate line and `ci-base`, run for real: the shipped gate.just in a
// shallow clone (what actions/checkout leaves), `<tech>-check` stubbed to print the
// base it received, a PR base with history on the remote.
// The node-only `test` CI job has no `just`: skip there, like test/gates.test.mjs.
// The cicd-gates job installs it and sets CICD_GATES=1, so there a missing `just` is a
// red job, never a skip-as-pass.
const JUST = spawnSync('just', ['--version'], { encoding: 'utf8' })
if (process.env.CICD_GATES === '1' && JUST.error) throw new Error(`CICD_GATES=1 but just is not installed: ${JUST.error.message}`)

test('ci-base fetches the PR base in full and the gate line passes it; HEAD on a push; nothing on a failed fetch',
  { skip: JUST.error ? 'just not installed' : false }, () => {
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

// The CI checkout end to end: a PR branch forked before its base bumped the lock. What
// actions/checkout leaves by default (depth 1) has no merge base, so the gate audits
// every PR; the snippet's `fetch-depth: 0` gives HEAD its history, and the gate skips.
// The shipped gate.just and go.just, the audit stubbed.
test('a full CI checkout of a PR behind a lock bump skips the audit; a shallow one cannot tell, and audits',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withTmpRepo((dir) => {
    const sh = (cmd, cwd, env = {}) => {
      const r = spawnSync('bash', ['-e', '-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
      assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`)
      return r.stdout
    }
    const git = 'git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null'
    sh(`git init -q -b main origin && cd origin && echo a > go.sum && git add go.sum && ${git} commit -q -m lock`
      + ` && git checkout -q -b pr && echo x > x && git add x && ${git} commit -q -m 'the PR'`
      + ` && git checkout -q main && echo b > go.sum && ${git} commit -q -am 'base bumps the lock'`, dir)
    for (const [depth, marker, audits] of [
      ['--depth 1', 'audit: no merge base with origin/main', true],
      ['', 'go.sum unchanged since its merge base with origin/main', false],
    ]) {
      const work = join(dir, `work${depth ? '-shallow' : '-full'}`)
      sh(`git clone -q ${depth} --branch pr file://${dir}/origin ${work} && mkdir -p ${work}/.dev/kit`, dir)
      for (const lib of ['common/gate.just', 'go/go.just']) {
        sh(`mkdir -p .dev/kit/${dirname(lib)}`, work)
        writeFileSync(join(work, '.dev/kit', lib), readFileSync(join(REPO, 'kit', lib)))
      }
      writeFileSync(join(work, 'justfile'), 'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\nimport '.dev/kit/go/go.just'\n")
      const out = sh('just base="$(just ci-base)" _audit-gate . go.sum "echo audit-ran"', work, { BASE: 'main' })
      assert.ok(out.includes(marker), `${depth || 'full'}: ${out}`)
      assert.equal(out.includes('audit-ran'), audits, `${depth || 'full'}: ${out}`)
    }
  })
})

// ------------------------------------------------ the scheduled audit's reporter
// advisory-issue.mjs against a stub forge playing GitHub or Gitea: the issues API at
// the forge's path, paged by its own parameter, pull requests mixed into the list as
// both forges return them. `just` is a stub that prints and exits as told.
const REPORTER = join(REPO, 'kit/cicd/advisory-issue.mjs')
const BIN = mkdtempSync(join(tmpdir(), 'claude-rules-advisory-'))
after(() => rmSync(BIN, { recursive: true, force: true }))
writeFileSync(join(BIN, 'just'), '#!/bin/sh\n[ "$1" = --show ] && exit "${STUB_SHOW:-0}"\n'
  + 'echo "ran: just $* (token: ${GITHUB_TOKEN:-withheld})"\nprintf "%s\\n" "$STUB_OUT"\nexit "$STUB_STATUS"\n')
chmodSync(join(BIN, 'just'), 0o755)

const FORGES = {
  // GitHub: API at the root of GITHUB_API_URL; an issue has no `pull_request` key.
  github: { prefix: '', page: 'per_page', pr: { url: 'x' }, env: (url) => ({ GITHUB_API_URL: url }) },
  // Gitea: API under /api/v1, `limit` pages, `pull_request: null` on an issue. No
  // GITHUB_API_URL here, so the GITHUB_SERVER_URL fallback is the one exercised.
  gitea: { prefix: '/api/v1', page: 'limit', pr: { merged: false }, env: (url) => ({ GITEA_ACTIONS: 'true', GITHUB_SERVER_URL: url }) },
}

async function stubForge(forge, seed = []) {
  const { prefix, page, pr } = FORGES[forge]
  const issues = seed.map((i, n) => ({ number: n + 1, state: 'open', body: '', ...(forge === 'gitea' ? { pull_request: null } : {}), ...i,
    ...(i.pull_request ? { pull_request: pr } : {}) }))
  const calls = []
  const root = `${prefix}/repos/o/r/issues`
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const url = new URL(req.url, 'http://stub')
      const body = raw ? JSON.parse(raw) : undefined
      calls.push({ method: req.method, path: url.pathname, body, auth: req.headers.authorization })
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      const one = url.pathname.match(/\/issues\/(\d+)$/)
      if (req.method === 'GET' && url.pathname === root) {
        const size = Number(url.searchParams.get(page)) || 30
        const at = (Number(url.searchParams.get('page')) || 1) - 1
        return send(200, issues.filter((i) => i.state === 'open').slice(at * size, (at + 1) * size))
      }
      if (req.method === 'POST' && url.pathname === root) {
        const made = { number: issues.length + 1, state: 'open', ...body }
        issues.push(made)
        return send(201, made)
      }
      if (req.method === 'PATCH' && one && url.pathname === `${root}/${one[1]}`) {
        const hit = issues.find((i) => i.number === Number(one[1]))
        return hit ? send(201, Object.assign(hit, body)) : send(404, { message: 'no such issue' })
      }
      send(404, { message: `not ${forge}: ${req.method} ${url.pathname}` })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, api: `${url}${prefix}`, issues, calls, writes: () => calls.filter((c) => c.method !== 'GET'),
    close: () => new Promise((resolve) => server.close(resolve)) }
}

// Async: the stub forge answers from this very process.
function report(audit, { forge, url }, { status = 0, out = 'audit says ok', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REPORTER, audit], {
      env: { PATH: `${BIN}:${process.env.PATH}`, STUB_STATUS: String(status), STUB_OUT: out,
        GITHUB_TOKEN: 'tkn', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: '0123456789abcdef', ...FORGES[forge].env(url), ...env },
    })
    let log = ''
    child.stdout.on('data', (c) => { log += c })
    child.stderr.on('data', (c) => { log += c })
    child.on('error', reject)
    child.on('close', (code) => resolve({ status: code, out: log }))
  })
}

const TITLE = 'security-advisory: python-audit'
// More than one page of other open issues, then a pull request bearing our title: the
// issue must be found past the first page, and the pull request never taken for it.
const CROWD = [...Array.from({ length: 120 }, (_, n) => ({ title: `other ${n}` })), { title: TITLE, pull_request: true }]

for (const forge of Object.keys(FORGES)) {
  const withForge = async (seed, fn) => {
    const stub = await stubForge(forge, seed)
    try { await fn(stub) } finally { await stub.close() }
  }

  test(`advisory-issue on ${forge}: red with no issue open → opens one titled by the audit`, () => withForge(CROWD, async (stub) => {
    const r = await report('python-audit', { forge, url: stub.url }, { status: 1, out: 'Found 2 known vulnerabilities in certifi' })
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(stub.writes().map((c) => [c.method, c.path]), [['POST', `${new URL(stub.api).pathname.replace(/\/$/, '')}/repos/o/r/issues`]])
    const [{ body, auth }] = stub.writes()
    assert.equal(body.title, TITLE)
    assert.match(body.body, /Found 2 known vulnerabilities in certifi/)
    assert.match(body.body, /ran: just python-audit \(token: withheld\)/, 'the audit never holds the forge token')
    assert.match(body.body, /failed \(exit 1\)/)
    assert.equal(auth, 'token tkn')
  }))

  test(`advisory-issue on ${forge}: red with the issue open → updates it, opens nothing`, () => withForge(
    [...CROWD, { title: TITLE, body: 'yesterday' }], async (stub) => {
      const r = await report('python-audit', { forge, url: stub.url }, { status: 1, out: 'today: pillow' })
      assert.equal(r.status, 0, r.out)
      const writes = stub.writes()
      assert.deepEqual(writes.map((c) => c.method), ['PATCH'])
      assert.match(writes[0].path, /\/issues\/122$/, 'the issue, not the pull request with the same title')
      assert.match(writes[0].body.body, /today: pillow/)
      assert.equal(writes[0].body.state, undefined)
    }))

  test(`advisory-issue on ${forge}: green with the issue open → closes it`, () => withForge(
    [...CROWD, { title: TITLE }], async (stub) => {
      const r = await report('python-audit', { forge, url: stub.url })
      assert.equal(r.status, 0, r.out)
      assert.deepEqual(stub.writes().map((c) => [c.method, c.path.match(/\d+$/)?.[0], c.body]), [['PATCH', '122', { state: 'closed' }]])
    }))

  test(`advisory-issue on ${forge}: green with no issue open → writes nothing`, () => withForge(CROWD, async (stub) => {
    const r = await report('python-audit', { forge, url: stub.url })
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(stub.writes(), [])
  }))
}

test('advisory-issue names the Go toolchain case in a go-audit issue, and only there', () => Promise.all(
  ['go-audit', 'python-audit'].map(async (audit) => {
    const stub = await stubForge('github')
    try {
      const r = await report(audit, { forge: 'github', url: stub.url }, { status: 1 })
      assert.equal(r.status, 0, r.out)
      const named = /toolchain version[\s\S]*not by `go\.mod`/.test(stub.writes()[0].body.body)
      assert.equal(named, audit === 'go-audit', `${audit}: toolchain note`)
    } finally { await stub.close() }
  })))

test('advisory-issue exits 1 when the forge refuses, 2 on a setup problem; never reports an audit it could not run, nor another branch', async () => {
  const stub = await stubForge('github')
  try {
    const refused = await report('python-audit', { forge: 'github', url: `${stub.url}/not-the-api` }, { status: 1 })
    assert.equal(refused.status, 1, refused.out)
    assert.match(refused.out, /cannot report python-audit/)
    const calls = stub.calls.length
    const noToken = await report('python-audit', { forge: 'github', url: stub.url }, { env: { GITHUB_TOKEN: '' } })
    assert.equal(noToken.status, 2, noToken.out)
    const noJust = await report('python-audit', { forge: 'github', url: stub.url }, { env: { PATH: '/nonexistent' } })
    assert.equal(noJust.status, 2, noJust.out)
    // An audit that never ran is a red job, not an advisory issue.
    const noRecipe = await report('python-audit', { forge: 'github', url: stub.url }, { status: 1, env: { STUB_SHOW: '1' } })
    assert.equal(noRecipe.status, 2, noRecipe.out)
    assert.match(noRecipe.out, /no `python-audit` recipe/)
    const noTool = await report('python-audit', { forge: 'github', url: stub.url }, { status: 127 })
    assert.equal(noTool.status, 2, noTool.out)
    // A dispatch off the default branch: that branch's verdict, in the run, not the issue.
    const offDefault = { GITHUB_REF_NAME: 'fix', DEFAULT_BRANCH: 'main' }
    assert.equal((await report('python-audit', { forge: 'github', url: stub.url }, { status: 1, env: offDefault })).status, 1)
    assert.equal((await report('python-audit', { forge: 'github', url: stub.url }, { env: offDefault })).status, 0)
    const noGiteaUrl = await report('python-audit', { forge: 'gitea', url: '' }, { env: { GITHUB_SERVER_URL: '' } })
    assert.equal(noGiteaUrl.status, 2, noGiteaUrl.out)
    assert.equal(stub.calls.length, calls, 'no setup failure may call the forge')
    // Past those, an exit code cannot tell findings from a tool error: reported, as such.
    const toolError = await report('python-audit', { forge: 'github', url: stub.url }, { status: 2, out: 'Failed to spawn: `pip-audit`' })
    assert.equal(toolError.status, 0, toolError.out)
    assert.match(stub.writes()[0].body.body, /failed \(exit 2\)[\s\S]*a tool or network error[\s\S]*Failed to spawn: `pip-audit`/)
  } finally { await stub.close() }
})

// The schedule ships with one matrix entry per `<tech>-audit` recipe the kit defines,
// and the reporter gets the job's token through env:, never interpolated in shell.
test('kit/cicd/audit.snippet.yaml: daily, one matrix entry per audit recipe, the token through env:', () => {
  const text = readFileSync(join(REPO, 'kit/cicd/audit.snippet.yaml'), 'utf8')
  assert.match(text, /\non:\n {2}schedule:\n {4}- cron: '[^']+'/, 'a daily schedule')
  assert.match(text, /\npermissions:\n {2}contents: read\n {2}issues: write\b/)
  const recipes = ['go', 'python', 'rust'].flatMap((t) =>
    [...readFileSync(join(REPO, 'kit', t, `${t}.just`), 'utf8').matchAll(/^([a-z]+-audit):/gm)].map((m) => m[1]))
  const matrix = text.match(/^ +audit: \[([^\]]*)\]/m)[1].split(',').map((s) => s.trim())
  assert.deepEqual(matrix.toSorted(), recipes.toSorted())
  for (const [, audit] of text.matchAll(/if: matrix\.audit == '([^']+)'/g)) assert.ok(matrix.includes(audit), audit)
  const step = text.slice(text.lastIndexOf('\n      - name: '))
  assert.match(step, /\n {10}AUDIT: \$\{\{ matrix\.audit \}\}\n/)
  assert.match(step, /\n {10}GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n/)
  assert.match(step, /\n {10}DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(step, /\n {8}run: node \.dev\/kit\/cicd\/advisory-issue\.mjs "\$AUDIT"\n$/)
  const registry = JSON.parse(readFileSync(join(REPO, 'registry.json'), 'utf8'))
  assert.ok(Object.values(registry.profiles).flat().some((e) => e.from === 'kit/cicd' && e.to === '.dev/kit/cicd'),
    'the step names the path kit/cicd installs to')
})
