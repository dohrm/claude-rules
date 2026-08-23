// The python jalon is a just library plus the pyproject tables those recipes
// read. A comment that lists `ruff` / `mypy` / `deptry` is not a gate — this
// is: a throwaway repo, the shipped python.just, the shipped snippet merged
// into the witness pyproject, then `just` itself. Locally, skipped when just
// or uv is missing. The python-gates CI job sets PYTHON_GATES=1 so a missing
// tool is a red job, never a skip-as-pass.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const FIXTURE = join(REPO, 'test', 'fixtures', 'python-gate')
const KIT_PY = join(REPO, 'kit', 'python')
const UV_CACHE_DIR = join(tmpdir(), 'claude-rules-python-gate-uv-cache')
const SRC = 'api/src/gate_probe/__init__.py'
const TIMEOUT = 180_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

const whyMissing = missing('just', ['--version']) ? 'just not installed'
  : missing('uv', ['--version']) ? 'uv not installed'
  : false

if (process.env.PYTHON_GATES === '1' && whyMissing) {
  throw new Error(`PYTHON_GATES=1 but the python toolchain is incomplete: ${whyMissing}`)
}

const skip = whyMissing

const write = (dir, rel, body) => {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

const assemble = (dir) => {
  mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
  mkdirSync(join(dir, '.dev/kit/python'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
  writeFileSync(join(dir, '.dev/kit/python/python.just'), readFileSync(join(KIT_PY, 'python.just')))
  cpSync(FIXTURE, join(dir, 'api'), {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[/\\]/).pop()
      return name !== '.venv' && name !== '__pycache__' && name !== '.ruff_cache' && name !== '.mypy_cache'
    },
  })
  writeFileSync(
    join(dir, 'justfile'),
    'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/common/gate.just'\n"
      + "import '.dev/kit/python/python.just'\n"
      + 'python_dir := "api"\n',
  )
}

const runEnv = {
  ...process.env,
  UV_CACHE_DIR,
  UV_PYTHON: '3.12',
  UV_LINK_MODE: 'copy',
}

const runJust = (dir, recipe) => {
  const r = spawnSync('just', [recipe], { cwd: dir, encoding: 'utf8', env: runEnv })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const GREEN_SRC = readFileSync(join(FIXTURE, 'src/gate_probe/__init__.py'), 'utf8')

const selectOf = (text) => {
  const m = text.match(/select = \[([\s\S]*?)\]/)
  assert.ok(m, 'pyproject is missing [tool.ruff.lint] select')
  return m[1].trim()
}

test('the witness pyproject ships the snippet ruff select and mypy strict', () => {
  const fixture = readFileSync(join(FIXTURE, 'pyproject.toml'), 'utf8')
  const snippet = readFileSync(join(KIT_PY, 'pyproject.snippet.toml'), 'utf8')
  assert.equal(selectOf(fixture), selectOf(snippet))
  assert.match(fixture, /strict = true/)
  assert.match(fixture, /files = \["src", "tests"\]/)
})

describe('python quality gates', { concurrency: 1 }, () => {
  test('just python-lint passes on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'python-lint')
      assert.equal(r.status, 0, `python-lint must be green:\n${r.out}`)
    })
  })

  test('just python-check passes on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'python-check')
      assert.equal(r.status, 0, `python-check must be green:\n${r.out}`)
    })
  })

  test('just python-lint fails when ruff format would rewrite a file', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, 'def add_one(n: int) -> int:\n    return n+1\n')
      const r = runJust(dir, 'python-lint')
      assert.notEqual(r.status, 0, 'a format miss must fail python-lint')
      assert.match(r.out, /Would reformat|error/)
    })
  })

  test('just python-lint fails on a ruff finding', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, 'import os\n\n\ndef add_one(n: int) -> int:\n    return n + 1\n')
      const r = runJust(dir, 'python-lint')
      assert.notEqual(r.status, 0, `ruff check must fail python-lint:\n${r.out}`)
      assert.match(r.out, /F401|imported but unused/)
    })
  })

  test('just python-lint fails on a swallowed exception', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        SRC,
        'def add_one(n: int) -> int:\n'
          + '    try:\n        return n + 1\n    except Exception:\n        pass\n    return n\n',
      )
      const r = runJust(dir, 'python-lint')
      assert.notEqual(r.status, 0, `S110/TRY must fail python-lint:\n${r.out}`)
      assert.match(r.out, /S110|TRY|pass/)
    })
  })

  test('just python-check fails on a mypy error that lint does not see', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, 'def add_one(n):\n    return n + 1\n')
      const lint = runJust(dir, 'python-lint')
      assert.equal(lint.status, 0, `missing annotations are not a ruff finding:\n${lint.out}`)
      const r = runJust(dir, 'python-check')
      assert.notEqual(r.status, 0, `mypy must fail python-check:\n${r.out}`)
      assert.match(r.out, /no-untyped-def|annotation/)
    })
  })

  test('just python-check fails when a unit test fails', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, 'api/tests/test_add.py', 'from gate_probe import add_one\n\n\ndef test_increments() -> None:\n    assert add_one(1) == 99\n')
      const lint = runJust(dir, 'python-lint')
      assert.equal(lint.status, 0, `a red test is not a lint failure:\n${lint.out}`)
      const r = runJust(dir, 'python-check')
      assert.notEqual(r.status, 0, `a red test must fail python-check:\n${r.out}`)
      assert.match(r.out, /failed|AssertionError/)
    })
  })

  test('just python-check fails when pyproject has drifted from the lock', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const toml = readFileSync(join(dir, 'api/pyproject.toml'), 'utf8')
      write(dir, 'api/pyproject.toml', toml.replace('dependencies = []', 'dependencies = ["httpx"]'))
      const r = runJust(dir, 'python-check')
      assert.notEqual(r.status, 0, `--locked must fail python-check:\n${r.out}`)
      assert.match(r.out, /--locked|lockfile|uv.lock/)
    })
  })

  test('just python-check fails on an unused dependency', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const toml = readFileSync(join(dir, 'api/pyproject.toml'), 'utf8')
      write(dir, 'api/pyproject.toml', toml.replace('dependencies = []', 'dependencies = ["requests"]'))
      const locked = spawnSync('uv', ['lock', '--python', '3.12'], {
        cwd: join(dir, 'api'),
        encoding: 'utf8',
        env: runEnv,
      })
      assert.equal(locked.status, 0, `uv lock must refresh after the extra dep:\n${locked.stdout}${locked.stderr}`)
      const r = runJust(dir, 'python-check')
      assert.notEqual(r.status, 0, `deptry must fail python-check:\n${r.out}`)
      assert.match(r.out, /DEP002|requests/)
    })
  })
})
