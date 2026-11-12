#!/usr/bin/env node

// l4 — the L4 referee: whether a phase merges into `rfc/<slug>` is read from facts by
// this script, not decided by an agent applying a paragraph (rules/agent/autonomy.md § L4).
// It is a judge, not an orchestrator: it starts no agent and stores no plan.
//
// Invariant: a phase is merged only on a `merge` verdict recorded for the exact sha being
// merged, and only when the RFC's `## Delegation board` delegates `phase-merge`. A level
// never changes what counts as done.
//
//   node l4.mjs judge <n> [--slug <s>] [--ci <cmd>] [--justify <pkg>=<text>]...
//   node l4.mjs merge <n> [--slug <s>]
//
// Both run in the INTEGRATION tree, on `rfc/<slug>`. `judge` finds the phase tree with
// `git worktree list` (branch `phase/<slug>/<n>`), runs `just check` there, reads its
// review report through review-guard's own parser, runs the CI command with the phase
// branch as its last argument, and reads `scope-report`'s data against the integration
// tree's RFC. It prints one line, `l4: <verdict> — <reasons>`, and exits:
//
//   0 merge     every fact is green (CI not wired is recorded as declared, never as green)
//   1 reject    red check, CRITICAL, missing/malformed/stale report, red CI — the executor
//               gets another round
//   3 escalate  a 🔴 whose **Model** line is `gap`, an overflow package no `--justify`
//               clears, a reject past the board's rejected-rounds cap — and the refusals:
//               a board or a journal line that does not parse (nothing is written then)
//   4 wait      CI still running (the CI command exited 8, `gh pr checks`' "pending")
//   2 usage     not the integration tree, no phase tree, uncommitted work in it
//
// Precedence: escalate > reject > wait > merge — a human is needed whatever else is red.
//
// `merge` requires the last verdict for <n> to be `merge` on the phase's current HEAD, and
// `phase-merge` on the board; it runs `git merge --no-ff <that sha>` and pushes. It exits 0
// merged, 3 refused (the verdict stands: the human merges, or the executor rebases).
//
// The journal `.work/<slug>/l4.jsonl` is append-only and written only here; each append is
// committed on `rfc/<slug>`, alone (`git commit --only`). A line that does not parse is
// refused, never skipped: state replayed "best effort" is state nobody can audit.
// `--justify` takes `<pkg>=<text>`, several per value separated by newlines (the just
// recipe passes one string); `<text>` must appear verbatim in a `changed:` line or in the
// `## Assumptions` section of the resolved RFC.

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRfc } from './review-context.mjs'
import { readVerdict } from './review-guard.mjs'
import { scopeData } from './scope-report.mjs'
import { currentBranch, resolveSlug } from './work-slug.mjs'

const EXIT = { merge: 0, reject: 1, usage: 2, escalate: 3, wait: 4 }
const VERDICTS = ['merge', 'reject', 'escalate', 'wait']
const CI_PENDING = 8
const SHA40 = /^[0-9a-f]{40}$/

/** A refusal: printed as one `l4:` line, with the exit code it names. */
class Refusal extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
const refuse = (code, message) => { throw new Refusal(code, message) }

// ── The board ─────────────────────────────────────────────────────────────────
// Four `- Key: value` lines with closed vocabularies; `Pass envelope` may be absent
// (absent is 0, autonomy.md § L4). Prose around them is ignored; any other bullet is not.
export const DELEGABLE = ['phase-merge', 'hold-command', 'changed-decision']
export const AGENTS = ['claude', 'codex', 'cursor', 'opencode']
const CAPS = ['budget', 'review-passes', 'rejected-rounds']

/** `{ delegated, executors, caps, envelope }` from the RFC text, or throws a Refusal (3)
 *  naming the line that does not parse. */
