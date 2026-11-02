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
// It also WARNS on a DANGLING reference — `ADR-NNNN`, or a link to `adr/NNNN-*.md`, in a
// tracked file when no such record exists: what a deleted record leaves behind (git is the
// archive; a comment pointing at a missing file is not). Same contract — `--strict` fails.
// Scanned: tracked text files (`git grep`) minus `.work/`, `CHANGELOG.md` (release
// history names the records of its day), installed agent assets (`.claude/`, `.agents/`,
// `.cursor/`, `.dev/`), any directory holding its own `docs/adr/` (a vendored corpus
// numbers its own records), and the repo's `adr.referenceExclude` paths. A reference
// qualified by one of `adr.externalPrefixes` (`shared ADR-NNNN`) names another
// repository's record.
//
// Node rather than bash so `just check` stays cross-platform — see kit/README.md. No
// dependencies; Node >= 18.
//
// Usage:  just adr-check   (directly: node .dev/kit/common/adr-check.mjs [adr-dir] [--strict] [--config=<file>])
//         (defaults: docs/adr, .docs-budgets.json)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const KNOWN_STATUSES = ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']
const STATUS_LINE = /^-\s*\*\*Status\*\*:\s*(\S+)/m
// A status line in a unified diff, added or removed.
const STATUS_IN_DIFF = /^[+-]-\s*\*\*Status\*\*:/m

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const configArg = args.find((a) => a.startsWith('--config='))
const configPath = configArg ? configArg.slice('--config='.length) : '.docs-budgets.json'
const adrDir = args.find((a) => !a.startsWith('--')) ?? 'docs/adr'

// One decision, one screen. Doctrine + per-section budgets: rules/agent/decisions.md.
//
// The ceiling is a DEFAULT: a repo raises it under `"adr": { "unitCeiling": 900 }` in
// `.docs-budgets.json` at its root (`null` = no ceiling) — the same file docs-check.mjs
// reads for the PRD/PLAN budgets, and one the installer never writes, so an update cannot
// reset it. The loader is duplicated in both gates on purpose: each stays a single file you
// can drop into scripts/ on its own. The canonical section list is doctrine, not a setting.
const DEFAULT_WORD_CEILING = 600
const DEFAULT_EXTERNAL_PREFIXES = ['shared', 'enterprise']
const ADR_KEYS = ['unitCeiling', 'externalPrefixes', 'referenceExclude']

function bail(message) {
  console.error(`adr-check: ${message}`)
  process.exit(2)
}

/** A list of non-empty strings, or the default when absent. */
function stringList(file, key, v, fallback) {
  if (v === undefined) return fallback
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s.trim() === ''))
    bail(`${file}: "adr.${key}" must be a list of non-empty strings — got ${JSON.stringify(v)}`)
  return v
}

/** The repo's `adr` settings, plus a note when the repo moved the ceiling. */
function loadConfig(file) {
  const defaults = {
    ceiling: DEFAULT_WORD_CEILING,
    note: '',
    externalPrefixes: DEFAULT_EXTERNAL_PREFIXES,
    referenceExclude: [],
  }
  if (!existsSync(file)) return defaults
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    bail(`${file} is not valid JSON — ${e.message}`)
  }
  const adr = raw.adr
  if (adr === undefined) return defaults
  if (adr === null || typeof adr !== 'object' || Array.isArray(adr))
    bail(`${file}: "adr" must be an object, e.g. { "unitCeiling": 900 }.`)
  // A typo must not silently disable the budget.
  for (const key of Object.keys(adr))
    if (!key.startsWith('$') && !ADR_KEYS.includes(key))
      bail(`${file}: unknown key "adr.${key}" — expected ${ADR_KEYS.join(', ')}.`)
  const out = {
    ...defaults,
    externalPrefixes: stringList(file, 'externalPrefixes', adr.externalPrefixes, DEFAULT_EXTERNAL_PREFIXES),
    referenceExclude: stringList(file, 'referenceExclude', adr.referenceExclude, []).map((p) => {
      // `.` would exclude the whole repository: the scan off, without a word.
      const n = path.posix.normalize(p.replace(/\\/g, '/')).replace(/\/+$/, '')
      if (path.posix.isAbsolute(n) || path.win32.isAbsolute(p) || n === '.' || n.split('/').includes('..'))
        bail(`${file}: "adr.referenceExclude" entries are repo-relative path prefixes below the root — got "${p}".`)
      return n
    }),
  }
  const v = adr.unitCeiling
  if (v === undefined) return out
  if (v !== null && (!Number.isInteger(v) || v <= 0))
    bail(
      `${file}: "adr.unitCeiling" must be a positive integer, or null for no ceiling — got ${JSON.stringify(v)}`,
    )
  return {
    ...out,
    ceiling: v === null ? Infinity : v,
    note: ` Overridden in ${file}: adr.unitCeiling=${v}.`,
  }
}

