// l4.mjs — the L4 referee. The board parser and the journal reader are unit-tested; the
// verdicts are black-box: an integration repo on `rfc/x`, a phase worktree on
// `phase/x/1`, a bare `origin`, and fake `just` / CI commands on PATH so that `just
// check` and the CI state are inputs the test sets, with no toolchain installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo, fixtureGit } from './helpers.mjs'
import { parseBoard, readJournal } from '../kit/common/l4.mjs'

const L4 = join(REPO, 'kit', 'common', 'l4.mjs')
// The real just, resolved before a test puts its fake one first on PATH.
const JUST = spawnSync('sh', ['-c', 'command -v just'], { encoding: 'utf8' }).stdout.trim()

const BOARD = {
  delegated: '- Delegated: phase-merge, changed-decision',
  executors: '- Executors: claude · opus | codex · gpt',
  caps: '- Caps: budget=120 minutes; review-passes=3; rejected-rounds=1',
  envelope: '- Pass envelope: 2',
}
const board = (over = {}) => Object.values({ ...BOARD, ...over }).filter(Boolean).join('\n')
const RFC = (boardText = board()) => `# RFC — X

- **Status**: implementing
- **Autonomy**: L4
- **Branch**: rfc/x

## Delegation board

${boardText}

Proposed by the agent; the human keeps or edits it.

## Steps

### Phase 1 — a → proof: \`t\`

- [ ] a — touches \`src/a.txt\` → proof: \`t\`

## Assumptions

- the docs page moves with the code it describes

## Log

- \`changed: the helper lives in lib — it is shared\`
`

/** Refusal-or-value, for the unit tests: the message of what `fn` threw, or null. */
const thrown = (fn) => {
  try {
    fn()
    return null
  } catch (err) {
    return err.message
  }
}

// ------------------------------------------------------------------ the board
test('l4 board: a valid board parses into its four keys', () => {
  assert.deepEqual(parseBoard(RFC()), {
    delegated: ['phase-merge', 'changed-decision'],
    executors: [{ agent: 'claude', model: 'opus' }, { agent: 'codex', model: 'gpt' }],
    caps: { budget: '120 minutes', 'review-passes': 3, 'rejected-rounds': 1 },
    envelope: 2,
  })
  assert.equal(parseBoard(RFC(board({ envelope: '' }))).envelope, 0, 'an absent pass envelope is 0')
  assert.deepEqual(parseBoard(RFC(board({ delegated: '- Delegated: none' }))).delegated, [])
})

test('l4 board: each malformed line is named, never guessed', () => {
  const cases = [
    [{ delegated: '- Delegated: phase-merge, the-adr' }, /board line \d+: `- Delegated: phase-merge, the-adr` — not delegable: the-adr/],
    [{ executors: '- Executors: claude opus' }, /board line \d+: `- Executors: claude opus` — expected `<agent> · <model>`/],
    [{ executors: '- Executors: gemini · pro' }, /Executors: gemini · pro/],
    [{ caps: '- Caps: budget=120 minutes; review-passes=3' }, /every cap is required, missing: rejected-rounds/],
    [{ caps: '- Caps: budget=lots; review-passes=3; rejected-rounds=1' }, /budget=lots is not a valid cap/],
    [{ caps: '- Caps: budget=1 minutes; review-passes=0; rejected-rounds=1' }, /review-passes=0 is not a valid cap/],
    [{ caps: '- Caps: budget=1 minutes; review-passes=3; rejected-rounds=1; speed=9' }, /unknown cap `speed`/],
    [{ caps: '- Caps: budget=1 minutes; review-passes=3=9; rejected-rounds=1' }, /review-passes=\(empty\) is not a valid cap/],
    [{ envelope: '- Pass envelope: some' }, /`- Pass envelope: some` — the pass envelope is a non-negative integer/],
    [{ envelope: '- Reviewers: anyone' }, /`- Reviewers: anyone` — expected one of/],
    [{ envelope: BOARD.caps }, /Caps is given twice/],
    [{ caps: '' }, /no `- Caps:` line/],
    [{ delegated: 'Delegated: phase-merge' }, /no `- Delegated:` line/],
  ]
  for (const [over, why] of cases) assert.match(thrown(() => parseBoard(RFC(board(over)))) ?? 'parsed', why)
  assert.match(thrown(() => parseBoard('# RFC\n\n## Steps\n')), /no `## Delegation board` section/)
})

