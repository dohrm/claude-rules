#!/usr/bin/env node

// scope-report — where a branch went beyond what its RFC's steps declared, per package.
// An indicator for the human and the L4 orchestrator, never a gate: line counts are not
// a verdict, and an undeclared package is a question to answer from the RFC's `changed:`
// or `## Assumptions` lines (skills/rfc § L4, "Judge the artifacts").
//
// Declared: the backticked tokens of each step's `touches` (up to `→ proof`) that read as
// a path — no space, no glob, and either a `/` or the name of a file at the repo root —
// so a symbol (`base`, `PATTERNS`, `err.message`, `v1.2`) or a pattern
// (`*/.review_passes`) is ignored. A root file a step creates exists once committed; a
// root directory is written with its trailing `/`. On an L4 phase branch
// `phase/<slug>/<n>`, only phase <n>'s steps declare: its diff against `rfc/<slug>` is
// that phase alone, and the other phases' packages would all read "declared, untouched".
// Anywhere else, every step does.
//
// Touched: `git diff --numstat <base>...HEAD`, without `.work/` (the RFC's own state,
// never a step's touch).
//
// A path's package is the nearest directory below the repo root holding a manifest
// (MANIFESTS, or a `*.csproj`), else its top-level directory, else `.` for a root file.
// A manifest at the root names the repository, not a package: counted, it would fold
// every path of a single-manifest repo into one row.
//
// The RFC is read the way the review reads it (`resolveRfc` in review-context.mjs): the
// local `rfc.md`, else the ticket cache `review-context.md`. No RFC is reported, not
// refused — the table still says which packages moved. A `defect.md` frame reads as no
// RFC: a diagnosis has no `## Steps`, so nothing it touches is overflow.
//
// Usage: node scope-report.mjs [--slug <s>] [--json] <base>    markdown (or, with
//        `--json`, `scopeData`'s object) on stdout, exit 0; exit 2 only when there is
//        nothing to report (no base, git cannot diff). `--json` is for a script that
//        reads the verdict's inputs (l4.mjs): a markdown table is for people.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRfc } from './review-context.mjs'
import { currentBranch } from './work-slug.mjs'

const MANIFESTS = ['Cargo.toml', 'go.mod', 'package.json', 'pyproject.toml', 'project.godot']

function bail(msg) {
  console.error(`scope-report: ${msg}`)
  process.exit(2)
}

/** The `## Steps` section's step lines, each with the phase it sits under (null before
 *  any `### Phase <n>` heading). */