const config = loadConfig(configPath)
const { ceiling: WORD_CEILING, note: budgetNote } = config

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
      (strict ? '' : ' (advisory here — pass --strict to enforce the budget).') +
      budgetNote,
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

// ------------------------------------------------------------ references
// `ADR-NNNN`, and a link to a record's file (`docs/adr/NNNN-slug.md`, `../adr/NNNN-slug.md`).
const ADR_ID = /\bADR-(\d{4})\b/g
const ADR_LINK = /\badr\/(\d{4}-[\w.-]*\.md)\b/g
// Installed copies of agent assets: a copied skill's template record is not a reference.
const NEVER_SCANNED = ['.work', '.claude', '.agents', '.cursor', '.dev']
const DANGLING_SHOWN = 50

const under = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`)

/**
 * git's stdout for the reference scan. Inside a repository a failure is fatal: a scan that
 * did not run must not read as a clean one. `ok` lists the exit codes that are answers.
 */
function scanGit(args, ok = [0]) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.error || !ok.includes(r.status)) {
    // A killed git says nothing on stderr: the signal is the cause.
    const why =
      r.error?.message ?? (r.stderr.trim() || (r.signal ? `killed by ${r.signal}` : `exit ${r.status}`))
    bail(`the reference scan failed (git ${args[0]}) — ${why}`)
  }
  return r.stdout
}

/** Path prefixes whose ADR numbers are not references to this corpus. */
function unscannedPrefixes(corpusDir) {
  const listed = scanGit(['ls-files', '-z', '--', ':(glob)**/docs/adr/**'])
  // A directory holding its own docs/adr/ is a vendored corpus with its own numbering.
  const vendored = new Set()
  for (const file of listed.split('\0')) {
    const at = file.indexOf('/docs/adr/')
    if (at > 0 && !under(file, corpusDir)) vendored.add(file.slice(0, at))
  }
  return [...NEVER_SCANNED, ...vendored, ...config.referenceExclude]
}

/** Tracked, non-binary lines that mention a record, as { file, line, text }. */
function candidateLines(corpusDir) {
  // Outside a repository nothing is tracked. Probed first: scanGit fails hard there. A
  // missing git binary is not "outside a repository" — scanGit reports it.
  const probe = spawnSync('git', ['rev-parse', '--git-dir'], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANGUAGE: '' }, // the message below is matched
  })
  if (!probe.error && probe.status !== 0) {
    // Only git's own "not a repository" skips: dubious ownership or a broken .git is a
    // scan that cannot run, not a clean one.
    if (!/not a git repository \(or any/i.test(probe.stderr))
      bail(`the reference scan failed (git rev-parse) — ${probe.stderr.trim() || `exit ${probe.status}`}`)
    console.log('adr-check: not a git repository — reference scan skipped.')
    return []
  }
  // The skipped paths go to git as pathspecs, so their matches never reach Node; git grep
  // reads only the lines that can match. Exit 1 is git grep's "no match".
  const excluded = [
    ':(exclude,glob)**/CHANGELOG.md',
    ...unscannedPrefixes(corpusDir).map((p) => `:(exclude,literal)${p}`),
  ]
  const out = scanGit(
    // --no-color: a colour-forcing config (color.ui=always) would wrap every match in
    // escape codes the regexes cannot see through — a false clean.
    ['grep', '--no-color', '-z', '-n', '-I', '-E', 'ADR-[0-9]{4}|adr/[0-9]{4}-', '--', '.', ...excluded],
    [0, 1],
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [file, line, ...text] = row.split('\0')
      return { file, line, text: text.join('\0') }
    })
}

/** True when the match is qualified by an external prefix: `shared ADR-NNNN`. */
const EXTERNAL = config.externalPrefixes.map(
  (p) => new RegExp(`(?:^|[^\\w])${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:-]*$`),
)
function isExternal(line, index) {
  const before = line.slice(0, index).toLowerCase()
  return EXTERNAL.some((re) => re.test(before))
}

/**
 * Every reference to a record absent from `files`, as `path:line — what`. The records
 * themselves are scanned: a successor's "Supersedes ADR-NNNN" dangles once that record
 * is deleted, and is rewritten in the same diff as any other reference.
 */
function danglingReferences(files) {
  const corpusDir = forGit(path.normalize(adrDir)).replace(/\/+$/, '')
  const names = new Set(files.map((f) => path.basename(f)))
  const ids = new Set([...names].map((n) => n.match(/^(\d{4})-/)?.[1]).filter(Boolean))
  const found = []
  for (const { file, line, text } of candidateLines(corpusDir)) {
    for (const m of text.matchAll(ADR_ID))
      if (!ids.has(m[1]) && !isExternal(text, m.index)) found.push(`${file}:${line} — ADR-${m[1]}`)
    for (const m of text.matchAll(ADR_LINK)) {
      // A URL points at another repository's corpus.
      const token = text.slice(0, m.index).split(/[\s(<"'`[]/).pop()
      if (!names.has(m[1]) && !token.includes('://')) found.push(`${file}:${line} — adr/${m[1]}`)
    }
  }
  return found
}