// ---------------------------------------------------------------- the journal
test('l4 journal: entries are read back; a line that does not parse is refused by number', () => {
  withTmpRepo((dir) => {
    const path = join(dir, 'l4.jsonl')
    assert.deepEqual(readJournal(path), [], 'no journal yet is an empty one')
    const sha = 'a'.repeat(40)
    const good = { kind: 'verdict', phase: '1', sha, verdict: 'reject', reasons: ['x'] }
    writeFileSync(path, `${JSON.stringify(good)}\n${JSON.stringify({ kind: 'merged', phase: '1', sha, commit: sha })}\n`)
    assert.equal(readJournal(path).length, 2)
    for (const bad of ['{not json', JSON.stringify({ ...good, verdict: 'maybe' }), JSON.stringify({ ...good, sha: 'abc' }),
      JSON.stringify({ kind: 'merged', phase: '1', sha })]) {
      writeFileSync(path, `${JSON.stringify(good)}\n${bad}\n`)
      assert.match(thrown(() => readJournal(path)), /l4\.jsonl line 2 does not parse/)
    }
  })
})

// ------------------------------------------------------------- the fixture
const write = (dir, rel, body) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), body)
}

/** `{ main, tree, bin }`: the integration tree on `rfc/x` (pushed to a bare `origin`),
 *  and a phase tree on `phase/x/1` holding one commit inside the declared package. */
function fixture(dir, { rfc = RFC(), kit = false } = {}) {
  const main = join(dir, 'main')
  const tree = join(dir, 'p1')
  const bin = join(dir, 'bin')
  fixtureGit(dir, ['init', '-q', '--bare', 'origin.git'])
  mkdirSync(main)
  write(main, '.gitignore', '.work/*\n!.work/*/\n')
  write(main, 'README.md', 'x\n')
  write(main, '.work/x/rfc.md', rfc)
  if (kit) {
    for (const f of ['gate.just', 'l4.mjs', 'review-guard.mjs', 'scope-report.mjs', 'review-context.mjs', 'work-slug.mjs'])
      write(main, `.dev/kit/common/${f}`, readFileSync(join(REPO, 'kit/common', f), 'utf8'))
    write(main, 'justfile', "import '.dev/kit/common/gate.just'\n")
  }
  fixtureGit(main, ['init', '-q', '-b', 'rfc/x'])
  // l4.mjs runs plain git: identity and no hook from this machine come from the repo.
  for (const [k, v] of [['user.name', 'l4-test'], ['user.email', 'l4-test@example.invalid'],
    ['core.hooksPath', '/dev/null'], ['commit.gpgsign', 'false']]) fixtureGit(main, ['config', k, v])
  fixtureGit(main, ['add', '-A'])
  fixtureGit(main, ['commit', '-q', '-m', 'rfc'])
  fixtureGit(main, ['remote', 'add', 'origin', join(dir, 'origin.git')])
  fixtureGit(main, ['push', '-q', 'origin', 'rfc/x'])
  fixtureGit(main, ['worktree', 'add', '-q', '-b', 'phase/x/1', tree])
  write(tree, 'src/a.txt', 'a\n')
  commitIn(tree)
  pushPhase(tree)
  review(tree, 'CLEAN')

  // `just check` exits $FAKE_CHECK; the CI command exits $FAKE_CI and logs its argument.
  write(bin, 'just', '#!/bin/sh\n[ "$1" = check ] || exit 2\nexit "${FAKE_CHECK:-0}"\n')
  write(bin, 'fake-ci', '#!/bin/sh\necho "ci-arg: $1" >&2\nexit "${FAKE_CI:-0}"\n')
  chmodSync(join(bin, 'just'), 0o755)
  chmodSync(join(bin, 'fake-ci'), 0o755)
  return { main, tree, bin }
}
function commitIn(dir, msg = 'change') {
  fixtureGit(dir, ['add', '-A'])
  fixtureGit(dir, ['commit', '-q', '-m', msg])
}
const head = (dir) => fixtureGit(dir, ['rev-parse', 'HEAD'])
/** The executor's push: a forge's CI answers about what `origin` holds. */
const pushPhase = (tree) => fixtureGit(tree, ['push', '-q', 'origin', 'phase/x/1'])