export function parseBoard(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^##\s+Delegation board\s*$/.test(l))
  if (start === -1) refuse(EXIT.escalate, 'board: no `## Delegation board` section — the RFC runs at L3, and L3 has no referee')
  const board = {}
  for (let i = start + 1; i < lines.length && !/^##?\s/.test(lines[i]); i++) {
    const line = lines[i]
    if (!/^\s*[-*]\s/.test(line)) continue
    const where = `board line ${i + 1}: \`${line.trim()}\``
    const m = line.match(/^\s*[-*]\s+([A-Za-z][A-Za-z ]*?):\s*(.*?)\s*$/)
    const key = m?.[1].toLowerCase()
    if (!m || !['delegated', 'executors', 'caps', 'pass envelope'].includes(key)) {
      refuse(EXIT.escalate, `${where} — expected one of Delegated, Executors, Caps, Pass envelope`)
    }
    if (key in board) refuse(EXIT.escalate, `${where} — ${m[1]} is given twice`)
    board[key] = parseBoardValue(key, m[2], where)
  }
  for (const key of ['delegated', 'executors', 'caps']) {
    if (!(key in board)) refuse(EXIT.escalate, `board: no \`- ${key[0].toUpperCase()}${key.slice(1)}:\` line`)
  }
  return {
    delegated: board.delegated, executors: board.executors, caps: board.caps,
    envelope: board['pass envelope'] ?? 0,
  }
}

function parseBoardValue(key, value, where) {
  if (key === 'delegated') {
    if (value === '' || value === 'none') return []
    const items = value.split(',').map((s) => s.trim())
    const bad = items.filter((s) => !DELEGABLE.includes(s))
    if (bad.length) refuse(EXIT.escalate, `${where} — not delegable: ${bad.join(', ')} (one of ${DELEGABLE.join(', ')})`)
    return items
  }
  if (key === 'executors') {
    const execs = value.split('|').map((s) => s.trim().split(/\s*·\s*/))
    const bad = execs.filter((e) => e.length !== 2 || !AGENTS.includes(e[0]) || !e[1])
    if (value === '' || bad.length) {
      refuse(EXIT.escalate, `${where} — expected \`<agent> · <model>\` separated by \`|\`, agent one of ${AGENTS.join(', ')}`)
    }
    return execs.map(([agent, model]) => ({ agent, model }))
  }
  if (key === 'caps') {
    const caps = {}
    for (const part of value.split(';').map((s) => s.trim()).filter(Boolean)) {
      const [name, v = ''] = part.split('=').map((s) => s.trim())
      if (!CAPS.includes(name)) refuse(EXIT.escalate, `${where} — unknown cap \`${name}\` (${CAPS.join(', ')})`)
      if (name in caps) refuse(EXIT.escalate, `${where} — cap \`${name}\` is given twice`)
      const ok = name === 'budget' ? /^[1-9]\d*\s+(minutes|tokens)$/.test(v)
        : name === 'review-passes' ? /^[1-9]\d*$/.test(v) : /^\d+$/.test(v)
      if (!ok) refuse(EXIT.escalate, `${where} — ${name}=${v || '(empty)'} is not a valid cap`)
      caps[name] = name === 'budget' ? v : Number(v)
    }
    const missing = CAPS.filter((c) => !(c in caps))
    if (missing.length) refuse(EXIT.escalate, `${where} — every cap is required, missing: ${missing.join(', ')}`)
    return caps
  }
  if (!/^\d+$/.test(value)) refuse(EXIT.escalate, `${where} — the pass envelope is a non-negative integer`)
  return Number(value)
}

// ── The journal ───────────────────────────────────────────────────────────────
// One JSON object per line: `{ kind: 'verdict', phase, sha, verdict, reasons, ci,
// warnings, justified, at }` or `{ kind: 'merged', phase, sha, commit, at }`.

/** Every entry of the journal at `path` (none when it does not exist yet), or throws a
 *  Refusal (3) naming the first line that does not parse. */
export function readJournal(path) {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line, i) => {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      e = null
    }
    const ok = e && typeof e === 'object' && /^\d+$/.test(e.phase ?? '') && SHA40.test(e.sha ?? '')
      && (e.kind === 'verdict' ? VERDICTS.includes(e.verdict) && Array.isArray(e.reasons)
        : e.kind === 'merged' && SHA40.test(e.commit ?? ''))
    if (!ok) refuse(EXIT.escalate, `${path} line ${i + 1} does not parse — the journal is refused, never read "best effort"`)
    return e
  })
}

