// The kit's two document gates are real code, so they get real tests. Black-box:
// build a throwaway docs/ tree, run the script, assert exit code + message.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
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
      // Two markers inside the tail: still no verdict. (Two whole reports back to
      // back is a different case — see the quoted-contract test below.)
      'two verdicts in the tail': '<!-- CI_VERDICT: CLEAN -->\n<!-- CI_VERDICT: CRITICAL -->\n<!-- REVIEWED: ' + head + ' -->\n',
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

test('review-guard: with no commit yet there is nothing to compare against', () => {
  withTmpRepo((dir) => {
    git(dir, 'init', '-q')
    write(dir, '.work/review-report.md', report('CLEAN', 'abc1234'))
    const r = run(REVIEW_GUARD, [], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /nothing to compare it against/)
  })
})