/** Writes the phase tree's review report, reviewing its HEAD unless `sha` says otherwise. */
function review(tree, verdict, { sha = head(tree), critical = '', warnings = '' } = {}) {
  write(tree, '.work/review-report.md', `## Code Review: x\n\n### 🔴 Critical (must fix)\n\n${critical}\n\n`
    + `### 🟡 Warnings (should fix)\n\n${warnings}\n\n### Files reviewed\n\n- \`src/a.txt\`\n\n`
    + `<!-- CI_VERDICT: ${verdict} -->\n<!-- REVIEWED: ${sha} -->\n`)
}

function l4(fx, args, env = {}) {
  const r = spawnSync(process.execPath, [L4, ...args], {
    cwd: fx.main, encoding: 'utf8', env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, ...env },
  })
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const journal = (fx) => {
  const path = join(fx.main, '.work', 'x', 'l4.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
}

// ------------------------------------------------------------------- judge
test('l4 judge: all green is merge — exit 0, one line, recorded and committed on rfc/x', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    review(fx.tree, 'WARNINGS', { warnings: '- **Location** `src/a.txt:1` · **Problem** naming' })
    const r = l4(fx, ['judge', '1', '--ci', 'fake-ci'])
    assert.equal(r.status, 0, r.out + r.err)
    assert.match(r.out, /^l4: merge — all green at [0-9a-f]{7}\n$/)
    assert.match(r.err, /ci-arg: phase\/x\/1/, 'the CI command gets the phase branch as its last argument')
    const [e] = journal(fx)
    assert.equal(e.verdict, 'merge')
    assert.equal(e.sha, head(fx.tree))
    assert.equal(e.ci, 'green')
    assert.deepEqual(e.warnings, ['- **Location** `src/a.txt:1` · **Problem** naming'], 'WARNINGS go to the journal, never to a fix round')
    assert.equal(fixtureGit(fx.main, ['status', '--porcelain']), '', 'the journal line is committed')
    review(fx.tree, 'WARNINGS', { warnings: 'Naming could be clearer.' })
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    assert.deepEqual(journal(fx).at(-1).warnings, ['Naming could be clearer.'], 'prose warnings are kept whole')
    review(fx.tree, 'WARNINGS', { warnings: '1. **Location** `src/a.txt:1`\n   **Problem** naming\n\n   **Fix** rename\n2. second' })
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    assert.deepEqual(journal(fx).at(-1).warnings,
      ['1. **Location** `src/a.txt:1`\n   **Problem** naming\n\n   **Fix** rename', '2. second'], 'an item keeps its continuation lines')
    write(fx.tree, '.work/review-report.md', readFileSync(join(fx.tree, '.work/review-report.md'), 'utf8')
      .replace('### Files reviewed', '### 🔵 Design notes (worth discussing)\n\n- a note\n\n### Files reviewed'))
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    assert.ok(journal(fx).at(-1).warnings.includes('- a note'), 'a 🔵 is a WARNINGS item too')
    review(fx.tree, 'WARNINGS')
    write(fx.tree, '.work/review-report.md', readFileSync(join(fx.tree, '.work/review-report.md'), 'utf8')
      .replace('### Files reviewed', '### 🔵 Design notes (worth discussing)\n\n- only a note\n\n### Files reviewed'))
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    assert.deepEqual(journal(fx).at(-1).warnings, ['- only a note'], 'a 🔵-only report records its note')
    assert.match(fixtureGit(fx.main, ['log', '-1', '--format=%s']), /^l4: phase 1 merge at /)
  })
})

test('l4 judge: CI not wired is declared in the journal, never recorded as green', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    const r = l4(fx, ['judge', '1', '--ci', ''])
    assert.equal(r.status, 0, r.out + r.err)
    assert.match(r.out, /Tier 4 not wired \(declared, not green\)/)
    assert.equal(journal(fx)[0].ci, 'not-wired')
  })
})

test('l4 judge: each red fact is a reject — exit 1', () => {
  const cases = [
    ['a red check', { env: { FAKE_CHECK: '1' } }, /just check exited 1/],
    ['a CRITICAL report', { report: ['CRITICAL', { critical: '- bug · **Model**: none' }] }, /review verdict CRITICAL/],
    ['no report', { report: null }, /no review report — no report is not a pass/],
    ['a stale report', { report: ['CLEAN', { sha: 'b'.repeat(40) }] }, /review report is stale/],
    ['a malformed report', { report: ['MAYBE', {}] }, /review report malformed/],
    ['red CI', { env: { FAKE_CI: '1' } }, /CI is red/],
  ]
  for (const [name, { env = {}, report }, why] of cases) {
    withTmpRepo((dir) => {
      const fx = fixture(dir)
      if (report === null) spawnSync('rm', [join(fx.tree, '.work', 'review-report.md')])
      else if (report) review(fx.tree, ...report)
      const r = l4(fx, ['judge', '1', '--ci', 'fake-ci'], env)
      assert.equal(r.status, 1, `${name}: ${r.out}${r.err}`)
      assert.match(r.out, new RegExp(`^l4: reject — .*${why.source}`), name)
      assert.equal(journal(fx)[0].verdict, 'reject', name)
    })
  }
})

