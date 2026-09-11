// The kit's two document gates are real code, so they get real tests. Black-box:
// build a throwaway docs/ tree, run the script, assert exit code + message.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const DOCS_CHECK = join(REPO, 'kit', 'common', 'docs-check.mjs')
const ADR_CHECK = join(REPO, 'kit', 'common', 'adr-check.mjs')

const run = (script, args, cwd) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const write = (dir, rel, body) => {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, body)
}
const filler = (n) => 'word '.repeat(n)

const PLAN_INDEX = `# Plan: X

## Phases

| # | Phase | Status |
|---|---|---|
| [01](./plan/01-a.md) | A | Shipped 2026-01-01 |
`
const PHASE = `# Phase 01: A

- **Status**: Shipped 2026-01-01

## What we ship

A thing.
`

// ------------------------------------------------------------- the just library
// The gates are a just LIBRARY the consuming repo imports. A `.just` that does not
// parse is a repo whose every gate is dead — including `just --list` — so this
// assembles the whole thing the way `init` does and asks `just` itself. Skipped when
// just is not installed: this must not turn a machine without it into a red suite.
const JUST = spawnSync('just', ['--version'], { encoding: 'utf8' })
const LIBS = [
  'common/gate.just',
  'rust/rust.just',
  'ts/ts.just',
  'ts-web/ts-web.just',
  'ts-node/ts-node.just',
  'ts-tauri/ts-tauri.just',
  'go/go.just',
  'python/python.just',
  'godot/godot.just',
]

test('the whole kit library parses, and the root justfile overrides it', { skip: JUST.error ? 'just not installed' : false }, () => {
  withTmpRepo(dir => {
    for (const lib of LIBS) {
      const to = join(dir, '.dev/kit', lib)
      mkdirSync(join(to, '..'), { recursive: true })
      writeFileSync(to, readFileSync(join(REPO, 'kit', lib), 'utf8'))
    }
    writeFileSync(join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + LIBS.map(l => `import '.dev/kit/${l}'`).join('\n')
      + '\nrust_dir := "api"\nbase := "origin/trunk"\ncheck: rust-check\n')

    const summary = spawnSync('just', ['--summary'], { cwd: dir, encoding: 'utf8' })
    assert.equal(summary.status, 0, `the library does not parse:\n${summary.stderr}`)
    // Every recipe the shipped snippets promise, in one flat namespace — `mod` would
    // have namespaced them (and moved the working directory), breaking every trigger.
    const recipes = new Set(summary.stdout.trim().split(/\s+/))
    for (const r of ['check', 'rust-check', 'ts-check', 'ts-web-check', 'ts-node-check', 'ts-tauri-check',
                     'go-check', 'python-check', 'godot-check',
                     'rust-mutate', 'ts-mutate', 'ts-web-mutate', 'go-cover', 'python-mutate',
                     'code-review', 'review-guard', 'adr-check', 'docs-check', 'rules-check', 'dup-check', 'status',
                     'mutate-from', 'mutate-mark'])
      assert.ok(recipes.has(r), `${r} is not resolvable`)

    // `mutate-diff` (the repo's own recipe) feeds the cleared commit to the mutator,
    // so the range start is a PARAMETER — defaulting to the whole branch, which is what
    // a repo that installed rust without kit/common still gets.
    const shown = spawnSync('just', ['--show', 'rust-mutate'], { cwd: dir, encoding: 'utf8' })
    assert.match(shown.stdout, /rust-mutate from=base:/)
    assert.match(shown.stdout, /git diff \{\{ ?from ?\}\}\.\.\.HEAD/)

    // The override is the contract that lets a repo adapt a gate without forking it.
    const vars = spawnSync('just', ['--evaluate'], { cwd: dir, encoding: 'utf8' })
    assert.equal(vars.status, 0, vars.stderr)
    assert.match(vars.stdout, /rust_dir\s+:= "api"/, 'the root justfile must win over the library')
    assert.match(vars.stdout, /base\s+:= "origin\/trunk"/)
    // Tier 3 speed is knobs, not a rewrite: -j ships at the same 2 as mutation-ci.yaml,
    // and every flag that needs something copied or installed first (--profile mutants,
    // --test-tool, --baseline=skip, --in-place) stays OFF by default, because
    // `claude-rules update` must not change what an old install actually runs.
    assert.match(shown.stdout, /-j \{\{ ?mutate_jobs ?\}\}/, 'rust-mutate must pass the jobs knob')
    assert.match(vars.stdout, /mutate_jobs\s+:= "2"/)
    assert.match(vars.stdout, /mutate_args\s+:= ""/, 'the escape hatch ships empty')
    // The gate scripts are called where they ship — nothing to move into scripts/.
    assert.match(vars.stdout, /review_prompt\s+:= "\.dev\/kit\/common\/review-prompt\.md"/)
  })
})

// ------------------------------------------------- the review recipes, no LLM
// `code-review` and `review-with` share the three `review-<agent>` recipes, so their
// shell handling is testable without any agent CLI: assemble the library, override
// `review-claude` in the root justfile with a stub, and assert what lands on disk.
// These are regressions from a consuming repo, not hypotheticals.
function withReviewRepo(stub, fn) {
  withTmpRepo(dir => {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '.')
    git('config', 'user.email', 't@t.t'); git('config', 'user.name', 'T')
    writeFileSync(join(dir, 'a.txt'), 'x\n')
    git('add', '-A'); git('commit', '-q', '-m', 'init')

    mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
    for (const f of ['gate.just', 'review-prompt.md', 'diff-since.mjs', 'review-guard.mjs'])
      writeFileSync(join(dir, '.dev/kit/common', f), readFileSync(join(REPO, 'kit/common', f), 'utf8'))
    // `base := "HEAD"` keeps `git diff {{base}}...HEAD` valid with one commit and no remote.
    writeFileSync(join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/common/gate.just'\nbase := \"HEAD\"\n" + stub)
    fn(dir, (...args) => spawnSync('just', args, { cwd: dir, encoding: 'utf8' }))
  })
}
const COPY_STUB = 'review-claude:\n    cp {{review_in}} {{review_out}}\n'

