// The rust jalon is a just library plus the configs those recipes read. A comment
// that lists `cargo fmt` / `clippy` / `deny` is not a gate — this is: a throwaway
// repo, the shipped rust.just, the shipped rustfmt.toml + deny.toml, then `just`
// itself. Locally, skipped when the toolchain is not installed (Node-only
// `npm test` stays green). The rust-gates CI job sets RUST_GATES=1 so a missing
// tool is a red job, never a skip-as-pass.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const FIXTURE = join(REPO, 'test', 'fixtures', 'rust-gate')
const KIT_RUST = join(REPO, 'kit', 'rust')
const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR || join(tmpdir(), 'claude-rules-rust-gate-target')
const ADVISORY_DB = join(tmpdir(), 'claude-rules-advisory-db')
const HOME_DB = join(homedir(), '.cargo/advisory-db')
const LIB = 'api/src/lib.rs'
const TIMEOUT = 120_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

// cargo deny takes an exclusive lock on the advisory db. The shipped path is
// ~/.cargo/advisory-db, which is often not writable in a sandbox. Copy once
// into tmp so the recipe still runs `cargo deny check …` against the real
// policy, without writing to the user's cargo home.
const seedAdvisoryDb = () => {
  try {
    if (existsSync(join(ADVISORY_DB, 'db.lock'))) return true
    if (!existsSync(HOME_DB)) return false
    mkdirSync(ADVISORY_DB, { recursive: true })
    cpSync(HOME_DB, ADVISORY_DB, { recursive: true })
    return existsSync(join(ADVISORY_DB, 'db.lock'))
  } catch {
    return false
  }
}

const whyMissingLint = missing('just', ['--version']) ? 'just not installed'
  : missing('cargo', ['--version']) ? 'cargo not installed'
  : missing('cargo', ['fmt', '--version']) ? 'rustfmt not installed'
  : missing('cargo', ['clippy', '--version']) ? 'clippy not installed'
  : false
const whyMissingCheck = whyMissingLint
  || (missing('cargo', ['deny', '--version']) ? 'cargo-deny not installed' : false)
  || (missing('cargo', ['machete', '--version']) ? 'cargo-machete not installed' : false)
  || (seedAdvisoryDb() ? false : 'cargo-deny advisory-db not present')

if (process.env.RUST_GATES === '1' && whyMissingCheck) {
  throw new Error(`RUST_GATES=1 but the rust toolchain is incomplete: ${whyMissingCheck}`)
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
  mkdirSync(join(dir, '.dev/kit/rust'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
  writeFileSync(join(dir, '.dev/kit/rust/rust.just'), readFileSync(join(KIT_RUST, 'rust.just')))
  cpSync(FIXTURE, join(dir, 'api'), {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[/\\]/).pop()
      return name !== 'target' && name !== 'deny.toml'
    },
  })
  writeFileSync(join(dir, 'api/rustfmt.toml'), readFileSync(join(KIT_RUST, 'rustfmt.toml')))
  writeFileSync(
    join(dir, 'api/deny.toml'),
    readFileSync(join(KIT_RUST, 'deny.toml'), 'utf8').replace(
      'db-path = "~/.cargo/advisory-db"',
      `db-path = "${ADVISORY_DB.split('\\').join('/')}"`,
    ),
  )
  // Same shape `init` writes: common first (`base`), then the language library.
  writeFileSync(
    join(dir, 'justfile'),
    'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/common/gate.just'\n"
      + "import '.dev/kit/rust/rust.just'\n"
      + 'rust_dir := "api"\n',
  )
}

const runJust = (dir, recipe) => {
  const r = spawnSync('just', [recipe], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TARGET_DIR },
  })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const GREEN_LIB = readFileSync(join(FIXTURE, 'src/lib.rs'), 'utf8')

