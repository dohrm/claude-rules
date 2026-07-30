#!/usr/bin/env node
// Tier 2 gate — the living documents stay readable as the project grows.
//
// The doctrine lives in `rules/product/documents.md`: a document that must grow is a
// directory of append-only units plus a COMPACTED INDEX, never one file that gets longer.
// This is its executable half.
//
// It FAILS on broken structure — facts, not judgments:
//   • a link from an index to a unit file that does not exist;
//   • a unit file no index links to (invisible: nobody will read it).
//
// It WARNS (advisory; `--strict` promotes warnings to failures) on the budgets:
//   • an index over one screen — an index that has to be skimmed is not a compaction;
//   • a unit over its ceiling — it is two units, or it holds a description that belongs
//     in DATA-MODEL / EXPERIENCE / an ADR;
//   • a single-file PRD/PLAN past the split threshold;
//   • a `(continued)` heading — the documented symptom of growth-by-inflation.
//
// `docs/adr/` is deliberately NOT checked here: adr-check.mjs owns it (same budgets, plus
// the status/commit guard).
//
// Node rather than bash so `just check` stays cross-platform — see kit/README.md. No
// dependencies; Node >= 18.
//
// Usage:  node scripts/docs-check.mjs [docs-dir] [--strict]      (default dir: docs)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// ADAPT to your project if a document legitimately needs a different budget — you own
// this file. Targets come from rules/product/documents.md; ceilings are 1.5× the target,
// so a gate fires on a real overshoot and not on a well-written unit.
const LIVING = [
  {
    name: 'plan',
    index: 'PLAN.md',
    units: 'plan',
    unitCeiling: 600, // ~400-word phase
    splitLines: 400,
    unitMarker: /^##\s*Phase\s/gm, // the single-file shape, from the /plan template
    splitAt: 6,
  },
  {
    name: 'PRD',
    index: 'PRD.md',
    units: 'prd',
    unitCeiling: 750, // ~500-word capability
    splitLines: 400,
    unitMarker: null, // capabilities have no stable single-file marker — size only
    splitAt: 8,
  },
]
const INDEX_CEILING = 500 // words — "one screen", generously

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const docsDir = args.find((a) => !a.startsWith('--')) ?? 'docs'

const words = (s) => s.split(/\s+/).filter(Boolean).length
const lines = (s) => s.split(/\r?\n/).length
const read = (f) => readFileSync(f, 'utf8')
const isDir = (p) => existsSync(p) && statSync(p).isDirectory()
const mdFiles = (dir) =>
  readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
    .sort()
    .map((n) => path.join(dir, n))