test('review-with: the topic reaches printf as data, never as a format string or shell words',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(COPY_STUB, (dir, just) => {
    // Two bugs in one line, both reproduced against the pre-fix recipe: `%s`/`%n` were
    // eaten by printf's FORMAT argument, and a topic that balances its quotes closes
    // the shell quote and runs what follows — `touch PWNED` did execute.
    const topic = "50%s%n of it x'; touch PWNED; echo '"
    const r = just('review-with', 'claude', topic)
    assert.equal(r.status, 0, r.stderr)

    const prompt = readFileSync(join(dir, '.work/adhoc-prompt.md'), 'utf8')
    assert.match(prompt, /=== FOCUS ===/)
    assert.ok(prompt.includes(topic), `the topic must be emitted verbatim, got:\n${prompt.slice(-400)}`)
    assert.ok(!existsSync(join(dir, 'PWNED')), 'a topic must never reach the shell')
  })
})

test('review-with keeps its own scratch pair: an ad-hoc run cannot leave the gate a temp file',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(COPY_STUB, (dir, just) => {
    assert.equal(just('review-with', 'claude', 'anything').status, 0)
    assert.ok(existsSync(join(dir, '.work/adhoc-review.tmp')), 'the ad-hoc output is its own file')
    assert.ok(!existsSync(join(dir, '.work/review.tmp')),
      "an ad-hoc review must not write the gate's temp — that is what code-review's mv promotes")
  })
})

test('code-review clears its temp before dispatch, so mv can never promote a stale verdict',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  // A reviewer recipe that exits 0 without writing: the pre-fix `mv` promoted whatever
  // temp file was already on disk as if this run had produced it.
  withReviewRepo(BASE_PREV + 'review-claude:\n    @true\n', (dir, just) => {
    // A real diff, so the run reaches dispatch: with nothing new since the last pass
    // the recipe refuses BEFORE it, and this test would pass without proving anything.
    write(dir, 'src/x.rs', 'fn x() {}\n')
    commitAll(dir)
    mkdirSync(join(dir, '.work'), { recursive: true })
    writeFileSync(join(dir, '.work/review.tmp'), 'REVIEWED: deadbeef\nVERDICT: CLEAN\n')

    const r = just('code-review', 'claude')
    assert.notEqual(r.status, 0, 'a review that produced nothing must fail, not pass a stale file')
    assert.ok(!existsSync(join(dir, '.work/review-report.md')), 'no verdict may be promoted')
  })
})

test('code-review validates the reviewer through quote(), so the check survives the value',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(COPY_STUB, (dir, just) => {
    const r = just('code-review', "x'; touch PWNED2; #")
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stdout + r.stderr, /unknown reviewer/)
    assert.ok(!existsSync(join(dir, 'PWNED2')), 'the validation line must not evaluate its own input')
  })
})

// `base := "HEAD~1"` (overriding withReviewRepo's `HEAD`, which diffs a commit against
// itself) lets a test commit a real change and get a real diff out of the recipe.
const BASE_PREV = 'base := "HEAD~1"\n'
const commitAll = (dir) => {
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  git('add', '-A'); git('commit', '-q', '-m', 'change')
}

test('the prompt lists every changed file but omits generated/vendored/locked bodies',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  // Measured on a real consuming repo: two thirds of a 693 KB diff was lockfile,
  // installed agent-rules tree and codegen, so the reviewer reviewed THIS library
  // instead of the feature. The inventory stays complete: an omission the reviewer
  // cannot see is an omission it reads as "unchanged".
  withReviewRepo(BASE_PREV + COPY_STUB, (dir, just) => {
    write(dir, 'src/reviewed.rs', 'fn reviewed() {}\n')
    write(dir, 'Cargo.lock', 'LOCKED_BODY\n')
    write(dir, '.claude/skills/x/SKILL.md', 'VENDORED_BODY\n')
    write(dir, '.work/prompt.md', 'PREVIOUS_PROMPT_BODY\n')
    write(dir, 'apps/web/src/routeTree.gen.ts', 'GENERATED_BODY\n')
    commitAll(dir)

    assert.equal(just('review-with', 'claude', '').status, 0)
    const prompt = readFileSync(join(dir, '.work/adhoc-prompt.md'), 'utf8')

    assert.match(prompt, /=== FILES CHANGED \(full inventory\) ===/)
    for (const f of ['Cargo.lock', '.claude/skills/x/SKILL.md', '.work/prompt.md',
                     'apps/web/src/routeTree.gen.ts', 'src/reviewed.rs'])
      assert.ok(prompt.includes(f), `the inventory must name every changed file, missing ${f}`)

    for (const body of ['LOCKED_BODY', 'VENDORED_BODY', 'PREVIOUS_PROMPT_BODY', 'GENERATED_BODY'])
      assert.ok(!prompt.includes(body), `${body} must not reach the reviewer's context`)
    assert.match(prompt, /fn reviewed/, 'source is never excluded')
  })
})

test('an oversized prompt fails before dispatch instead of truncating the review',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  // Truncation would not shrink the review, it would review an unknown subset and
  // still return a verdict — a CLEAN over code the reviewer never received.
  withReviewRepo(BASE_PREV + 'review_max_bytes := "12000"\n' + COPY_STUB, (dir, just) => {
    write(dir, 'big.rs', 'fn f() { let _ = 1; }\n'.repeat(2000))
    commitAll(dir)

    const r = just('code-review', 'claude')
    assert.notEqual(r.status, 0, 'a prompt over the cap must fail the gate')
    assert.match(r.stdout + r.stderr, /prompt too large/)
    assert.ok(!existsSync(join(dir, '.work/review-report.md')),
      'the check runs before dispatch, so no verdict can be promoted')
  })
})

// ------------------------------------------------- incremental Tier 3 (the marker)
// A branch built by successive loops used to pay, on every block, for every block
// before it: `git diff <base>...HEAD` is the whole branch. The marker under
// `.work/<slug>/` is how much of it a gate already cleared.
//
// `COPY_STUB` cannot serve here — its "report" is the prompt, which carries no verdict
// markers, so the guard blocks and nothing is ever marked. These need a reviewer that
// files a real verdict AND keeps the prompt it was handed.
const VERDICT_STUB = (verdict = 'CLEAN') =>
  'review-claude:\n'
  + '    cp {{review_in}} .work/seen-prompt.md\n'
  + `    printf '<!-- CI_VERDICT: ${verdict} -->\\n<!-- REVIEWED: %s -->\\n' "$(git rev-parse HEAD)" > {{review_out}}\n`
// A fixed trunk: `base := "HEAD~1"` moves with HEAD, so it cannot tell "the whole
// branch" from "the last commit" — which is the very distinction under test.
const TRUNK = 'base := "trunk"\nwork_slug := "cap"\n'
const MARKER = '.work/cap/.latest_review'
const promptOf = (dir) => readFileSync(join(dir, '.work/seen-prompt.md'), 'utf8')
const trunkAt = (dir) => spawnSync('git', ['branch', 'trunk'], { cwd: dir })

