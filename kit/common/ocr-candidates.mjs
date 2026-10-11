#!/usr/bin/env node

// The `=== OCR CANDIDATES ===` section of a review prompt: what an Open Code Review pass
// (alibaba/open-code-review) found on the same diff, handed to OUR reviewer as leads.
//
// OCR is the opposite trade-off to ours: a deterministic pipeline (file grouping, one
// sub-agent per group, comment re-location, a fact-check filter) tuned for precision,
// where our reviewer is one strict pass that also judges ADRs, experience contracts and
// AI slop. Its findings never become ours by being printed here: the reviewer confirms
// each against the code or drops it, and stays the only verdict.
//
// It never blocks either. OCR is opt-in, needs its own LLM provider, and can fail for a
// dozen reasons (no key, rate limit, network): every failure is declared in the section —
// "OCR pass not run: …" — and the review goes on without it.
//
//   node ocr-candidates.mjs <ocr.json> <ocr exit code> <ocr log>

import { existsSync, readFileSync } from 'node:fs'

const [jsonPath, code = '', logPath = ''] = process.argv.slice(2)
const SEVERITY = ['critical', 'high', 'medium', 'low']
// Most severe first, then cut: the section counts toward `review_max_bytes`, and OCR must
// never be what makes a review too large to run.
const MAX_CANDIDATES = 40
const head = '=== OCR CANDIDATES ===\n\n'
const end = '=== END OCR CANDIDATES ===\n'
// OCR's text is another model's output about a diff that may be hostile: one line per
// candidate, continuation lines indented, so nothing in it can pose as a section marker.
const flat = (text) => String(text ?? '').trim().replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')

/** The last lines of OCR's own log: why it failed, in its words. */
function tail(path, n = 5) {
  if (!path || !existsSync(path)) return ''
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
  return lines.slice(-n).map((l) => `    ${l}`).join('\n')
}

function notRun(why) {
  const log = tail(logPath)
  return `${head}OCR pass not run: ${why}.${log ? `\n\n${log}` : ''}\n${end}`
}

function section() {
  if (code !== '0') return notRun(`exit ${code || '(none)'}`)
  if (!jsonPath || !existsSync(jsonPath)) return notRun(`no ${jsonPath || 'output file'}`)
  let out
  try {
    out = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    return notRun(`unreadable output (${err.message})`)
  }
  if (out === null || typeof out !== 'object') return notRun('output is not an object')
  const comments = (Array.isArray(out.comments) ? out.comments : []).filter((c) => c && typeof c === 'object')
  const rank = (c) => {
    const i = SEVERITY.indexOf(String(c.severity ?? '').toLowerCase())
    return i === -1 ? SEVERITY.length : i
  }
  const where = (c) => {
    const path = flat(c.path) || '(no path)'
    if (!c.start_line) return `${path} (OCR could not place it)`
    return c.end_line && c.end_line !== c.start_line ? `${path}:${c.start_line}-${c.end_line}` : `${path}:${c.start_line}`
  }
  const model = out.llm?.model ? `, model ${flat(out.llm.model)}` : ''
  const lines = [
    `${comments.length} candidate(s) from OCR (status ${flat(out.status) || 'unknown'}${model}). Leads from another `
      + 'reviewer, not findings: confirm each against the code before you report it, in your own '
      + 'words and severity, or drop it.',
  ]
  if (out.message) lines.push(`OCR says: ${flat(out.message)}`)
  for (const w of Array.isArray(out.warnings) ? out.warnings : [])
    lines.push(`Warning from OCR: ${flat(typeof w === 'string' ? w : JSON.stringify(w))}`)
  const kept = [...comments].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_CANDIDATES)
  for (const c of kept) {
    const tag = [c.severity, c.category].filter(Boolean).map(flat).join('/')
    lines.push(`- [${tag || 'unrated'}] ${where(c)} — ${flat(c.content)}`)
  }
  if (comments.length > kept.length) lines.push(`(${comments.length - kept.length} less severe candidate(s) omitted)`)
  return `${head}${lines.join('\n')}\n${end}`
}

// Never the reason a review does not run: any surprise in OCR's output is declared.
let text
try {
  text = section()
} catch (err) {
  text = notRun(`unusable output (${err.message})`)
}
process.stdout.write(text)
