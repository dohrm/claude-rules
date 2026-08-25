// The go jalon is a just library plus the golangci config those recipes read.
// A comment that lists `gofmt` / `errcheck` / `govulncheck` is not a gate —
// this is: a throwaway repo, the shipped go.just, the shipped
// golangci.base.yml, then `just` itself. Locally, skipped when just / go /
// golangci-lint / govulncheck are missing. The go-gates CI job sets
// GO_GATES=1 so a missing tool is a red job, never a skip-as-pass.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const FIXTURE = join(REPO, 'test', 'fixtures', 'go-gate')
const KIT_GO = join(REPO, 'kit', 'go')
const GOCACHE = join(tmpdir(), 'claude-rules-go-gate-gocache')
const GOMODCACHE = join(tmpdir(), 'claude-rules-go-gate-modcache')
const GOLANGCI_LINT_CACHE = join(tmpdir(), 'claude-rules-go-gate-golangci')
const SRC = 'api/add.go'
const TIMEOUT = 180_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

const whyMissingLint = missing('just', ['--version']) ? 'just not installed'
  : missing('go', ['version']) ? 'go not installed'
  : missing('golangci-lint', ['version']) ? 'golangci-lint not installed'
  : false
const whyMissingCheck = whyMissingLint
  || (missing('govulncheck', ['-version']) ? 'govulncheck not installed' : false)

if (process.env.GO_GATES === '1' && whyMissingCheck) {
  throw new Error(`GO_GATES=1 but the go toolchain is incomplete: ${whyMissingCheck}`)
}

const skipLint = whyMissingLint
const skipCheck = whyMissingCheck

const write = (dir, rel, body) => {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

const assemble = (dir) => {
  mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
  mkdirSync(join(dir, '.dev/kit/go'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
  writeFileSync(join(dir, '.dev/kit/go/go.just'), readFileSync(join(KIT_GO, 'go.just')))
  cpSync(FIXTURE, join(dir, 'api'), { recursive: true })
  writeFileSync(join(dir, 'api/.golangci.yml'), readFileSync(join(KIT_GO, 'golangci.base.yml')))
  writeFileSync(
    join(dir, 'justfile'),
    'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/common/gate.just'\n"
      + "import '.dev/kit/go/go.just'\n"
      + 'go_dir := "api"\n',
  )
}

const runEnv = {
  ...process.env,
  GOCACHE,
  GOMODCACHE,
  GOLANGCI_LINT_CACHE,
  GOTOOLCHAIN: 'local',
}

const runJust = (dir, recipe) => {
  const r = spawnSync('just', [recipe], { cwd: dir, encoding: 'utf8', env: runEnv })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const GREEN = readFileSync(join(FIXTURE, 'add.go'), 'utf8')

test('the shipped golangci config is v2 and names the jalon linters', () => {
  const yml = readFileSync(join(KIT_GO, 'golangci.base.yml'), 'utf8')
  assert.match(yml, /^version:\s*"2"/m)
  for (const name of ['errcheck', 'govet', 'staticcheck', 'unused', 'gosec'])
    assert.match(yml, new RegExp(`- ${name}\\b`))
  assert.match(yml, /formatters:[\s\S]*- gofmt/)
})

describe('go quality gates', { concurrency: 1 }, () => {
  test('just go-lint passes on the witness module', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'go-lint')
      assert.equal(r.status, 0, `go-lint must be green:\n${r.out}`)
    })
  })

  test('just go-check passes on the witness module', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'go-check')
      assert.equal(r.status, 0, `go-check must be green:\n${r.out}`)
    })
  })

  test('just go-lint fails when gofmt would rewrite a file', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, 'package gateprobe\n\nfunc AddOne(n int) int {return n+1}\n')
      const r = runJust(dir, 'go-lint')
      assert.notEqual(r.status, 0, 'a format miss must fail go-lint')
      assert.match(r.out, /gofmt|File is not/)
    })
  })

  test('just go-lint fails on an unhandled error', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        SRC,
        'package gateprobe\n\nimport "os"\n\nfunc AddOne(n int) int {\n	os.Open("x")\n	return n + 1\n}\n',
      )
      const r = runJust(dir, 'go-lint')
      assert.notEqual(r.status, 0, `errcheck must fail go-lint:\n${r.out}`)
      assert.match(r.out, /errcheck|Error return value/)
    })
  })

  test('just go-lint fails on unused code', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, GREEN.replace(
        'func AddOne',
        'var leftover = 1\n\nfunc AddOne',
      ))
      const r = runJust(dir, 'go-lint')
      assert.notEqual(r.status, 0, `unused must fail go-lint:\n${r.out}`)
      assert.match(r.out, /unused|leftover/)
    })
  })

  test('just go-check fails when a unit test fails', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        'api/add_test.go',
        'package gateprobe\n\nimport "testing"\n\nfunc TestAddOne(t *testing.T) {\n	if AddOne(1) != 99 {\n		t.Fatal("expected 99")\n	}\n}\n',
      )
      const lint = runJust(dir, 'go-lint')
      assert.equal(lint.status, 0, `a red test is not a lint failure:\n${lint.out}`)
      const r = runJust(dir, 'go-check')
      assert.notEqual(r.status, 0, `a red test must fail go-check:\n${r.out}`)
      assert.match(r.out, /FAIL|expected 99/)
    })
  })
})