test('code-review reviews only what a previous pass has not already cleared',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(TRUNK + VERDICT_STUB(), (dir, just) => {
    trunkAt(dir)
    write(dir, 'first.rs', 'FIRST_BLOCK\n')
    commitAll(dir)
    assert.equal(just('code-review', 'claude').status, 0)
    assert.ok(promptOf(dir).includes('FIRST_BLOCK'), 'the first block is the whole branch')
    assert.ok(existsSync(join(dir, MARKER)), 'a passing review records what it cleared')

    write(dir, 'second.rs', 'SECOND_BLOCK\n')
    commitAll(dir)
    assert.equal(just('code-review', 'claude').status, 0)
    const prompt = promptOf(dir)
    assert.ok(!prompt.includes('FIRST_BLOCK'), 'a cleared block must not be re-reviewed')
    assert.ok(prompt.includes('SECOND_BLOCK'), 'the new block is what is under review')
    // The inventory stays WHOLE-branch: an incremental diff must never read as "the
    // earlier commits do not exist" — that is the same trap as review_exclude.
    assert.match(prompt, /=== REVIEWED THROUGH ===/)
    assert.ok(prompt.includes('first.rs') && prompt.includes('second.rs'),
      'the --stat inventory covers the branch, not the increment')
  })
})

test('the marker is per developer: it gitignores itself even where .work/ is committed',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(TRUNK + VERDICT_STUB(), (dir, just) => {
    trunkAt(dir)
    write(dir, 'first.rs', 'FIRST_BLOCK\n')
    commitAll(dir)
    assert.equal(just('code-review', 'claude').status, 0)
    const ignore = readFileSync(join(dir, '.work/.gitignore'), 'utf8')
    for (const pattern of ['*/.latest_review', '*/.latest_mutate'])
      assert.ok(ignore.split('\n').includes(pattern), `${pattern} must never be shared`)
  })
})

test('a CRITICAL leaves the marker where it was, so the fix comes back with its block',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(TRUNK + VERDICT_STUB('CRITICAL'), (dir, just) => {
    trunkAt(dir)
    write(dir, 'first.rs', 'FIRST_BLOCK\n')
    commitAll(dir)
    assert.notEqual(just('code-review', 'claude').status, 0, 'a CRITICAL fails the gate')
    assert.ok(!existsSync(join(dir, MARKER)), 'nothing was cleared, so nothing is recorded')

    // The fix, and a reviewer that now signs off: the block it fixes must be in the diff.
    writeFileSync(join(dir, 'justfile'),
      readFileSync(join(dir, 'justfile'), 'utf8').replace('CI_VERDICT: CRITICAL', 'CI_VERDICT: CLEAN'))
    write(dir, 'first.rs', 'FIRST_BLOCK fixed\n')
    commitAll(dir)
    assert.equal(just('code-review', 'claude').status, 0)
    assert.ok(promptOf(dir).includes('FIRST_BLOCK'), 'a block that never passed is still under review')
  })
})

test('nothing new since the last pass is refused before dispatch, never reviewed again',
  { skip: JUST.error ? 'just not installed' : false }, () => {
  withReviewRepo(TRUNK + VERDICT_STUB(), (dir, just) => {
    trunkAt(dir)
    write(dir, 'first.rs', 'FIRST_BLOCK\n')
    commitAll(dir)
    assert.equal(just('code-review', 'claude').status, 0)
    const verdict = readFileSync(join(dir, '.work/review-report.md'), 'utf8')

    const again = just('code-review', 'claude')
    assert.equal(again.status, 2, 'an empty range is a refusal, not an LLM call over nothing')
    assert.match(again.stdout + again.stderr, /nothing new since the last passing review/)
    assert.equal(readFileSync(join(dir, '.work/review-report.md'), 'utf8'), verdict,
      'the standing verdict is what review-guard reads — a refusal must not disturb it')

    // The escape hatch: the whole-branch pass, worth one run before the PR.
    const full = spawnSync('just', ['incremental=0', 'code-review', 'claude'], { cwd: dir, encoding: 'utf8' })
    assert.equal(full.status, 0, full.stderr)
    assert.ok(promptOf(dir).includes('FIRST_BLOCK'))
  })
})

// ---------------------------------------------------------------- diff-since.mjs
// The fallbacks, on the script directly: every way the marker can be wrong costs one
// full pass, never a hidden commit. Cheaper to enumerate here than through the recipe.
const DIFF_SINCE = join(REPO, 'kit', 'common', 'diff-since.mjs')
// stdout carries the ref ALONE — the caller reads it inside `$( )`, so the
// diagnostics have to stay on stderr. Asserting that split is half the point.
const since = (dir, ...args) => {
  const r = spawnSync(process.execPath,
    [DIFF_SINCE, 'review', '--base', 'trunk', '--slug', 'cap', ...args], { cwd: dir, encoding: 'utf8' })
  return { status: r.status, ref: (r.stdout || '').trim(), why: r.stderr || '' }
}

test('diff-since: a marker that no longer describes this branch falls back to the base', () => {
  withTmpRepo((dir) => {
    const [first, head] = commits(dir, 2)
    git(dir, 'branch', 'trunk', first)

    const cases = {
      'no marker yet': null,
      'not a sha': 'HEAD~1\n',
      'a commit that is gone (rebased, amended)': 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
    }
    for (const [why, body] of Object.entries(cases)) {
      if (body === null) rmSync(join(dir, '.work'), { recursive: true, force: true })
      else write(dir, '.work/cap/.latest_review', body)
      const r = since(dir)
      assert.equal(r.status, 0)
      assert.equal(r.ref, 'trunk', `${why}: must diff the whole branch`)
    }

    // A commit that exists but is not an ancestor of HEAD: the branch was reset or
    // switched under the marker, so what it cleared is not what is here now.
    write(dir, '.work/cap/.latest_review', `${head}\n`)
    git(dir, 'reset', '--hard', '-q', first)
    const moved = since(dir)
    assert.equal(moved.ref, 'trunk')
    assert.match(moved.why, /not an ancestor of HEAD/)
  })
})