// ── git and the trees ─────────────────────────────────────────────────────────

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

/** The worktree checked out on `branch`, or null. */
function treeOn(branch, cwd) {
  const out = git(cwd, 'worktree', 'list', '--porcelain')
  for (const block of out.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1]
    if (block.split('\n').includes(`branch refs/heads/${branch}`)) return path
  }
  return null
}

/** What every verb needs: the slug, the RFC, the board, the journal and the branches. */
function context({ n, slug, cwd }) {
  if (!/^[1-9]\d*$/.test(n ?? '')) refuse(EXIT.usage, `a phase number is required, got \`${n ?? ''}\``)
  const s = resolveSlug({ slug, cwd }).slug
  const integration = `rfc/${s}`
  const branch = currentBranch(cwd)
  if (branch !== integration) {
    refuse(EXIT.usage, `run from the integration tree, on ${integration} — this tree is on ${branch ?? 'a detached HEAD'}`)
  }
  const rfc = resolveRfc({ slug: s, cwd })
  if (rfc.kind !== 'local' && rfc.kind !== 'ticket') {
    refuse(EXIT.escalate, `board: the RFC for ${s} cannot be read (${rfc.kind}) — refresh the ticket cache, or check .work/${s}/`)
  }
  const board = parseBoard(rfc.text)
  const journalPath = join(cwd, '.work', s, 'l4.jsonl')
  return { n, slug: s, cwd, integration, phase: `phase/${s}/${n}`, rfc, board, journalPath, journal: readJournal(journalPath) }
}

/** Appends `entry` to the journal and commits that file alone on the integration branch. */
function record(ctx, entry) {
  mkdirSync(join(ctx.cwd, '.work', ctx.slug), { recursive: true })
  appendFileSync(ctx.journalPath, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`)
  const rel = join('.work', ctx.slug, 'l4.jsonl')
  try {
    git(ctx.cwd, 'add', '--', rel)
    git(ctx.cwd, 'commit', '--quiet', '--only', '-m',
      `l4: phase ${entry.phase} ${entry.kind === 'merged' ? 'merged' : entry.verdict} at ${entry.sha.slice(0, 7)}`, '--', rel)
  } catch (err) {
    refuse(EXIT.usage, `the journal line is written but not committed (${firstLine(err)}) — commit ${rel}, never edit it`)
  }
}

const firstLine = (err) => String(err.stderr || err.message).trim().split('\n')[0]

// ── judge ─────────────────────────────────────────────────────────────────────

/** `{ pkg: text }` from the `--justify` values, each `<pkg>=<text>` per line. */
function parseJustify(values) {
  const out = {}
  for (const line of values.flatMap((v) => v.split('\n')).map((l) => l.trim()).filter(Boolean)) {
    const at = line.indexOf('=')
    if (at < 1 || !line.slice(at + 1).trim()) refuse(EXIT.usage, `--justify takes <package>=<text>, got \`${line}\``)
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** The lines a justification may quote: those holding `changed:`, and the `## Assumptions`
 *  section's. */
function justifyingLines(text) {
  const out = []
  let inAssumptions = false
  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) inAssumptions = h2[1].toLowerCase() === 'assumptions'
    else if (inAssumptions || line.includes('changed:')) out.push(line)
  }
  return out
}

/** The text of the report section whose `### ` heading starts with `emoji`, or ''. */
function section(report, emoji) {
  const m = report.match(new RegExp(`^###\\s*${emoji}[^\\n]*\\n([\\s\\S]*?)(?=^#{2,3}\\s|^<!--|(?![\\s\\S]))`, 'mu'))
  return m ? m[1] : ''
}