describe('rust quality gates', { concurrency: 1 }, () => {
  test('just rust-lint passes on the witness crate', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'rust-lint')
      assert.equal(r.status, 0, `rust-lint must be green:\n${r.out}`)
    })
  })

  test('just rust-check passes on the witness crate', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'rust-check')
      assert.equal(r.status, 0, `rust-check must be green:\n${r.out}`)
    })
  })

  test('just rust-lint fails when rustfmt would rewrite a file', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, LIB, 'pub fn add_one(n:i32)->i32{n+1}\n')
      const r = runJust(dir, 'rust-lint')
      assert.notEqual(r.status, 0, 'a format miss must fail rust-lint')
      assert.match(r.out, /Diff in|rustfmt|Cannot write formatted/)
    })
  })

  test('just rust-lint fails on a clippy warning', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, LIB, 'pub fn add_one(n: i32) -> i32 {\n    let unused = 1;\n    n + 1\n}\n')
      const r = runJust(dir, 'rust-lint')
      assert.notEqual(r.status, 0, `-D warnings must fail rust-lint:\n${r.out}`)
      assert.match(r.out, /unused variable/)
    })
  })

  test('just rust-lint fails on unwrap in the lib, not in tests', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        LIB,
        GREEN_LIB.replace(
          '    n + 1',
          '    n.checked_add(1).unwrap()',
        ),
      )
      const r = runJust(dir, 'rust-lint')
      assert.notEqual(r.status, 0, `unwrap in lib must fail rust-lint:\n${r.out}`)
      assert.match(r.out, /unwrap_used|used `unwrap\(\)`/)
    })
  })

  test('just rust-lint fails on unwrap in a bin', {
    skip: skipLint,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        'api/src/main.rs',
        'fn main() {\n    let n: i32 = "1".parse().unwrap();\n    println!("{n}");\n}\n',
      )
      const r = runJust(dir, 'rust-lint')
      assert.notEqual(r.status, 0, `unwrap in a bin must fail rust-lint:\n${r.out}`)
      assert.match(r.out, /unwrap_used|used `unwrap\(\)`/)
    })
  })

  test('just rust-check fails when a unit test fails', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, LIB, GREEN_LIB.replace('assert_eq!(add_one(1), 2)', 'assert_eq!(add_one(1), 99)'))
      const lint = runJust(dir, 'rust-lint')
      assert.equal(lint.status, 0, `a red test is not a lint failure:\n${lint.out}`)
      const r = runJust(dir, 'rust-check')
      assert.notEqual(r.status, 0, `a red test must fail rust-check:\n${r.out}`)
      assert.match(r.out, /FAILED|assertion/)
    })
  })

  test('just rust-check fails on a disallowed license', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        'api/vendor/gpl_probe/Cargo.toml',
        '[package]\nname = "gpl_probe"\nversion = "0.1.0"\nedition = "2021"\nlicense = "GPL-3.0-only"\n',
      )
      write(dir, 'api/vendor/gpl_probe/src/lib.rs', 'pub fn mark() {}\n')
      write(
        dir,
        'api/Cargo.toml',
        readFileSync(join(FIXTURE, 'Cargo.toml'), 'utf8') + 'gpl_probe = { path = "vendor/gpl_probe" }\n',
      )
      write(
        dir,
        LIB,
        GREEN_LIB.replace(
          '    n + 1',
          '    gpl_probe::mark();\n    n + 1',
        ),
      )
      const r = runJust(dir, 'rust-check')
      assert.notEqual(r.status, 0, `GPL must fail cargo deny:\n${r.out}`)
      assert.match(r.out, /failed to satisfy license|unlicensed-or-disallowed|GPL-3\.0-only/)
    })
  })

  test('just rust-check fails on an unused dependency', {
    skip: skipCheck,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        'api/vendor/unused_probe/Cargo.toml',
        '[package]\nname = "unused_probe"\nversion = "0.1.0"\nedition = "2021"\nlicense = "MIT"\npublish = false\n',
      )
      write(dir, 'api/vendor/unused_probe/src/lib.rs', 'pub fn mark() {}\n')
      write(
        dir,
        'api/Cargo.toml',
        readFileSync(join(FIXTURE, 'Cargo.toml'), 'utf8') + 'unused_probe = { path = "vendor/unused_probe" }\n',
      )
      const r = runJust(dir, 'rust-check')
      assert.notEqual(r.status, 0, `machete must fail rust-check:\n${r.out}`)
      assert.match(r.out, /unused_probe/)
      assert.match(r.out, /found unused dependenc|unused dependencies/)
    })
  })
})