test('diff-since: a live marker is the range start, and incremental=0 overrides it', () => {
  withTmpRepo((dir) => {
    const [first] = commits(dir, 2)
    git(dir, 'branch', 'trunk', first)
    write(dir, '.work/cap/.latest_review', `${first}\n`)

    assert.equal(since(dir).ref, first, 'stdout is the ref alone, diagnostics go to stderr')
    assert.equal(since(dir, '--incremental', '0').ref, 'trunk')
  })
})

test('diff-since: --mark records only a real commit, and the two kinds are separate', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir, 1)
    const bad = run(DIFF_SINCE, ['review', '--mark', 'deadbeef', '--slug', 'cap'], dir)
    assert.equal(bad.status, 2, 'a marker that is not a commit is worse than no marker')
    assert.ok(!existsSync(join(dir, '.work/cap/.latest_review')))

    assert.equal(run(DIFF_SINCE, ['mutate', '--mark', head, '--slug', 'cap'], dir).status, 0)
    assert.ok(existsSync(join(dir, '.work/cap/.latest_mutate')))
    assert.ok(!existsSync(join(dir, '.work/cap/.latest_review')),
      'review and mutate clear at their own cadence — one marker each')
  })
})

test('diff-since: with no --slug the marker follows the branch, sanitized into one segment', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir, 1)
    git(dir, 'checkout', '-q', '-b', 'feat/big-thing')
    assert.equal(run(DIFF_SINCE, ['review', '--mark', head], dir).status, 0)
    assert.ok(existsSync(join(dir, '.work/feat-big-thing/.latest_review')),
      'a branch name is a path here — its slashes must not become directories')
  })
})

test('review-guard: --require-report turns "not run" into a failure, for the recipe only', () => {
  withTmpRepo((dir) => {
    commits(dir)
    // The hole it closes: a CLI that exits 0 having written nothing left the guard at 0,
    // and code-review would then have marked unreviewed code as cleared.
    write(dir, '.work/review-report.md', '')
    const strict = run(REVIEW_GUARD, ['--require-report'], dir)
    assert.equal(strict.status, 1, 'the reviewer produced no verdict — that is not a pass')
    assert.match(strict.out, /never as green/)

    const hook = run(REVIEW_GUARD, [], dir)
    assert.equal(hook.status, 0, 'the pre-push contract is unchanged: declared, never simulated')
  })
})

test('docs-check: no docs/ is not a failure', () => {
  withTmpRepo((dir) => {
    const r = run(DOCS_CHECK, ['docs'], dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /nothing to check/)
  })
})

test('docs-check: a coherent index + units passes even in --strict', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PLAN.md', PLAN_INDEX)
    write(dir, 'docs/plan/01-a.md', PHASE)
    const r = run(DOCS_CHECK, ['docs', '--strict'], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /in order/)
  })
})

test('docs-check: index/unit disagreement fails without --strict (it is a fact, not a judgment)', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PLAN.md', PLAN_INDEX + '| [09](./plan/09-ghost.md) | Ghost | Planned |\n')
    write(dir, 'docs/plan/01-a.md', PHASE)
    write(dir, 'docs/plan/03-orphan.md', '# Phase 03\n\n- **Status**: Planned\n')

    const r = run(DOCS_CHECK, ['docs'], dir)
    assert.equal(r.status, 1)
    assert.match(r.out, /09-ghost\.md, which does not exist/)
    assert.match(r.out, /03-orphan\.md: no link/)
  })
})

test('docs-check: budgets warn by default and fail under --strict', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PLAN.md', PLAN_INDEX)
    write(dir, 'docs/plan/01-a.md', PHASE + filler(700))

    const warn = run(DOCS_CHECK, ['docs'], dir)
    assert.equal(warn.status, 0, 'a size judgment must not block by default')
    assert.match(warn.out, /docs-check warning: 1 × unit over its ceiling/)
    assert.match(warn.out, /advisory here/)

    assert.equal(run(DOCS_CHECK, ['docs', '--strict'], dir).status, 1)
  })
})

test('docs-check: a single-file PRD/PLAN past the threshold is told to split', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PLAN.md', `# Plan\n\n${'## Phase N: x\n\nbody\n\n'.repeat(9)}`)
    write(dir, 'docs/PRD.md', `# PRD\n\n## Problem\n\n### Coach — x (continued)\n\nbody\n`)

    const r = run(DOCS_CHECK, ['docs'], dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /9 units \(threshold 6\)/)
    assert.match(r.out, /split into docs\/plan\//)
    assert.match(r.out, /`\(continued\)` heading/)
  })
})

test('docs-check: docs/adr is left to adr-check', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/adr/0001-x.md', `# ADR-0001\n\n### Something (continued)\n\n${filler(900)}`)
    const r = run(DOCS_CHECK, ['docs', '--strict'], dir)
    assert.equal(r.status, 0, r.out)
  })
})

// The budgets are defaults. A repo moves them in a file the installer never writes, so
// `claude-rules update` cannot reset a threshold the repo argued for.
test('docs-check: a per-document index ceiling from .docs-budgets.json wins', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PRD.md', `# PRD\n\n${filler(600)}\n\n[a](./prd/01-a.md)\n`)
    write(dir, 'docs/prd/01-a.md', '# Capability 01\n\nA thing.\n')

    const before = run(DOCS_CHECK, ['docs'], dir)
    assert.match(before.out, /docs\/PRD\.md — 60\d words \(ceiling 500\)/)
    assert.equal(run(DOCS_CHECK, ['docs', '--strict'], dir).status, 1)

    write(dir, '.docs-budgets.json', '{ "$why": "12 capabilities", "prd": { "indexCeiling": 1500 } }')
    const after = run(DOCS_CHECK, ['docs', '--strict'], dir)
    assert.equal(after.status, 0, after.out)
    assert.match(after.out, /Overridden in \.docs-budgets\.json: prd\.indexCeiling=1500/)

    // …and only for the document that declared it: PLAN.md keeps the global default.
    write(dir, 'docs/PLAN.md', `# Plan\n\n${filler(600)}\n\n[a](./plan/01-a.md)\n`)
    write(dir, 'docs/plan/01-a.md', PHASE)
    assert.match(run(DOCS_CHECK, ['docs'], dir).out, /docs\/PLAN\.md — 60\d words \(ceiling 500\)/)
  })
})