test('l4 judge: green CI about another commit is a reject — origin must hold the judged HEAD', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    write(fx.tree, 'src/a.txt', 'newer\n')
    commitIn(fx.tree)
    review(fx.tree, 'CLEAN')
    const r = l4(fx, ['judge', '1', '--ci', 'fake-ci'])
    assert.equal(r.status, 1, r.out + r.err)
    assert.match(r.out, /origin does not hold [0-9a-f]{7} on phase\/x\/1 — CI never checked the judged commit/)
    assert.doesNotMatch(r.err, /ci-arg/, 'the CI command is not even asked')
    assert.equal(journal(fx)[0].ci, 'unpushed')
    pushPhase(fx.tree)
    assert.equal(l4(fx, ['judge', '1', '--ci', 'fake-ci']).status, 0, 'once pushed, the same commit merges')
    assert.equal(l4(fx, ['judge', '1', '--ci', '']).status, 0, 'unwired CI asks nothing of origin')
  })
})

test('l4: an RFC not at L4 is refused by both verbs — the level is the human\'s', () => {
  for (const header of ['- **Autonomy**: L3\n', '']) {
    withTmpRepo((dir) => {
      const fx = fixture(dir, { rfc: RFC().replace('- **Autonomy**: L4\n', header) })
      for (const verb of ['judge', 'merge']) {
        const r = l4(fx, [verb, '1'])
        assert.equal(r.status, 3, `${verb} ${header || '(no header)'}: ${r.out}`)
        assert.match(r.out, /\*\*Autonomy\*\* header is not L4/)
      }
      assert.deepEqual(journal(fx), [])
    })
  }
})

test('l4 judge: a check that rewrites a tracked file is a reject — it judged another tree', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    write(fx.bin, 'just', '#!/bin/sh\necho fixed > src/a.txt\n')
    const r = l4(fx, ['judge', '1'])
    assert.equal(r.status, 1, r.out + r.err)
    assert.match(r.out, /just check modified tracked files/)
  })
})

test('l4 merge: a merge already in progress is refused and left intact', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    fixtureGit(fx.main, ['checkout', '-q', '-b', 'side'])
    write(fx.main, 'README.md', 'side\n')
    commitIn(fx.main)
    fixtureGit(fx.main, ['checkout', '-q', 'rfc/x'])
    write(fx.main, 'README.md', 'mine\n')
    commitIn(fx.main)
    spawnSync('git', ['merge', 'side'], { cwd: fx.main })
    write(fx.main, 'README.md', 'resolved\n')
    const r = l4(fx, ['merge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /a merge is already in progress/)
    assert.equal(readFileSync(join(fx.main, 'README.md'), 'utf8'), 'resolved\n', 'the resolution is untouched')
    assert.ok(existsSync(join(fx.main, '.git', 'MERGE_HEAD')), 'and the merge is still in progress')
  })
})

test('l4 judge: CI still running is wait — exit 4, and it does not count as a rejected round', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    const r = l4(fx, ['judge', '1', '--ci', 'fake-ci'], { FAKE_CI: '8' })
    assert.equal(r.status, 4, r.out + r.err)
    assert.match(r.out, /^l4: wait — CI is still running/)
    const red = l4(fx, ['judge', '1', '--ci', 'fake-ci'], { FAKE_CI: '8', FAKE_CHECK: '1' })
    assert.equal(red.status, 1, 'a red fact does not wait for CI')
  })
})

test('l4 judge: an overflow package escalates unless a justification quotes the RFC', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    write(fx.tree, 'docs/a.md', 'x\n')
    commitIn(fx.tree)
    review(fx.tree, 'CLEAN')
    const bare = l4(fx, ['judge', '1'])
    assert.equal(bare.status, 3, bare.out)
    assert.match(bare.out, /^l4: escalate — overflow package `docs` is not justified/)
    const made = l4(fx, ['judge', '1', '--justify', 'docs=a page nobody asked for'])
    assert.equal(made.status, 3, made.out)
    assert.match(made.out, /`docs`: its justification is in no `changed:` or `## Assumptions` line/)
    const ok = l4(fx, ['judge', '1', '--justify', 'docs=the docs page moves with the code'])
    assert.equal(ok.status, 0, ok.out + ok.err)
    assert.deepEqual(journal(fx).at(-1).justified, { docs: 'the docs page moves with the code' })
  })
})

