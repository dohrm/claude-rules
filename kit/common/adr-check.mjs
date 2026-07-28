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
// Node rather than bash so `just check` stays cross-platform — see kit/README.md. No
// dependencies; Node >= 18.
//
// Usage:  node scripts/adr-check.mjs [adr-dir]        (default: docs/adr)

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const KNOWN_STATUSES = ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']
const STATUS_LINE = /^-\s*\*\*Status\*\*:\s*(\S+)/m
// A status line in a unified diff, added or removed.
const STATUS_IN_DIFF = /^[+-]-\s*\*\*Status\*\*:/m

const adrDir = process.argv[2] ?? 'docs/adr'

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

  for (const file of files) {
    const match = readFileSync(file, 'utf8').match(STATUS_LINE)
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

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`\nSee rules/agent/decisions.md for the lifecycle.`)
    return 1
  }

  console.log(`adr-check: ${files.length} decision record(s) in order.`)
  return 0
}

process.exit(main())
