// scope-report.mjs — the per-package indicator of what a branch touched against what its
// RFC's steps declared. Black-box: a fixture repo, the script run in it, the markdown read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo, fixtureGit } from './helpers.mjs'

const SCOPE_REPORT = join(REPO, 'kit', 'common', 'scope-report.mjs')
const JUST = spawnSync('just', ['--version'], { encoding: 'utf8' })

const write = (dir, rel, body) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), body)
}
const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [SCOPE_REPORT, ...args], { cwd: dir, encoding: 'utf8' })
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
/** The table row of `pkg`, or undefined. */
const row = (out, pkg) => out.split('\n').find((l) => l.startsWith(`| \`${pkg}\` |`))

/** A repo with a root manifest and a base commit on `trunk`, then `branch` checked out. */
function repo(dir, branch = 'work') {
  write(dir, 'package.json', '{}\n')
  write(dir, 'README.md', 'x\n')
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'base'], ['branch', 'trunk'],
    ['checkout', '-q', '-b', branch]]) fixtureGit(dir, args)
}
const commit = (dir) => {
  fixtureGit(dir, ['add', '-A'])
  fixtureGit(dir, ['commit', '-q', '-m', 'change'])
}
const RFC = (steps, header = '- **Branch**: work\n') =>
  `# RFC — X\n\n- **Status**: implementing\n${header}\n## Steps\n\n${steps}\n\n## Open questions\n\n- none\n`

test('scope-report: a local RFC — declared packages say yes, the rest is overflow', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `src/a.rs`, `docs/` → proof: `test/a.test.mjs`'))
    write(dir, 'src/a.rs', 'a\nb\n')
    write(dir, 'docs/guide.md', 'x\n')
    write(dir, 'test/a.test.mjs', 'x\n')
    write(dir, 'CLAUDE.md', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /Declared by: \.work\/x\/rfc\.md \(local RFC\)/)
    assert.equal(row(r.out, 'src'), '| `src` | +2 | -0 | yes |', 'the root manifest is the repo, not a package')
    assert.equal(row(r.out, 'docs'), '| `docs` | +1 | -0 | yes |')
    assert.match(row(r.out, 'test'), /\*\*no — overflow\*\*/, 'a proof is not a touch')
    assert.match(row(r.out, '.'), /\*\*no — overflow\*\*/, 'a root file is package `.`')
    assert.ok(!r.out.includes('`.work`'), 'the RFC\'s own state is never a touch')
    assert.match(r.out, /4 touched, 2 not declared, 0 declared but untouched/)
  })
})

test('scope-report: a ticket RFC is read from the review\'s cache', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('', '- **Branch**: work\n- **Ticket**: https://example.test/issues/9\n'))
    write(dir, '.work/x/review-context.md',
      `Fetched now\n${RFC('- [x] a — touches `lib/b.go` → proof: `go test`')}\nA COMMENT\n## Steps\n\n- [ ] late — touches \`ghost/x.go\`\n`)
    write(dir, 'lib/b.go', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /Declared by: https:\/\/example\.test\/issues\/9, cached in \.work\/x\/review-context\.md at \d{4}-/)
    assert.equal(row(r.out, 'lib'), '| `lib` | +1 | -0 | yes |')
    assert.equal(row(r.out, 'ghost'), undefined, 'only the body\'s first Steps section declares')
  })
})

test('scope-report: no RFC still reports the packages, with nothing declared', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /No RFC for this branch \(slug `work`, from the branch name\): nothing declared/)
    assert.equal(row(r.out, 'src'), '| `src` | +1 | -0 | — |')
    assert.doesNotMatch(r.out, /overflow/)
  })
})

test('scope-report: a defect diagnosis declares nothing, so nothing reads as overflow', () => {
  withTmpRepo((dir) => {
    repo(dir, 'fix/x')
    write(dir, '.work/x/defect.md', '# Defect — X\n\n- **Branch**: fix/x\n\n## Root cause\n\n`src/a.rs` drops the error.\n')
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /\.work\/x\/defect\.md is a defect diagnosis: no steps declare/)
    assert.equal(row(r.out, 'src'), '| `src` | +1 | -0 | — |')
    assert.doesNotMatch(r.out, /overflow/)
  })
})

test('scope-report: a ticket pointer with no cache is declared, never read as none', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('', '- **Branch**: work\n- **Ticket**: https://example.test/issues/9\n'))
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /RFC not available: \.work\/x\/rfc\.md points to https:\/\/example\.test\/issues\/9/)
    assert.equal(row(r.out, 'src'), '| `src` | +1 | -0 | — |')
  })
})