test('l4 judge: a `changed:` line justifies too, and several justifications fit one value', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    write(fx.tree, 'docs/a.md', 'x\n')
    write(fx.tree, 'lib/h.txt', 'x\n')
    commitIn(fx.tree)
    review(fx.tree, 'CLEAN')
    const r = l4(fx, ['judge', '1', '--justify', 'docs=moves with the code\nlib=the helper lives in lib'])
    assert.equal(r.status, 0, r.out + r.err)
  })
})

test('l4 judge: a 🔴 whose Model line is gap escalates, even beside a reject', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    review(fx.tree, 'CRITICAL', { critical: '- id reuse · **Model**: gap — the RFC never says whether an id is reused' })
    const r = l4(fx, ['judge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /^l4: escalate — a 🔴 whose \*\*Model\*\* line is `gap`.*; review verdict CRITICAL/)
    review(fx.tree, 'CRITICAL', { critical: '1. id reuse · **Model:** `gap` — undecided' })
    assert.equal(l4(fx, ['judge', '1']).status, 3, 'the `**Model:**` spelling is the same line')
    review(fx.tree, 'CRITICAL', { critical: '- bug · **Model**: "A gap in the id space is refused"' })
    assert.equal(l4(fx, ['judge', '1']).status, 1, 'a quoted Model line that mentions a gap is not `gap`')
  })
})

test('l4 judge: a reject past the rejected-rounds cap escalates', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    assert.equal(l4(fx, ['judge', '1'], { FAKE_CHECK: '1' }).status, 1, 'the first rejected round is within the cap of 1')
    const r = l4(fx, ['judge', '1'], { FAKE_CHECK: '1' })
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /rejected past the cap: 1 rejected round\(s\) of 1 already spent/)
    assert.equal(l4(fx, ['judge', '1']).status, 0, 'a green phase still merges once past it')
  })
})

test('l4 judge: an unparsable board or journal is refused — exit 3, nothing written', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir, { rfc: RFC(board({ caps: '- Caps: budget=120 minutes' })) })
    const r = l4(fx, ['judge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /^l4: escalate — board line \d+: `- Caps: budget=120 minutes`/)
    assert.deepEqual(journal(fx), [])
  })
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    write(fx.main, '.work/x/l4.jsonl', 'garbage\n')
    const r = l4(fx, ['judge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /l4\.jsonl line 1 does not parse/)
    assert.equal(readFileSync(join(fx.main, '.work/x/l4.jsonl'), 'utf8'), 'garbage\n', 'never rewritten')
  })
})

test('l4 judge: usage errors are exit 2 — wrong tree, no phase tree, uncommitted work', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    assert.match(l4(fx, ['judge', '2']).out, /^l4: error — no worktree on phase\/x\/2/)
    write(fx.tree, 'src/b.txt', 'x\n')
    const dirty = l4(fx, ['judge', '1'])
    assert.equal(dirty.status, 2)
    assert.match(dirty.out, /uncommitted changes/)
    const wrong = spawnSync(process.execPath, [L4, 'judge', '1', '--slug', 'x'], { cwd: fx.tree, encoding: 'utf8' })
    assert.equal(wrong.status, 2)
    assert.match(wrong.stdout, /run from the integration tree, on rfc\/x/)
    assert.equal(l4(fx, ['judge']).status, 2)
    assert.equal(l4(fx, ['vote', '1']).status, 2)
  })
})

// ------------------------------------------------------------------- merge
const merges = (fx) => fixtureGit(fx.main, ['log', '--merges', '--oneline'])

