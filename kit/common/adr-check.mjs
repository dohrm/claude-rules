#!/usr/bin/env node
// Tier 2 gate — an agent proposes a decision, a human accepts it.
//
// The doctrine lives in `rules/agent/decisions.md`. This is its executable half: it makes
// accepting an ADR something that has to go through a commit, which is the one signal an
// agent does not produce on its own.
//
// It fails when:
//   • an ADR has no `- **Status**:` line, or one whose first word is not a known status;
//   • a NEW ADR (untracked) carries anything other than `Proposed`;
//   • an existing ADR reads as non-`Proposed` and its STATUS LINE differs from HEAD.
//
// Two things stay green on purpose: amending an accepted ADR's prose (only the status line
// is compared), and moving a status back down to `Proposed` (withdrawing a claim is not
// making one).
//
// It also WARNS (non-blocking) on the two things that make a decision log go unread — an
// over-long record, and a section invented as an overflow valve. Warnings, because "too
// long" is a judgment a human makes and a gate should not fake; `--strict` promotes them to
// failures for a repo that wants the budget enforced.
//
// Node rather than bash so `just check` stays cross-platform — see kit/README.md. No
// dependencies; Node >= 18.
//
// Usage:  node scripts/adr-check.mjs [adr-dir] [--strict]      (default dir: docs/adr)

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const KNOWN_STATUSES = ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']
const STATUS_LINE = /^-\s*\*\*Status\*\*:\s*(\S+)/m
// A status line in a unified diff, added or removed.
const STATUS_IN_DIFF = /^[+-]-\s*\*\*Status\*\*:/m

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const adrDir = args.find((a) => !a.startsWith('--')) ?? 'docs/adr'

// One decision, one screen. Doctrine + per-section budgets: rules/agent/decisions.md.
const WORD_CEILING = 600
// A heading is canonical when it names one of these. Anything else is an overflow valve.
const SECTION_KEYWORDS = ['context', 'decision', 'consequence', 'alternative', 'implement']
const HEADING = /^##[^#].*$/gm

const words = (s) => s.split(/\s+/).filter(Boolean).length

/** Sections whose heading names none of the canonical five. */
const oddSections = (text) =>
  (text.match(HEADING) ?? [])
    .map((h) => h.replace(/^#+\s*/, '').trim())
    .filter((h) => !SECTION_KEYWORDS.some((k) => h.toLowerCase().includes(k)))

/** Prints the advisory block once — a warning about verbosity should not be verbose. */
function reportBudget(oversized, invented, strict) {
  const label = strict ? 'error' : 'warning'
  if (oversized.length > 0) {
    console.error(
      `adr-check ${label}: ${oversized.length} record(s) over the ${WORD_CEILING}-word ceiling:`,
    )
    for (const { file, count } of oversized) console.error(`  ${path.basename(file)} — ${count}w`)
    console.error(
      `  Past the ceiling a record decides more than one thing, describes what the thing` +
        ` looks like instead of why it was chosen, or argues with an objection nobody raised.` +
        ` Split it, or move the description out (schema → DATA-MODEL, behavior → EXPERIENCE,` +
        ` sequencing → PLAN). Never compress the reasoning — it is the only part that had to` +
        ` be written there.`,
    )
  }
  if (invented.length > 0) {
    console.error(`adr-check ${label}: section(s) outside the canonical set:`)
    for (const { file, headings } of invented)
      console.error(`  ${path.basename(file)} — ${headings.map((h) => `"${h}"`).join(', ')}`)
    console.error(
      `  Canonical: Context, Decision, Consequences, Alternatives considered, Implemented.` +
        ` An invented heading is an overflow valve; an amendment is a dated note of five lines` +
        ` or fewer under the section it corrects.`,
    )
  }
  console.error(
    `\nSize and sections: rules/agent/decisions.md` +
      (strict ? '' : ' (advisory here — pass --strict to enforce the budget).'),
  )
}

/** Runs git, returning its stdout, or null when it exits non-zero. */
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function isDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function adrFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .sort()
    .map((name) => path.join(dir, name))
}

// git wants forward slashes even on Windows.
const forGit = (file) => file.split(path.sep).join('/')

function main() {
  // A repo with no decision records is not a failing repo — the gate can be wired before the
  // first ADR exists, and stay wired after the last one is removed.
  if (!isDirectory(adrDir)) {
    console.log(`adr-check: no ${adrDir}/ directory — nothing to check.`)
    return 0
  }

  const files = adrFiles(adrDir)
  if (files.length === 0) {
    console.log(`adr-check: no decision records in ${adrDir}/ — nothing to check.`)
    return 0
  }

  const hasHead = git('rev-parse', '--verify', 'HEAD') !== null
  const problems = []
  const oversized = []
  const invented = []

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const count = words(text)
    if (count > WORD_CEILING) oversized.push({ file, count })
    const headings = oddSections(text)
    if (headings.length > 0) invented.push({ file, headings })

    const match = text.match(STATUS_LINE)
    if (!match) {
      problems.push(`${file}: no '- **Status**:' line.`)
      continue
    }

    const status = match[1]
    if (!KNOWN_STATUSES.includes(status)) {
      problems.push(
        `${file}: unknown status '${status}' — expected one of ${KNOWN_STATUSES.join(', ')}.`,
      )
      continue
    }

    // Anything an agent is allowed to write needs no further proof.
    if (status === 'Proposed' || !hasHead) continue

    const tracked = git('ls-files', '--error-unmatch', forGit(file)) !== null
    if (!tracked) {
      problems.push(
        `${file}: a new ADR must be 'Proposed' — accepting it is the human's call.`,
      )
      continue
    }

    const diff = git('diff', 'HEAD', '--', forGit(file)) ?? ''
    if (STATUS_IN_DIFF.test(diff)) {
      problems.push(
        `${file}: the status line changed to '${status}' without a commit.\n` +
          `  An agent may amend an ADR's prose; moving its status is the human's act.`,
      )
    }
  }

  if (!hasHead) {
    console.log('adr-check: no commit yet, so there is nothing to compare against.')
    console.log("  The guard becomes real with the repository's first commit.")
  }

  const budgetCount = oversized.length + invented.length
  if (budgetCount > 0) reportBudget(oversized, invented, strict)

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`\nSee rules/agent/decisions.md for the lifecycle.`)
    return 1
  }
  if (strict && budgetCount > 0) return 1

  const note = budgetCount > 0 ? ` (${budgetCount} advisory warning(s) above)` : ''
  console.log(`adr-check: ${files.length} decision record(s) in order.${note}`)
  return 0
}

process.exit(main())