test('docs-check: null is no ceiling, and a typo is an error (never a silently disabled budget)', () => {
  withTmpRepo((dir) => {
    write(dir, 'docs/PLAN.md', PLAN_INDEX)
    write(dir, 'docs/plan/01-a.md', PHASE + filler(700))

    write(dir, '.docs-budgets.json', '{ "plan": { "unitCeiling": null } }')
    assert.equal(run(DOCS_CHECK, ['docs', '--strict'], dir).status, 0)

    write(dir, '.docs-budgets.json', '{ "plan": { "unitCieling": 900 } }')
    const typo = run(DOCS_CHECK, ['docs'], dir)
    assert.equal(typo.status, 2)
    assert.match(typo.out, /unknown key "plan\.unitCieling"/)

    write(dir, '.docs-budgets.json', '{ "plan": { "unitCeiling": 0 } }')
    assert.equal(run(DOCS_CHECK, ['docs'], dir).status, 2)

    write(dir, '.docs-budgets.json', '{ oops')
    assert.match(run(DOCS_CHECK, ['docs'], dir).out, /not valid JSON/)
  })
})

test('adr-check: over the ceiling warns, and --strict promotes it', () => {
  withTmpRepo((dir) => {
    write(
      dir,
      'docs/adr/0001-x.md',
      `# ADR-0001: x\n\n- **Status**: Proposed\n\n## Context\n\n${filler(700)}`,
    )
    const warn = run(ADR_CHECK, ['docs/adr'], dir)
    assert.equal(warn.status, 0)
    assert.match(warn.out, /over the 600-word ceiling/)
    assert.equal(run(ADR_CHECK, ['docs/adr', '--strict'], dir).status, 1)

    // Same repo-owned override file as docs-check; its PRD/PLAN keys are not adr-check's.
    write(dir, '.docs-budgets.json', '{ "prd": { "indexCeiling": 1500 }, "adr": { "unitCeiling": 900 } }')
    const raised = run(ADR_CHECK, ['docs/adr', '--strict'], dir)
    assert.equal(raised.status, 0, raised.out)
    assert.match(raised.out, /Overridden in \.docs-budgets\.json: adr\.unitCeiling=900/)

    write(dir, '.docs-budgets.json', '{ "adr": { "wordCeiling": 900 } }')
    assert.equal(run(ADR_CHECK, ['docs/adr'], dir).status, 2)
  })
})

test('adr-check: a section outside the canonical set is named', () => {
  withTmpRepo((dir) => {
    write(
      dir,
      'docs/adr/0001-x.md',
      '# ADR-0001: x\n\n- **Status**: Proposed\n\n## Context\n\nshort.\n\n## Amendment — later\n\nnote.\n',
    )
    const r = run(ADR_CHECK, ['docs/adr'], dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /outside the canonical set/)
    assert.match(r.out, /"Amendment — later"/)
  })
})

test('adr-check: a conforming record is silent', () => {
  withTmpRepo((dir) => {
    write(
      dir,
      'docs/adr/0001-x.md',
      '# ADR-0001: x\n\n- **Status**: Proposed\n- **Date**: 2026-07-30\n\n' +
        '## Context\n\nshort.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nfine.\n\n' +
        '## Alternatives considered\n\n- **a** — no.\n\n## Implemented\n\nproved by a test.\n',
    )
    const r = run(ADR_CHECK, ['docs/adr', '--strict'], dir)
    assert.equal(r.status, 0, r.out)
    assert.doesNotMatch(r.out, /warning|error/)
  })
})

// ── review-guard ───────────────────────────────────────────────────────────
// One test per line of the contract table (kit/common/review-guard.mjs). The
// review itself is an LLM's judgment; THIS is the part a machine can settle, so
// it is the part that gets pinned.
const REVIEW_GUARD = join(REPO, 'kit', 'common', 'review-guard.mjs')

const git = (dir, ...args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.error) throw r.error
  return (r.stdout || '').trim()
}
/** A repo with `n` commits, newest last — returns their shas. */
const commits = (dir, n = 1) => {
  git(dir, 'init', '-q')
  const shas = []
  for (let i = 0; i < n; i++) {
    write(dir, `f${i}.txt`, `${i}\n`)
    git(dir, 'add', '-A')
    git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `c${i}`)
    shas.push(git(dir, 'rev-parse', 'HEAD'))
  }
  return shas
}
const report = (verdict, sha) =>
  `## Code Review: x\n\n### Verdict\n\nfine.\n\n<!-- CI_VERDICT: ${verdict} -->\n<!-- REVIEWED: ${sha} -->\n`

test('review-guard: an absent report is declared, never simulated', () => {
  withTmpRepo((dir) => {
    commits(dir)
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, 'a missing step must not block — the same contract as mutate-diff')
    assert.match(r.out, /code review not run/)
    assert.match(r.out, /never as green/)
  })
})

test('review-guard: CLEAN or WARNINGS at HEAD passes', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    for (const verdict of ['CLEAN', 'WARNINGS']) {
      write(dir, '.work/review-report.md', report(verdict, head))
      const r = run(REVIEW_GUARD, [], dir)
      assert.equal(r.status, 0, r.out)
      assert.match(r.out, new RegExp(`${verdict} at ${head.slice(0, 7)} — the review describes HEAD`))
    }
  })
})

test('review-guard: CLEAN or WARNINGS on an older commit passes, with a stale notice', () => {
  withTmpRepo((dir) => {
    const [first] = commits(dir, 3)
    write(dir, '.work/review-report.md', report('WARNINGS', first))
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, 'a trivial commit after a review must not cost a new review')
    assert.match(r.out, /reviewed \w{7} and not HEAD \(2 commit\(s\) since\)/)
    assert.match(r.out, /Stale, not blocking/)
  })
})

test('review-guard: CRITICAL blocks, and one more commit does not expire it', () => {
  withTmpRepo((dir) => {
    const [first] = commits(dir, 1)
    write(dir, '.work/review-report.md', report('CRITICAL', first))
    const atHead = run(REVIEW_GUARD, [], dir)
    assert.equal(atHead.status, 1)
    assert.match(atHead.out, /found CRITICAL issues/)

    commits(dir, 1) // "commit once more and the CRITICAL goes stale" — the hole this closes
    const stale = run(REVIEW_GUARD, [], dir)
    assert.equal(stale.status, 1, 'a CRITICAL does not expire with HEAD')
    assert.match(stale.out, /does not expire/)
    assert.match(stale.out, /HEAD has moved.*changes nothing here/)
  })
})