/** Markdown link targets, resolved against the file that carries them. */
function linkedPaths(file, text) {
  const base = path.dirname(file)
  return [...text.matchAll(/\]\(([^)\s#]+)/g)]
    .map((m) => m[1])
    .filter((href) => !/^[a-z]+:/i.test(href) && href.endsWith('.md'))
    .map((href) => path.normalize(path.join(base, href)))
}

function checkLiving(doc, problems, warnings) {
  const indexPath = path.join(docsDir, doc.index)
  const unitsPath = path.join(docsDir, doc.units)
  const hasIndex = existsSync(indexPath)
  const hasUnits = isDir(unitsPath)
  if (!hasIndex && !hasUnits) return

  // ---- split into units, or still one file?
  if (hasUnits) {
    const units = mdFiles(unitsPath)
    const indexText = hasIndex ? read(indexPath) : ''

    if (!hasIndex) {
      problems.push(`${unitsPath}/: ${units.length} unit(s) with no ${indexPath} to index them.`)
      return
    }

    const indexWords = words(indexText)
    if (indexWords > INDEX_CEILING) {
      warnings.push({
        kind: 'index',
        file: indexPath,
        detail: `${indexWords} words (ceiling ${INDEX_CEILING})`,
      })
    }

    const linked = new Set(linkedPaths(indexPath, indexText))
    for (const target of linked) {
      if (target.startsWith(unitsPath) && !existsSync(target))
        problems.push(`${indexPath}: links to ${target}, which does not exist.`)
    }
    for (const unit of units) {
      if (!linked.has(path.normalize(unit)))
        problems.push(
          `${unit}: no link from ${indexPath} — a unit the index does not carry is invisible.`,
        )
      const w = words(read(unit))
      if (w > doc.unitCeiling)
        warnings.push({
          kind: 'unit',
          file: unit,
          detail: `${w} words (ceiling ${doc.unitCeiling})`,
        })
    }
    return
  }

  // ---- single file: is it time to split?
  const text = read(indexPath)
  const l = lines(text)
  const unitCount = doc.unitMarker ? (text.match(doc.unitMarker) ?? []).length : 0
  if (l > doc.splitLines || unitCount > doc.splitAt) {
    const why = [
      l > doc.splitLines ? `${l} lines (threshold ${doc.splitLines})` : null,
      unitCount > doc.splitAt ? `${unitCount} units (threshold ${doc.splitAt})` : null,
    ]
      .filter(Boolean)
      .join(', ')
    warnings.push({
      kind: 'split',
      file: indexPath,
      detail: `${why} — split into ${docsDir}/${doc.units}/ + an index`,
    })
  }
}

/** The documented symptom of growth-by-inflation, anywhere under docs/. */
function checkContinued(warnings) {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (isDir(p)) {
        if (name !== 'adr') walk(p)
      } else if (name.endsWith('.md')) {
        for (const m of read(p).matchAll(/^#{1,6}\s+.*\(continued\).*$/gim))
          warnings.push({ kind: 'continued', file: p, detail: m[0].trim().slice(0, 70) })
      }
    }
  }
  walk(docsDir)
}

const EXPLAIN = {
  index:
    'An index is the compaction, not a table of contents: one line per unit, and enough to' +
    ' answer where-are-we / what-next / what-is-out. Past a screen it is being used to store' +
    ' facts that belong in a unit.',
  unit:
    'A unit is one thing. Over the ceiling it is two units, or it carries a description that' +
    ' belongs elsewhere (fields → DATA-MODEL, screen behavior → EXPERIENCE, why-this-choice →' +
    ' an ADR). Split it; do not compress the reasoning.',
  split:
    'A document meant to grow becomes a directory of units plus an index — growth adds a file,' +
    ' it never lengthens an existing section. /prd and /plan do the migration.',
  continued:
    'A `(continued)` heading is growth by inflation: the new scope was appended to an existing' +
    ' section instead of arriving as its own unit.',
}
const TITLE = {
  index: 'index over one screen',
  unit: 'unit over its ceiling',
  split: 'past the split threshold',
  continued: '`(continued)` heading',
}

function report(warnings) {
  const label = strict ? 'error' : 'warning'
  for (const kind of ['index', 'unit', 'split', 'continued']) {
    const group = warnings.filter((w) => w.kind === kind)
    if (group.length === 0) continue
    console.error(`docs-check ${label}: ${group.length} × ${TITLE[kind]}:`)
    for (const w of group) console.error(`  ${w.file} — ${w.detail}`)
    console.error(`  ${EXPLAIN[kind]}`)
  }
  console.error(
    `\nBudgets and shapes: rules/product/documents.md` +
      (strict ? '' : ' (advisory here — pass --strict to enforce them).'),
  )
}

function main() {
  // A repo with no docs is not a failing repo — the gate can be wired before the first
  // document exists.
  if (!isDir(docsDir)) {
    console.log(`docs-check: no ${docsDir}/ directory — nothing to check.`)
    return 0
  }

  const problems = []
  const warnings = []
  for (const doc of LIVING) checkLiving(doc, problems, warnings)
  checkContinued(warnings)

  if (warnings.length > 0) report(warnings)
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`\nSee rules/product/documents.md — an index and its units must agree.`)
    return 1
  }
  if (strict && warnings.length > 0) return 1

  const note = warnings.length > 0 ? ` (${warnings.length} advisory warning(s) above)` : ''
  console.log(`docs-check: ${docsDir}/ in order.${note}`)
  return 0
}

process.exit(main())