/** The review report's facts: `{ reject, escalate, warnings }`, each a list of reasons. */
function reviewFacts(tree, head) {
  const path = join(tree, '.work', 'review-report.md')
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (!text.trim()) return { reject: ['no review report — no report is not a pass'], escalate: [], warnings: [] }
  const { verdict, sha, broken } = readVerdict(text)
  if (broken.length) return { reject: [`review report malformed: ${broken.join(' ')}`], escalate: [], warnings: [] }
  const reject = []
  const escalate = []
  if (verdict === 'CRITICAL') reject.push('review verdict CRITICAL')
  if (!head.startsWith(sha)) reject.push(`review report is stale: it reviewed ${sha.slice(0, 7)}, the phase HEAD is ${head.slice(0, 7)}`)
  const critical = section(text, '🔴')
  if (/\*\*Model\*\*:?\s*:?\s*`?gap\b/i.test(critical)) escalate.push('a 🔴 whose **Model** line is `gap` — a spec gap is the human\'s')
  const warnings = section(text, '🟡').split('\n').filter((l) => /^([-*]|\d+[.)])\s/.test(l)).map((l) => l.trim())
  return { reject, escalate, warnings }
}

/** `green`, `running`, `red` or `not-wired`, from the CI command run with the branch. */
function ciState(cmd, branch, cwd) {
  if (!cmd.trim()) return 'not-wired'
  const r = spawnSync('sh', ['-c', `${cmd} "$1"`, 'sh', branch], { cwd, stdio: ['ignore', 2, 2] })
  return r.status === 0 ? 'green' : r.status === CI_PENDING ? 'running' : 'red'
}

export function judge({ n, slug = '', ci: ciCmd = '', justify = [], cwd = '.' }) {
  const ctx = context({ n, slug, cwd })
  const tree = treeOn(ctx.phase, cwd)
  if (!tree) refuse(EXIT.usage, `no worktree on ${ctx.phase} — \`just tree\` makes one`)
  if (git(tree, 'status', '--porcelain')) {
    refuse(EXIT.usage, `${tree} has uncommitted changes — a verdict is bound to a commit, judge a committed HEAD`)
  }
  const head = git(tree, 'rev-parse', 'HEAD')
  const justified = parseJustify(justify)

  const reject = []
  const escalate = []
  const check = spawnSync('just', ['check'], { cwd: tree, stdio: ['ignore', 2, 2] })
  if (check.status !== 0) reject.push(check.error ? `just check could not run (${check.error.code})` : `just check exited ${check.status}`)

  const review = reviewFacts(tree, head)
  reject.push(...review.reject)
  escalate.push(...review.escalate)

  const ci = ciState(ciCmd, ctx.phase, tree)
  if (ci === 'red') reject.push('CI is red')

  const scope = scopeData({ base: ctx.integration, slug: ctx.slug, cwd: tree, rfc: ctx.rfc })
  if (!scope) refuse(EXIT.usage, `git cannot diff ${ctx.phase} against ${ctx.integration}`)
  const quotable = justifyingLines(ctx.rfc.text)
  for (const { package: pkg } of scope.rows.filter((r) => r.overflow)) {
    const text = justified[pkg]
    if (!text) escalate.push(`overflow package \`${pkg}\` is not justified`)
    else if (!quotable.some((l) => l.includes(text))) {
      escalate.push(`overflow package \`${pkg}\`: its justification is in no \`changed:\` or \`## Assumptions\` line`)
    }
  }

  const rejectedBefore = ctx.journal.filter((e) => e.kind === 'verdict' && e.phase === n && e.verdict === 'reject').length
  if (!escalate.length && reject.length && rejectedBefore >= ctx.board.caps['rejected-rounds']) {
    escalate.push(`rejected past the cap: ${rejectedBefore} rejected round(s) of ${ctx.board.caps['rejected-rounds']} already spent`)
  }

  const verdict = escalate.length ? 'escalate' : reject.length ? 'reject' : ci === 'running' ? 'wait' : 'merge'
  const reasons = escalate.length ? [...escalate, ...reject] : reject.length ? reject
    : ci === 'running' ? ['CI is still running']
      : [`all green at ${head.slice(0, 7)}${ci === 'not-wired' ? ' — Tier 4 not wired (declared, not green)' : ''}`]
  record(ctx, {
    kind: 'verdict', phase: n, sha: head, verdict, reasons, ci,
    warnings: verdict === 'merge' ? review.warnings : [], justified,
  })
  return { verdict, reasons }
}