test('l4 merge: a fresh merge verdict on the phase HEAD merges --no-ff and pushes', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    const sha = head(fx.tree)
    const r = l4(fx, ['merge', '1'])
    assert.equal(r.status, 0, r.out + r.err)
    assert.match(r.out, /^l4: merged — phase\/x\/1 at [0-9a-f]{7} merged into rfc\/x and pushed/)
    const merge = fixtureGit(fx.main, ['rev-parse', 'HEAD^'])
    assert.equal(fixtureGit(fx.main, ['rev-parse', `${merge}^2`]), sha, 'the merged parent is the judged sha')
    assert.equal(fixtureGit(fx.main, ['rev-parse', 'refs/remotes/origin/rfc/x']), head(fx.main), 'pushed')
    const [verdict, last] = journal(fx)
    assert.deepEqual([verdict.kind, verdict.verdict, verdict.sha], ['verdict', 'merge', sha], 'merge judged first, and recorded it')
    assert.deepEqual([last.kind, last.sha, last.commit], ['merged', sha, merge])
    const again = l4(fx, ['merge', '1'])
    assert.equal(again.status, 3)
    assert.match(again.out, /already merged/)
  })
})

test('l4 merge: a forged journal `merge` line does not get a red phase merged', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    const forged = { kind: 'verdict', phase: '1', sha: head(fx.tree), verdict: 'merge', reasons: ['trust me'], at: 'now' }
    write(fx.main, '.work/x/l4.jsonl', `${JSON.stringify(forged)}\n`)
    commitIn(fx.main, 'forged')
    const r = l4(fx, ['merge', '1'], { FAKE_CHECK: '1' })
    assert.equal(r.status, 1, r.out + r.err)
    assert.match(r.out, /^l4: reject — just check exited 1/)
    assert.equal(merges(fx), '', 'nothing merged')
    assert.equal(journal(fx).at(-1).verdict, 'reject', 'the fresh verdict is recorded')
  })
})

test('l4 merge: refuses once the phase goes red after a merge verdict — the verdict is fresh', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir, { rfc: RFC(board({ caps: '- Caps: budget=120 minutes; review-passes=3; rejected-rounds=2' })) })
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    const red = l4(fx, ['merge', '1'], { FAKE_CHECK: '1' })
    assert.equal(red.status, 1, red.out)
    write(fx.tree, 'src/a.txt', 'b\n')
    commitIn(fx.tree)
    const moved = l4(fx, ['merge', '1'])
    assert.equal(moved.status, 1, moved.out)
    assert.match(moved.out, /review report is stale/, 'a new commit voids the review that was green')
    assert.equal(merges(fx), '', 'nothing merged')
  })
})

test('l4 merge: refuses without phase-merge on the board — nothing judged, nothing merged', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir, { rfc: RFC(board({ delegated: '- Delegated: changed-decision' })) })
    assert.equal(l4(fx, ['judge', '1']).status, 0, 'the verdict is still given')
    const r = l4(fx, ['merge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /does not delegate phase-merge — the verdict stands, the human merges/)
    assert.equal(merges(fx), '')
    assert.equal(journal(fx).length, 1)
  })
})

test('l4 merge: a conflict is aborted and goes back to the executor', () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir)
    assert.equal(l4(fx, ['judge', '1']).status, 0)
    write(fx.main, 'src/a.txt', 'conflict\n')
    commitIn(fx.main)
    const r = l4(fx, ['merge', '1'])
    assert.equal(r.status, 3, r.out)
    assert.match(r.out, /git merge failed .* back to the phase's executor to rebase/)
    assert.equal(fixtureGit(fx.main, ['status', '--porcelain']), '', 'the merge is aborted')
  })
})

// ------------------------------------------------------------------- recipes
test('just l4-judge / l4-merge: the recipes pass l4_ci and a multi-line justify intact, to both verbs',
  { skip: JUST ? false : 'just not installed' }, () => {
  withTmpRepo((dir) => {
    const fx = fixture(dir, { kit: true })
    write(fx.tree, 'docs/a.md', 'x\n')
    commitIn(fx.tree)
    pushPhase(fx.tree)
    review(fx.tree, 'CLEAN')
    const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, FAKE_CI: '0' }
    const just = (...args) => spawnSync(JUST, args, { cwd: fx.main, encoding: 'utf8', env })
    const red = just('l4_ci=fake-ci', 'l4-judge', '1')
    assert.equal(red.status, 3, 'the exit code reaches the caller through just')
    const ok = just('l4_ci=fake-ci', 'l4-judge', '1', 'docs=the docs page moves\nlib=never used')
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stderr, /ci-arg: phase\/x\/1/)
    assert.equal(journal(fx).at(-1).ci, 'green')
    const merged = just('l4_ci=fake-ci', 'l4-merge', '1', 'docs=the docs page moves')
    assert.equal(merged.status, 0, merged.stdout + merged.stderr)
    assert.match(merged.stdout, /^l4: merged — /m)
  })
})
