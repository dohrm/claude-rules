#!/usr/bin/env node

// review-guard — the deterministic half of a code review.
//
// A review is an LLM's judgment: it can be persuaded, and it can be re-run until
// it says something nicer. So the review itself is never the gate. What IS a gate
// is this: a report on disk, two machine-readable markers at its end, and one rule
// no prose can talk its way around — a CRITICAL blocks the push until a NEW review
// says otherwise. See rules/agent/autonomy.md.
//
// The report (.work/review-report.md, gitignored) must end with:
//   <!-- CI_VERDICT: CRITICAL|WARNINGS|CLEAN -->
//   <!-- REVIEWED: <full sha of HEAD at review time> -->
//
// | report state                        | verdict | why                                     |
// |-------------------------------------|---------|-----------------------------------------|
// | absent                              | pass +  | same contract as mutate-diff: a missing |
// |                                     | notice  | step is DECLARED, never simulated       |
// | CLEAN/WARNINGS, sha = HEAD          | pass    |                                         |
// | CLEAN/WARNINGS, sha ≠ HEAD          | pass +  | trivial commits after a review must not |
// |                                     | stale   | cost a whole new review                 |
// | CRITICAL, any sha                   | BLOCK   | otherwise one more commit expires a     |
// |                                     |         | CRITICAL — the hole this closes         |
// | markers unreadable                  | BLOCK   | a malformed report is a falsifiable one |

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const VERDICTS = ['CLEAN', 'WARNINGS', 'CRITICAL']
const VERDICT_MARKER = /^<!--\s*CI_VERDICT:\s*(.*?)\s*-->\s*$/gm
const REVIEWED_MARKER = /^<!--\s*REVIEWED:\s*(.*?)\s*-->\s*$/gm
const SHA = /^[0-9a-f]{7,40}$/

const args = process.argv.slice(2)
const reportPath = args.find((a) => !a.startsWith('--')) ?? '.work/review-report.md'

const RERUN = 'Run `just code-review` to produce a fresh one.'

/** Runs git, returning its stdout, or null when it exits non-zero. */
function git(...argv) {
  try {
    return execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const short = (sha) => sha.slice(0, 7)
const samesha = (a, b) => a.startsWith(b) || b.startsWith(a)

/** Every reason the markers cannot be trusted — empty when the report is readable. */
function malformations(verdicts, shas) {
  const out = []
  if (verdicts.length === 0) out.push('no `<!-- CI_VERDICT: ... -->` marker.')
  else if (verdicts.length > 1) out.push(`${verdicts.length} CI_VERDICT markers — exactly one is a verdict.`)
  else if (!VERDICTS.includes(verdicts[0]))
    out.push(`CI_VERDICT is "${verdicts[0]}" — expected one of ${VERDICTS.join(', ')}.`)

  if (shas.length === 0) out.push('no `<!-- REVIEWED: <sha> -->` marker — the report does not say what it reviewed.')
  else if (shas.length > 1) out.push(`${shas.length} REVIEWED markers — exactly one is a commit.`)
  else if (!SHA.test(shas[0])) out.push(`REVIEWED is "${shas[0]}" — expected a commit sha.`)
  return out
}

/** How far HEAD has drifted from the reviewed commit, in prose. */
function drift(sha, head) {
  const count = git('rev-list', '--count', `${sha}..${head}`)
  return count && count !== '0' ? `${count} commit(s) since` : `HEAD is ${short(head)}`
}

function main() {
  if (!existsSync(reportPath)) {
    console.log(`review-guard: no ${reportPath} — code review not run.`)
    console.log('  Not a pass and not a failure: hand back with "code review not run", never as green.')
    console.log(`  ${RERUN}`)
    return 0
  }

  const text = readFileSync(reportPath, 'utf8')
  const verdicts = [...text.matchAll(VERDICT_MARKER)].map((m) => m[1])
  const shas = [...text.matchAll(REVIEWED_MARKER)].map((m) => m[1])

  const broken = malformations(verdicts, shas)
  if (broken.length > 0) {
    console.error(`review-guard: ${reportPath} is malformed — a report nobody can parse cannot clear a push.`)
    for (const problem of broken) console.error(`  ${problem}`)
    console.error(`  ${RERUN}`)
    return 1
  }

  const [verdict] = verdicts
  const [sha] = shas
  const head = git('rev-parse', 'HEAD')

  if (verdict === 'CRITICAL') {
    console.error(`review-guard: the review found CRITICAL issues (reviewed ${short(sha)}).`)
    console.error('  A CRITICAL does not expire. Committing on top of it does not answer it, and')
    console.error('  neither does deleting the report — fix what the report names, then re-review.')
    if (head && !samesha(sha, head)) console.error(`  HEAD has moved (${drift(sha, head)}), which changes nothing here.`)
    console.error(`  Report: ${reportPath}. ${RERUN}`)
    return 1
  }

  if (!head) {
    console.log(`review-guard: ${verdict} at ${short(sha)} — no commit yet, so nothing to compare it against.`)
    return 0
  }
  if (samesha(sha, head)) {
    console.log(`review-guard: ${verdict} at ${short(sha)} — the review describes HEAD.`)
    return 0
  }
  console.log(`review-guard: ${verdict}, but the report reviewed ${short(sha)} and not HEAD (${drift(sha, head)}).`)
  console.log('  Stale, not blocking: a trivial commit must not cost a whole review. If the code')
  console.log(`  moved in a way a reviewer would care about, re-review — \`just code-review\`.`)
  return 0
}

process.exit(main())