test('review-guard: a report whose markers cannot be parsed blocks', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    const cases = {
      'no markers at all': '## Code Review\n\nlooks fine to me.\n',
      // The output template, pasted verbatim: three verdicts is no verdict.
      'the template verbatim': '<!-- CI_VERDICT: CRITICAL|WARNINGS|CLEAN -->\n<!-- REVIEWED: ' + head + ' -->\n',
      'no REVIEWED marker': '<!-- CI_VERDICT: CLEAN -->\n',
      'a sha that is not one': report('CLEAN', 'HEAD'),
      // The markers are read LAST-wins, so several of them is not the malformation —
      // a LAST one that is not a verdict is.
      'the last verdict is not a verdict':
        '<!-- CI_VERDICT: CLEAN -->\n<!-- CI_VERDICT: probably fine -->\n<!-- REVIEWED: ' + head + ' -->\n',
    }
    for (const [name, body] of Object.entries(cases)) {
      write(dir, '.work/review-report.md', body)
      const r = run(REVIEW_GUARD, [], dir)
      assert.equal(r.status, 1, `${name}: a malformed report is a falsifiable report — ${r.out}`)
      assert.match(r.out, /is malformed/)
    }
  })
})

// The recipe redirects into the report, and `>` truncates before the CLI runs — so a
// review that dies leaves a 0-byte file. Read as malformed, that blocked every push on
// the machine (the hook has no glob) with no way out but the review that just failed.
test('review-guard: an empty report is "not run", never malformed', () => {
  withTmpRepo((dir) => {
    commits(dir)
    for (const body of ['', '\n\n', '   \n']) {
      write(dir, '.work/review-report.md', body)
      const r = run(REVIEW_GUARD, [], dir)
      assert.equal(r.status, 0, `an empty report must not block: ${r.out}`)
      assert.match(r.out, /is empty — code review not run/)
    }
  })
})

// A review that QUOTES the output contract in a fix suggestion — which happens exactly
// when the diff touches the prompt or the reviewer agent — used to be read as having
// two verdicts, and blocked. The markers live at the END of the report; anything
// earlier is prose about markers.
test('review-guard: a report that quotes the contract is judged on its tail', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    const quoted = '## Code Review\n\nFix: end the report with\n\n```\n'
      + '<!-- CI_VERDICT: CRITICAL|WARNINGS|CLEAN -->\n<!-- REVIEWED: <full sha of HEAD> -->\n```\n\n'
    write(dir, '.work/review-report.md', quoted + report('CLEAN', head))
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, `the real verdict is the one at the end: ${r.out}`)
    assert.match(r.out, /CLEAN/)

    write(dir, '.work/review-report.md', quoted + report('CRITICAL', head))
    assert.equal(run(REVIEW_GUARD, [], dir).status, 1, 'and a CRITICAL at the end still blocks')
  })
})

// The first attempt at "the markers are at the end" was a fixed 6-line tail window, and
// it blocked on an ordinary report: a review that signs off with a few lines of prose
// pushes its own markers out of the window, review-guard reads NO verdict, and every
// push is refused as malformed. The window also missed what it was for — a contract
// quoted right next to the real markers stayed inside it and still counted as a second
// verdict. Last-wins is what the contract promises the reviewer, so it is what runs.
test('review-guard: markers followed by prose still parse', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    const chatter = '\nDone. Let me know if you want the second batch applied too,\n'
      + 'and I can split the refactor out into its own commit.\n\nHappy to iterate.\n'
    write(dir, '.work/review-report.md', report('CLEAN', head) + chatter)
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, `a signed-off report is not a malformed one: ${r.out}`)
    assert.match(r.out, /the review describes HEAD/)

    write(dir, '.work/review-report.md', report('CRITICAL', head) + chatter)
    assert.equal(run(REVIEW_GUARD, [], dir).status, 1, 'and a CRITICAL is still a CRITICAL')
  })
})

test('review-guard: a contract quoted right before the markers is prose, not a verdict', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    // No padding between the quote and the real markers — the case a tail window cannot
    // separate, and the shape a review takes when the diff touches the prompt itself.
    const adjacent = '## Code Review\n\nFix: end the report with\n'
      + '<!-- CI_VERDICT: CRITICAL|WARNINGS|CLEAN -->\n<!-- REVIEWED: <full sha of HEAD> -->\n'
      + `<!-- CI_VERDICT: CLEAN -->\n<!-- REVIEWED: ${head} -->\n`
    write(dir, '.work/review-report.md', adjacent)
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, `the verdict is the last one, whatever precedes it: ${r.out}`)
    assert.match(r.out, /CLEAN/)
  })
})

test('review-guard: two reports back to back are judged on the newer one', () => {
  withTmpRepo((dir) => {
    const [head] = commits(dir)
    write(dir, '.work/review-report.md', report('CRITICAL', head) + '\n' + report('CLEAN', head))
    assert.equal(run(REVIEW_GUARD, [], dir).status, 0, 'the last verdict wins')
    write(dir, '.work/review-report.md', report('CLEAN', head) + '\n' + report('CRITICAL', head))
    assert.equal(run(REVIEW_GUARD, [], dir).status, 1, 'in both directions')
  })
})

test('review-guard: with no commit yet there is nothing to compare against', () => {
  withTmpRepo((dir) => {
    git(dir, 'init', '-q')
    write(dir, '.work/review-report.md', report('CLEAN', 'abc1234'))
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /nothing to compare it against/)
  })
})

// ── worktree-status ────────────────────────────────────────────────────────
// The counterpart of review-guard: that one is the gate in ONE tree, this one is
// the report across ALL of them. So what gets pinned here is that it aggregates
// faithfully (a CRITICAL in a sibling tree is visible from here), that the
// escalation channel /tasks defines actually surfaces, and that it NEVER blocks —
// a dashboard with an exit code is a second gate nobody asked for.
const WT_STATUS = join(REPO, 'kit', 'common', 'worktree-status.mjs')

/** A sprint worklist / loop.md, with the `## Blocked on the human` section
 *  /tasks and /loop-setup both write. */
const worklist = (blockers) =>
  '# Sprint 02: split — worklist\n\n## Tasks\n\n- [ ] T1\n\n## Blocked on the human\n\n'
  + '<!-- What the loop cannot decide or access. -->\n'
  + (blockers.length ? blockers.map((b) => `- ${b}\n`).join('') : '- <blocker>\n')

test('worktree-status: outside a repo it says so and still exits 0', () => {
  withTmpRepo((dir) => {
    const r = run(WT_STATUS, [], dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /not a git repository/)
  })
})

test('worktree-status: one tree, no review — the normal case reads as such', () => {
  withTmpRepo((dir) => {
    commits(dir)
    const r = run(WT_STATUS, ['HEAD'], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /^1 worktree · base HEAD/m)
    assert.match(r.out, /\* \./, 'the tree you are standing in is marked')
    assert.match(r.out, /clean/)
    assert.match(r.out, /no report/)
  })
})