// ── merge ─────────────────────────────────────────────────────────────────────

export function merge({ n, slug = '', cwd = '.' }) {
  const ctx = context({ n, slug, cwd })
  if (!ctx.board.delegated.includes('phase-merge')) {
    refuse(EXIT.escalate, 'the board does not delegate phase-merge — the verdict stands, the human merges')
  }
  const head = tryGit(cwd, 'rev-parse', '--verify', `refs/heads/${ctx.phase}`)
  if (!head) refuse(EXIT.escalate, `no branch ${ctx.phase}`)
  const mine = ctx.journal.filter((e) => e.phase === n)
  const last = mine.at(-1)
  if (last?.kind === 'merged' && last.sha === head) refuse(EXIT.escalate, `${ctx.phase} at ${head.slice(0, 7)} is already merged`)
  const verdict = mine.filter((e) => e.kind === 'verdict').at(-1)
  if (!verdict) refuse(EXIT.escalate, `no verdict for phase ${n} — run \`just l4-judge ${n}\``)
  if (verdict.verdict !== 'merge') refuse(EXIT.escalate, `the last verdict for phase ${n} is ${verdict.verdict}, not merge`)
  if (verdict.sha !== head) {
    refuse(EXIT.escalate, `the merge verdict is for ${verdict.sha.slice(0, 7)}, ${ctx.phase} is now at ${head.slice(0, 7)} — judge it again`)
  }

  // The sha, not the branch name: a commit pushed between the check above and this line
  // would otherwise be merged without a verdict.
  const merged = spawnSync('git', ['merge', '--quiet', '--no-ff', '-m', `Merge ${ctx.phase} (l4 verdict at ${head.slice(0, 7)})`, head],
    { cwd, encoding: 'utf8' })
  if (merged.status !== 0) {
    spawnSync('git', ['merge', '--abort'], { cwd, stdio: 'ignore' })
    refuse(EXIT.escalate, `git merge failed (${(merged.stderr || merged.stdout).trim().split('\n')[0]}) — back to the phase's executor to rebase`)
  }
  record(ctx, { kind: 'merged', phase: n, sha: head, commit: git(cwd, 'rev-parse', 'HEAD') })
  const pushed = spawnSync('git', ['push', '--quiet', 'origin', ctx.integration], { cwd, encoding: 'utf8' })
  if (pushed.status !== 0) {
    refuse(EXIT.escalate, `merged and recorded locally, but the push failed (${pushed.stderr.trim().split('\n')[0]}) — push ${ctx.integration}`)
  }
  return { verdict: 'merged', reasons: [`${ctx.phase} at ${head.slice(0, 7)} merged into ${ctx.integration} and pushed`] }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main(argv) {
  const [verb, n, ...rest] = argv
  const opts = { n, slug: '', ci: '', justify: [] }
  for (let i = 0; i < rest.length; i++) {
    const [flag, value] = [rest[i], rest[i + 1]]
    if (!['--slug', '--ci', '--justify'].includes(flag) || value === undefined) {
      refuse(EXIT.usage, `unknown argument \`${flag}\` — usage: l4.mjs judge|merge <n> [--slug <s>] [--ci <cmd>] [--justify <pkg>=<text>]`)
    }
    if (flag === '--justify') opts.justify.push(value)
    else opts[flag.slice(2)] = value
    i++
  }
  if (verb === 'judge') return judge(opts)
  if (verb === 'merge') return merge(opts)
  return refuse(EXIT.usage, `unknown verb \`${verb ?? ''}\` — judge or merge`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { verdict, reasons } = main(process.argv.slice(2))
    console.log(`l4: ${verdict} — ${reasons.join('; ')}`)
    process.exit(verdict === 'merged' ? 0 : EXIT[verdict])
  } catch (err) {
    if (!(err instanceof Refusal)) throw err
    console.log(`l4: ${err.code === EXIT.usage ? 'error' : 'escalate'} — ${err.message}`)
    process.exit(err.code)
  }
}