test('scope-report: nested manifests are packages — the nearest one wins', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, 'crates/core/Cargo.toml', '[package]\n')
    write(dir, 'crates/core/src/deep/x.rs', 'x\n')
    write(dir, 'crates/cli/Cargo.toml', '[package]\n')
    write(dir, 'crates/cli/src/main.rs', 'x\n')
    write(dir, 'apps/game/Game.csproj', '<Project/>\n')
    write(dir, 'apps/game/Player.cs', 'x\n')
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `crates/core/src/deep/x.rs`, `apps/game/`'))
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.equal(row(r.out, 'crates/core'), '| `crates/core` | +2 | -0 | yes |')
    assert.match(row(r.out, 'crates/cli'), /overflow/, 'a sibling crate is its own package')
    assert.equal(row(r.out, 'apps/game'), '| `apps/game` | +2 | -0 | yes |', 'a `*.csproj` is a manifest')
    assert.equal(row(r.out, 'crates'), undefined)
  })
})

test('scope-report: symbols and patterns in touches are ignored, only paths declare', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `justfile` (`base`), `PATTERNS` gains `*/.review_passes`, '
      + '`fn run()`, `src/a.rs` → proof: `kit/x.test.mjs`'))
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /1 package in the steps' `touches`/)
    assert.equal(row(r.out, 'src'), '| `src` | +1 | -0 | yes |')
    for (const ghost of ['*', 'kit', 'justfile', 'base']) assert.equal(row(r.out, ghost), undefined, ghost)
  })
})

test('scope-report: a dotted symbol is not a path — only an existing root file declares without a `/`', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `err.message`, `self.state`, `v1.2`, `README.md`, `src/a.rs`'))
    write(dir, 'src/a.rs', 'x\n')
    write(dir, 'README.md', 'y\n')
    write(dir, 'lib/b.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /2 packages in the steps' `touches`/, '`.` (README.md) and `src`, nothing else')
    assert.equal(row(r.out, '.'), '| `.` | +1 | -1 | yes |', 'a root file that exists declares')
    assert.match(row(r.out, 'lib'), /overflow/)
    for (const ghost of ['err.message', 'self.state', 'v1.2']) assert.equal(row(r.out, ghost), undefined, ghost)
  })
})

test('scope-report: a dotted symbol cannot hide a root-file overflow', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `src/a.rs`, reads `err.message`'))
    write(dir, 'src/a.rs', 'x\n')
    write(dir, 'CLAUDE.md', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(row(r.out, '.'), /\*\*no — overflow\*\*/)
  })
})

test('scope-report: a declared package the diff never touched is listed as such', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `src/a.rs`\n- [ ] b — touches `migrations/001.sql`'))
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.equal(row(r.out, 'migrations'), '| `migrations` | 0 | 0 | declared, untouched |')
    assert.match(r.out, /1 touched, 0 not declared, 1 declared but untouched/)
  })
})

test('scope-report: on an L4 phase branch, only that phase\'s steps declare', () => {
  withTmpRepo((dir) => {
    repo(dir, 'phase/x/2')
    write(dir, '.work/x/rfc.md', RFC('### Phase 1 — a → proof: `t`\n\n- [x] a — touches `old/a.rs`\n\n'
      + '### Phase 2 — b → proof: `t`\n\n- [ ] b — touches `new/b.rs`', '- **Branch**: rfc/x\n'))
    write(dir, 'new/b.rs', 'x\n')
    commit(dir)
    const r = run(dir, 'trunk')
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /Declared by: Phase 2 of \.work\/x\/rfc\.md/)
    assert.equal(row(r.out, 'new'), '| `new` | +1 | -0 | yes |')
    assert.equal(row(r.out, 'old'), undefined, 'a merged phase is not "declared, untouched" here')
  })
})

test('scope-report: an unresolvable base is the one failure — nothing to report', () => {
  withTmpRepo((dir) => {
    repo(dir)
    const r = run(dir, 'origin/does-not-exist')
    assert.equal(r.status, 2)
    assert.match(r.err, /git cannot diff against `origin\/does-not-exist`/)
    assert.equal(run(dir).status, 2, 'no base is a usage error')
  })
})

test('just scope-report runs the script on `base` and the resolved slug',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withTmpRepo((dir) => {
    repo(dir)
    mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
    for (const f of ['gate.just', 'scope-report.mjs', 'review-context.mjs', 'work-slug.mjs'])
      writeFileSync(join(dir, '.dev/kit/common', f), readFileSync(join(REPO, 'kit/common', f), 'utf8'))
    write(dir, 'justfile', "import '.dev/kit/common/gate.just'\n")
    write(dir, '.work/x/rfc.md', RFC('- [ ] a — touches `src/a.rs`'))
    write(dir, 'src/a.rs', 'x\n')
    commit(dir)
    const r = spawnSync('just', ['base=trunk', 'scope-report'], { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /## Scope report — `trunk\.\.\.HEAD`/)
    assert.equal(row(r.stdout, 'src'), '| `src` | +1 | -0 | yes |')
    assert.match(row(r.stdout, '.dev'), /overflow/, 'the installed kit is a package like any other')
  })
})