test('worktree-status: a CRITICAL in a SIBLING tree is visible from here', () => {
  withTmpRepo((dir) => {
    const main = join(dir, 'main')
    mkdirSync(main, { recursive: true })
    const [head] = commits(main)
    const sibling = join(dir, 'side')
    git(main, 'worktree', 'add', '-q', '-b', 'phase/02-split', sibling)
    const sideHead = git(sibling, 'rev-parse', 'HEAD')
    write(sibling, '.work/review-report.md', report('CRITICAL', sideHead))
    write(main, '.work/review-report.md', report('CLEAN', head))

    const r = run(WT_STATUS, ['HEAD'], main)
    assert.equal(r.status, 0, 'it reports; review-guard is what blocks')
    assert.match(r.out, /^2 worktrees/m)
    assert.match(r.out, /phase\/02-split.*CRITICAL → blocks/)
    assert.match(r.out, /CLEAN/, "and the tree you are in keeps its own verdict — that is the whole point")
  })
})

test('worktree-status: a sprint worklist and its blockers surface, placeholders do not', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/split/tasks/02-split.md', worklist([]))
    const quiet = run(WT_STATUS, ['HEAD'], dir)
    assert.match(quiet.out, /split\/tasks\/02-split/)
    assert.doesNotMatch(quiet.out, /BLOCKED/, 'an untouched template is not an escalation')
    assert.doesNotMatch(quiet.out, /waiting on you/)

    write(dir, '.work/split/tasks/02-split.md', worklist(['the PRD says X, the schema says Y — which wins?']))
    const loud = run(WT_STATUS, ['HEAD'], dir)
    assert.equal(loud.status, 0)
    assert.match(loud.out, /BLOCKED: the PRD says X, the schema says Y/)
    assert.match(loud.out, /1 tree\(s\) waiting on you/)
  })
})

test('worktree-status: loop.md escalates the same way a sprint worklist does', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/onboarding/loop.md', worklist(['waiting on the API key']))
    const r = run(WT_STATUS, ['HEAD'], dir)
    assert.match(r.out, /onboarding\/loop/)
    assert.match(r.out, /BLOCKED: waiting on the API key/)
  })
})

test('worktree-status: a sprint worklist outranks a loop.md in the same capability', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/split/loop.md', worklist(['stale — /tasks already cut this sprint']))
    write(dir, '.work/split/tasks/02-split.md', worklist([]))
    const r = run(WT_STATUS, ['HEAD'], dir)
    assert.match(r.out, /split\/tasks\/02-split \(\+1\)/, 'the sprint worklist sorts last and wins, the loop.md is only counted')
    assert.doesNotMatch(r.out, /BLOCKED/, 'it reads the winning file, not the stale loop.md')
  })
})

test('worktree-status: a capability with no tasks/ yet and no loop.md reports —', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/planned/PLAN.md', '# Plan\n')
    const r = run(WT_STATUS, ['HEAD'], dir)
    assert.match(r.out, /  —  /)
    assert.doesNotMatch(r.out, /BLOCKED/)
  })
})

test('worktree-status: a stale or malformed verdict is reported as itself, never guessed', () => {
  withTmpRepo((dir) => {
    const [first] = commits(dir, 3)
    write(dir, '.work/review-report.md', report('WARNINGS', first))
    assert.match(run(WT_STATUS, ['HEAD'], dir).out, /WARNINGS \(stale, \+2\)/)

    write(dir, '.work/review-report.md', '## Code Review\n\nlooks fine to me.\n')
    const r = run(WT_STATUS, ['HEAD'], dir)
    assert.equal(r.status, 0)
    assert.match(r.out, /malformed → blocks/, 'the guard would block on it, so the report must say so')
  })
})

test('worktree-status: an unknown base is a missing column, not a crash', () => {
  withTmpRepo((dir) => {
    commits(dir)
    const r = run(WT_STATUS, ['origin/does-not-exist'], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /base origin\/does-not-exist/)
    assert.match(r.out, /—/, 'the ahead count is unknown, and says so')
  })
})

// ── publish-summary ──────────────────────────────────────────────────────────
// The per-loop counterpart of worktree-status: one worktree, once, at the moment a
// loop stops. What gets pinned here: it resolves the same loop.md-then-newest-worklist
// file worktree-status already sorts by, it reports mechanically (nothing it prints is
// LLM-authored), a bad run never corrupts a prior SUMMARY.md, and status is enforced
// even when called directly (the recipe's `case` guard is bypassed here on purpose).
const PUBLISH_SUMMARY = join(REPO, 'kit', 'common', 'publish-summary.mjs')

/** A `.work/<slug>/loop.md`, matching skills/loop-setup's `<loop-file-template>`. */
const loopMd = ({
  objective = 'ship the thing',
  cap = '20 turns',
  budget = '200k tokens',
  items = ['- [x] step one', '- [ ] step two'],
  log = ['- turn 1: wired the client'],
  blocked = [],
} = {}) =>
  `# Loop — ${objective}\n\n`
  + `- **Objective (bounded)**: ${objective}\n`
  + '- **Done-command**: `npm test`\n'
  + '- **Type**: closed\n\n'
  + '## Guardrails\n\n'
  + `- **Iteration cap**: ${cap}\n`
  + `- **Token budget**: ${budget}\n`
  + '- **Escalate when**: cap/budget hit\n'
  + '- **Out of scope**: nothing else\n\n'
  + '## Remaining work\n\n'
  + `${items.join('\n')}\n\n`
  + '## Log\n\n'
  + `${(log.length ? log : ['- <turn>: <win or dead end>']).join('\n')}\n\n`
  + '## Blocked on the human\n\n'
  + `${(blocked.length ? blocked.map((b) => `- ${b}`) : ['- <blocker>']).join('\n')}\n`

test('publish-summary: a missing slug is a usage error', () => {
  withTmpRepo((dir) => {
    const r = run(PUBLISH_SUMMARY, [], dir)
    assert.equal(r.status, 2)
    assert.match(r.out, /missing slug/)
  })
})

test('publish-summary: an unknown status is rejected, by name', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/demo/loop.md', loopMd())
    const r = run(PUBLISH_SUMMARY, ['demo', 'DONE'], dir)
    assert.equal(r.status, 2)
    assert.match(r.out, /unknown status: DONE/)
  })
})

