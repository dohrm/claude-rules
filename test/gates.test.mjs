// The kit's two document gates are real code, so they get real tests. Black-box:
// build a throwaway docs/ tree, run the script, assert exit code + message.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
const LIBS = ['common/gate.just', 'rust/rust.just', 'ts/ts.just', 'go/go.just', 'python/python.just', 'godot/godot.just']

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
    for (const r of ['check', 'rust-check', 'ts-check', 'go-check', 'python-check', 'godot-check',
                     'rust-mutate', 'ts-mutate', 'go-cover', 'python-mutate',
                     'code-review', 'review-guard', 'adr-check', 'docs-check', 'rules-check', 'dup-check', 'status'])
      assert.ok(recipes.has(r), `${r} is not resolvable`)

    // The override is the contract that lets a repo adapt a gate without forking it.
    const vars = spawnSync('just', ['--evaluate'], { cwd: dir, encoding: 'utf8' })
    assert.equal(vars.status, 0, vars.stderr)
    assert.match(vars.stdout, /rust_dir\s+:= "api"/, 'the root justfile must win over the library')
    assert.match(vars.stdout, /base\s+:= "origin\/trunk"/)
    // The gate scripts are called where they ship — nothing to move into scripts/.
    assert.match(vars.stdout, /review_prompt\s+:= "\.dev\/kit\/common\/review-prompt\.md"/)
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

/** A phase worklist, with the `## Blocked on the human` section /tasks writes. */
const worklist = (blockers) =>
  '# Phase 02: split — worklist\n\n## Tasks\n\n- [ ] T1\n\n## Blocked on the human\n\n'
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

test('worktree-status: the phase file and its blockers surface, placeholders do not', () => {
  withTmpRepo((dir) => {
    commits(dir)
    write(dir, '.work/phase-02-split.md', worklist([]))
    const quiet = run(WT_STATUS, ['HEAD'], dir)
    assert.match(quiet.out, /phase-02-split/)
    assert.doesNotMatch(quiet.out, /BLOCKED/, 'an untouched template is not an escalation')
    assert.doesNotMatch(quiet.out, /waiting on you/)

    write(dir, '.work/phase-02-split.md', worklist(['the PRD says X, the schema says Y — which wins?']))
    const loud = run(WT_STATUS, ['HEAD'], dir)
    assert.equal(loud.status, 0)
    assert.match(loud.out, /BLOCKED: the PRD says X, the schema says Y/)
    assert.match(loud.out, /1 tree\(s\) waiting on you/)
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