function reportDangling(found, strict) {
  console.error(
    `adr-check ${strict ? 'error' : 'warning'}: ${found.length} dangling reference(s) to a record not in ${adrDir}/:`,
  )
  for (const ref of found.slice(0, DANGLING_SHOWN)) console.error(`  ${ref}`)
  if (found.length > DANGLING_SHOWN) console.error(`  … and ${found.length - DANGLING_SHOWN} more`)
  console.error(
    `  A deleted record lives in git history, not in the tree. State the invariant the` +
      ` reference protects, or point to the record's new home.` +
      ` Another repository's record: qualify it (${config.externalPrefixes.map((p) => `"${p} ADR-NNNN"`).join(', ')}).` +
      ` Not a reference: add the path to adr.referenceExclude in ${configPath}.` +
      (strict ? '' : ' Advisory here — pass --strict to enforce.'),
  )
}

function main() {
  // A repo with no decision records is not a failing repo — the gate can be wired before the
  // first ADR exists, and stay wired after the last one is removed. Then every reference
  // left in the tree dangles, so the scan still runs.
  const files = isDirectory(adrDir) ? adrFiles(adrDir) : []
  if (files.length === 0) {
    const dangling = danglingReferences(files)
    if (dangling.length > 0) {
      reportDangling(dangling, strict)
      return strict ? 1 : 0
    }
    const where = isDirectory(adrDir) ? `no decision records in ${adrDir}/` : `no ${adrDir}/ directory`
    console.log(`adr-check: ${where} — nothing to check.`)
    return 0
  }

  const hasHead = git('rev-parse', '--verify', 'HEAD') !== null
  const problems = []
  const oversized = []
  const invented = []
  let corpusWords = 0

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const count = words(text)
    corpusWords += count
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
  const dangling = danglingReferences(files)
  if (dangling.length > 0) reportDangling(dangling, strict)
  // What an agent pays to load the whole log: the before/after number a triage reports.
  console.log(
    `adr-check: corpus — ${files.length} record(s), ${corpusWords} words, ≈${Math.round(corpusWords * 1.35)} tokens.`,
  )

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`\nSee rules/agent/decisions.md for the lifecycle.`)
    return 1
  }
  if (strict && (budgetCount > 0 || dangling.length > 0)) return 1

  const warnings = budgetCount + dangling.length
  const note = warnings > 0 ? ` (${warnings} advisory warning(s) above)` : ''
  console.log(`adr-check: ${files.length} decision record(s) in order.${note}${budgetNote}`)
  return 0
}

process.exit(main())