test('publish-summary: no .work/<slug>/ directory is a usage error', () => {
  withTmpRepo((dir) => {
    commits(dir)
    const r = run(PUBLISH_SUMMARY, ['ghost', 'COMPLETED'], dir)
    assert.equal(r.status, 2)
    assert.match(r.out, /no \.work\/ghost\//)
  })
})

test('publish-summary: a slug dir with no loop.md and no tasks/ is a usage error', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/empty/PLAN.md', '# Plan\n')
    const r = run(PUBLISH_SUMMARY, ['empty', 'COMPLETED'], dir)
    assert.equal(r.status, 2)
    assert.match(r.out, /no loop\.md or tasks/)
  })
})

test('publish-summary: loop.md happy path — status, objective, guardrails, checklist, blocked all land', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/demo/loop.md', loopMd({
      items: ['- [x] step one', '- [ ] step two'],
      log: ['- turn 1: wired the client', '- turn 2: fixed the flaky test'],
      blocked: ['the API key is missing'],
    }))
    const r = run(PUBLISH_SUMMARY, ['demo', 'COMPLETED'], dir)
    assert.equal(r.status, 0, r.out)
    const summary = readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8')
    assert.match(summary, /\*\*Status\*\*: COMPLETED/)
    assert.match(summary, /\*\*Objective\*\*: ship the thing/)
    assert.match(summary, /\*\*Iteration cap\*\*: 20 turns/)
    assert.match(summary, /\*\*Token budget\*\*: 200k tokens/)
    assert.match(summary, /## Remaining work \(1\/2 done\)/)
    assert.match(summary, /- \[x\] step one/)
    assert.match(summary, /- \[ \] step two/)
    assert.match(summary, /- the API key is missing/)
    assert.match(summary, /\*\*Turns logged\*\*: 2/)
  })
})

test('publish-summary: tasks/NN-*.md is used when there is no loop.md, and the newest NN wins', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/split/tasks/01-first.md', worklist([]))
    write(dir, '.work/split/tasks/02-split.md', worklist(['need a decision on X']))
    const r = run(PUBLISH_SUMMARY, ['split', 'BLOCKED'], dir)
    assert.equal(r.status, 0, r.out)
    const summary = readFileSync(join(dir, '.work/split/SUMMARY.md'), 'utf8')
    assert.match(summary, /- need a decision on X/)
  })
})

test('publish-summary: an untouched Blocked-on-the-human placeholder prints as none', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/quiet/loop.md', loopMd({ blocked: [] }))
    const r = run(PUBLISH_SUMMARY, ['quiet', 'COMPLETED'], dir)
    assert.equal(r.status, 0, r.out)
    const summary = readFileSync(join(dir, '.work/quiet/SUMMARY.md'), 'utf8')
    assert.match(summary, /## Blocked on the human\n\n— none —/)
  })
})

test('publish-summary: a real diff renders a diffstat line, an unresolvable base renders —', () => {
  withTmpRepo((dir) => {
    const [first] = commits(dir, 2)
    write(dir, '.work/demo/loop.md', loopMd())

    const withDiff = run(PUBLISH_SUMMARY, ['demo', 'COMPLETED', first], dir)
    assert.equal(withDiff.status, 0, withDiff.out)
    let summary = readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8')
    assert.match(summary, /\*\*Diff\*\*: 1 file changed/)

    const noBase = run(PUBLISH_SUMMARY, ['demo', 'COMPLETED', 'origin/does-not-exist'], dir)
    assert.equal(noBase.status, 0, noBase.out)
    summary = readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8')
    assert.match(summary, /\*\*Diff\*\*: —/)
    assert.match(summary, /Ahead of origin\/does-not-exist\*\*: —/)
  })
})

test('publish-summary: all three statuses are accepted', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/demo/loop.md', loopMd())
    for (const status of ['COMPLETED', 'BLOCKED', 'BUDGET_EXHAUSTED']) {
      const r = run(PUBLISH_SUMMARY, ['demo', status], dir)
      assert.equal(r.status, 0, `${status}: ${r.out}`)
      const summary = readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8')
      assert.match(summary, new RegExp(`\\*\\*Status\\*\\*: ${status}`))
    }
  })
})

test('publish-summary: a sprint worklist with no Objective bullet falls back to its title', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/split/tasks/02-split.md', worklist([]))
    const r = run(PUBLISH_SUMMARY, ['split', 'BLOCKED'], dir)
    assert.equal(r.status, 0, r.out)
    const summary = readFileSync(join(dir, '.work/split/SUMMARY.md'), 'utf8')
    assert.match(summary, /\*\*Objective\*\*: Sprint 02: split — worklist/)
  })
})

test('publish-summary: a rejected run never touches a previous SUMMARY.md', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/demo/loop.md', loopMd())
    write(dir, '.work/demo/SUMMARY.md', 'SENTINEL — do not overwrite\n')
    const r = run(PUBLISH_SUMMARY, ['demo', 'NOPE'], dir)
    assert.equal(r.status, 2)
    assert.equal(readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8'), 'SENTINEL — do not overwrite\n')
  })
})

test('publish-summary: an untouched Log placeholder counts as zero turns', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/demo/loop.md', loopMd({ log: [] }))
    const r = run(PUBLISH_SUMMARY, ['demo', 'COMPLETED'], dir)
    assert.equal(r.status, 0, r.out)
    const summary = readFileSync(join(dir, '.work/demo/SUMMARY.md'), 'utf8')
    assert.match(summary, /\*\*Turns logged\*\*: 0/)
  })
})


// Generated code is excluded from code review (`review_exclude` in gate.just) and must
// also be excluded from mutation: nobody wrote the assertions that would catch such a
// mutant, and "fixing" a survivor means editing a file the generator overwrites. This
// is the one exclusion list that ships FILLED, so a future edit cannot quietly comment
// it back out — the sprint that regenerates an API client is the one that turns a
// gate off, and it is thousands of mutants, not the usual few dozen.
test('kit/rust/mutants.toml ships generated-code exclusions, not just a commented example', () => {
  const toml = readFileSync(join(REPO, 'kit', 'rust', 'mutants.toml'), 'utf8')
  const block = toml.match(/^exclude_globs = \[([\s\S]*?)^\]/m)
  assert.ok(block, 'mutants.toml must declare exclude_globs at the top level')
  const live = block[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  assert.ok(live.length > 0, 'exclude_globs is empty — the generated-code defaults were removed')
  assert.ok(live.some(l => /generated/.test(l)), 'no generated-code glob left in exclude_globs')
})