function stepsOf(text) {
  const start = text.search(/^##\s+Steps\s*$/m)
  if (start === -1) return []
  const body = text.slice(start).replace(/^##[^\n]*\n/, '').split(/^##\s/m)[0]
  const steps = []
  let phase = null
  for (const line of body.split('\n')) {
    const h = line.match(/^###\s+Phase\s+(\d+)\b/i)
    if (h) phase = h[1]
    else if (/^\s*[-*]\s*\[[ xX]\]/.test(line)) steps.push({ phase, line })
  }
  return steps
}

/** The paths a step line declares: backticked tokens of its `touches` clause that read
 *  as a path (see the header), repo-relative, without a leading `./`. A trailing `/` is
 *  kept: it says the token names a directory. */
function declaredPaths(line, cwd) {
  const at = line.search(/\btouches\b/)
  if (at === -1) return []
  const clause = line.slice(at).split(/\s(?:→|->)\s*proof\b/)[0]
  return [...clause.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim().replace(/^\.\//, ''))
    .filter((t) => (t.includes('/') || isFile(join(cwd, t))) && !/[\s*?[\]{}<>:]/.test(t))
    .filter((t) => t.replace(/\/+$/, ''))
}

function isFile(abs) {
  try {
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

function hasManifest(cwd, dir) {
  const abs = join(cwd, dir)
  if (MANIFESTS.some((m) => existsSync(join(abs, m)))) return true
  try {
    return readdirSync(abs).some((f) => f.endsWith('.csproj'))
  } catch {
    return false
  }
}

/** The package `path` belongs to (see the header). A path that names a directory — a
 *  trailing `/`, or a directory on disk — is looked up from itself, so its own manifest
 *  counts. */
function packageOf(path, cwd) {
  let isDir = path.endsWith('/')
  try {
    isDir ||= statSync(join(cwd, path)).isDirectory()
  } catch {
    // A deleted or not-yet-created path: a file, unless its token said otherwise.
  }
  const parts = path.replace(/\/+$/, '').split('/')
  const dirs = isDir ? parts : parts.slice(0, -1)
  for (let n = dirs.length; n > 0; n--) {
    const dir = dirs.slice(0, n).join('/')
    if (hasManifest(cwd, dir)) return dir
  }
  return dirs.length ? dirs[0] : '.'
}

/** `{ add, del, path }` per changed file, or null when git cannot diff against `base`. */
function numstat(base, cwd) {
  let out
  try {
    out = execFileSync('git', ['diff', '--numstat', '--no-renames', '-z', `${base}...HEAD`],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
  return out.split('\0').filter(Boolean).map((rec) => {
    const [add, del, ...rest] = rec.split('\t')
    // A binary file reports `-`: it changed, with no line count.
    return { add: Number(add) || 0, del: Number(del) || 0, path: rest.join('\t') }
  }).filter((f) => !f.path.startsWith('.work/'))
}

/** Where the declared steps come from, or null when there is no document to read. */
function source(rfc) {
  if (rfc.kind === 'local') return `${rfc.path} (local RFC)`
  if (rfc.kind === 'ticket') return `${rfc.ticket}, cached in ${rfc.cachePath} at ${rfc.written}`
  return null
}

/** Why nothing is declared, said in the report instead of failing it. */
function why(rfc) {
  if (rfc.kind === 'defect') return `${rfc.path} is a defect diagnosis: no steps declare, nothing compared against.`
  if (rfc.kind === 'none') return `No RFC for this branch (slug \`${rfc.slug}\`, from the ${rfc.from}): nothing declared to compare against.`
  if (rfc.kind === 'unavailable') return `RFC not available: ${rfc.path} points to ${rfc.ticket} and no ${rfc.cachePath} was cached (skills/rfc/ticket.md § Implementation).`
  if (rfc.kind === 'ambiguous') return `RFC not available: ${rfc.files.join(', ')} all claim this branch.`
  return `RFC not available: ${rfc.message}`
}

/** The report as data: `{ source, why, phase, declared, rows }`, one row per package
 *  `{ package, added, removed, touched, declared, overflow }` (touched first, then the
 *  declared ones the diff never reached), or null when git cannot diff against `base`. `rfc`
 *  overrides the RFC read from `cwd`: the L4 referee judges a phase tree against the
 *  integration tree's RFC, never against a copy the executor could have edited. */
export function scopeData({ base, slug = '', cwd = '.', rfc = null }) {
  const files = numstat(base, cwd)
  if (!files) return null
  if (!rfc) {
    try {
      rfc = resolveRfc({ slug, cwd })
    } catch (err) {
      rfc = { kind: 'error', message: err.message }
    }
  }
  const from = source(rfc)
  const steps = from ? stepsOf(rfc.text) : []
  const phase = currentBranch(cwd)?.match(/^phase\/[^/]+\/(\d+)$/)?.[1]
  const scoped = phase && steps.some((s) => s.phase === phase) ? steps.filter((s) => s.phase === phase) : steps

  const declared = new Set(scoped.flatMap((s) => declaredPaths(s.line, cwd)).map((p) => packageOf(p, cwd)))
  const touched = new Map()
  for (const f of files) {
    const pkg = packageOf(f.path, cwd)
    const t = touched.get(pkg) ?? { add: 0, del: 0 }
    touched.set(pkg, { add: t.add + f.add, del: t.del + f.del })
  }
  const rows = [...touched].sort(([a], [b]) => a.localeCompare(b)).map(([pkg, t]) => ({
    package: pkg, added: t.add, removed: t.del, touched: true,
    declared: declared.has(pkg), overflow: !!from && !declared.has(pkg),
  }))
  for (const pkg of [...declared].filter((p) => !touched.has(p)).sort()) {
    rows.push({ package: pkg, added: 0, removed: 0, touched: false, declared: true, overflow: false })
  }
  return {
    source: from, why: from ? null : why(rfc), phase: scoped !== steps ? phase : null,
    declared: declared.size, rows,
  }
}

function scopeReport({ base, slug = '', cwd = '.' }) {
  const data = scopeData({ base, slug, cwd })
  if (!data) return null
  const { source: from, rows } = data

  const lines = [`## Scope report — \`${base}...HEAD\``, '']
  lines.push(from
    ? `Declared by: ${data.phase ? `Phase ${data.phase} of ` : ''}${from} — `
      + `${data.declared} package${data.declared === 1 ? '' : 's'} in the steps' \`touches\`.`
    : data.why, '')
  if (rows.length === 0) return [...lines, 'No change against the base.', ''].join('\n')

  lines.push('| Package | + | − | Declared |', '|---|---:|---:|---|')
  const touched = rows.filter((r) => r.touched)
  const untouched = rows.filter((r) => !r.touched)
  for (const r of touched) {
    const mark = !from ? '—' : r.declared ? 'yes' : '**no — overflow**'
    lines.push(`| \`${r.package}\` | +${r.added} | -${r.removed} | ${mark} |`)
  }
  for (const r of untouched) lines.push(`| \`${r.package}\` | 0 | 0 | declared, untouched |`)
  lines.push('')
  if (from) {
    lines.push(`${touched.length} touched, ${rows.filter((r) => r.overflow).length} not declared, `
      + `${untouched.length} declared but untouched. `
      + 'An indicator, not a verdict: justify each overflow from the RFC, or reject it.', '')
  }
  return lines.join('\n')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--slug')
  const slug = i === -1 ? '' : (argv.splice(i, 2)[1] ?? '')
  const json = argv.includes('--json')
  const [base] = argv.filter((a) => a !== '--json')
  if (!base) bail('missing base — usage: scope-report [--slug <s>] [--json] <base>')
  const report = json ? scopeData({ base, slug }) : scopeReport({ base, slug })
  if (report === null) bail(`git cannot diff against \`${base}\` — fetch it, or pass another base`)
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : report)
}
