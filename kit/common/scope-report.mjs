#!/usr/bin/env node

// scope-report — where a branch went beyond what its RFC's steps declared, per package.
// An indicator for the human and the L4 orchestrator, never a gate: line counts are not
// a verdict, and an undeclared package is a question to answer from the RFC's `changed:`
// or `## Assumptions` lines (skills/rfc § L4, "Judge the artifacts").
//
// Declared: the backticked tokens of each step's `touches` (up to `→ proof`) that read as
// a path — a `/` or a file extension, no space, no glob — so a symbol (`base`,
// `PATTERNS`) or a pattern (`*/.review_passes`) is ignored. On an L4 phase branch
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
// refused — the table still says which packages moved.
//
// Usage: node scope-report.mjs [--slug <s>] <base>    markdown on stdout, exit 0;
//        exit 2 only when there is nothing to report (no base, git cannot diff).

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
 *  as a path, repo-relative, without a leading `./`. A trailing `/` is kept: it says the
 *  token names a directory. */
function declaredPaths(line) {
  const at = line.search(/\btouches\b/)
  if (at === -1) return []
  const clause = line.slice(at).split(/\s(?:→|->)\s*proof\b/)[0]
  return [...clause.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim().replace(/^\.\//, ''))
    .filter((t) => (t.includes('/') || /\.[A-Za-z0-9]+$/.test(t)) && !/[\s*?[\]{}<>:]/.test(t))
    .filter((t) => t.replace(/\/+$/, ''))
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
  if (rfc.kind === 'defect') return `${rfc.path} (defect diagnosis)`
  return null
}

/** Why nothing is declared, said in the report instead of failing it. */
function why(rfc) {
  if (rfc.kind === 'none') return `No RFC for this branch (slug \`${rfc.slug}\`, from the ${rfc.from}): nothing declared to compare against.`
  if (rfc.kind === 'unavailable') return `RFC not available: ${rfc.path} points to ${rfc.ticket} and no ${rfc.cachePath} was cached (skills/rfc/ticket.md § Implementation).`
  if (rfc.kind === 'ambiguous') return `RFC not available: ${rfc.files.join(', ')} all claim this branch.`
  return `RFC not available: ${rfc.message}`
}

function scopeReport({ base, slug = '', cwd = '.' }) {
  const files = numstat(base, cwd)
  if (!files) return null
  let rfc
  try {
    rfc = resolveRfc({ slug, cwd })
  } catch (err) {
    rfc = { kind: 'error', message: err.message }
  }
  const from = source(rfc)
  const steps = from ? stepsOf(rfc.text) : []
  const phase = currentBranch(cwd)?.match(/^phase\/[^/]+\/(\d+)$/)?.[1]
  const scoped = phase && steps.some((s) => s.phase === phase) ? steps.filter((s) => s.phase === phase) : steps

  const declared = new Set(scoped.flatMap((s) => declaredPaths(s.line)).map((p) => packageOf(p, cwd)))
  const touched = new Map()
  for (const f of files) {
    const pkg = packageOf(f.path, cwd)
    const t = touched.get(pkg) ?? { add: 0, del: 0 }
    touched.set(pkg, { add: t.add + f.add, del: t.del + f.del })
  }

  const lines = [`## Scope report — \`${base}...HEAD\``, '']
  lines.push(from
    ? `Declared by: ${scoped !== steps ? `Phase ${phase} of ` : ''}${from} — `
      + `${declared.size} package${declared.size === 1 ? '' : 's'} in the steps' \`touches\`.`
    : why(rfc), '')
  if (touched.size === 0 && declared.size === 0) return [...lines, 'No change against the base.', ''].join('\n')

  lines.push('| Package | + | − | Declared |', '|---|---:|---:|---|')
  let overflow = 0
  for (const [pkg, t] of [...touched].sort(([a], [b]) => a.localeCompare(b))) {
    const mark = !from ? '—' : declared.has(pkg) ? 'yes' : '**no — overflow**'
    if (from && !declared.has(pkg)) overflow++
    lines.push(`| \`${pkg}\` | +${t.add} | -${t.del} | ${mark} |`)
  }
  const untouched = [...declared].filter((p) => !touched.has(p)).sort()
  for (const pkg of untouched) lines.push(`| \`${pkg}\` | 0 | 0 | declared, untouched |`)
  lines.push('')
  if (from) {
    lines.push(`${touched.size} touched, ${overflow} not declared, ${untouched.length} declared but untouched. `
      + 'An indicator, not a verdict: justify each overflow from the RFC, or reject it.', '')
  }
  return lines.join('\n')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--slug')
  const slug = i === -1 ? '' : (argv.splice(i, 2)[1] ?? '')
  const [base] = argv
  if (!base) bail('missing base — usage: scope-report [--slug <s>] <base>')
  const report = scopeReport({ base, slug })
  if (report === null) bail(`git cannot diff against \`${base}\` — fetch it, or pass another base`)
  process.stdout.write(report)
}
