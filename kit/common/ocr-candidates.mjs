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
const head = '=== OCR CANDIDATES ===\n\n'

/** The last lines of OCR's own log: why it failed, in its words. */
function tail(path, n = 5) {
  if (!path || !existsSync(path)) return ''
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
  return lines.slice(-n).map((l) => `    ${l}`).join('\n')
}

function notRun(why) {
  const log = tail(logPath)
  return `${head}OCR pass not run: ${why}.${log ? `\n\n${log}` : ''}\n`
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
  const comments = Array.isArray(out.comments) ? out.comments : []
  const rank = (c) => {
    const i = SEVERITY.indexOf(String(c.severity ?? '').toLowerCase())
    return i === -1 ? SEVERITY.length : i
  }
  const where = (c) => {
    if (!c.start_line) return `${c.path} (OCR could not place it)`
    return c.end_line && c.end_line !== c.start_line ? `${c.path}:${c.start_line}-${c.end_line}` : `${c.path}:${c.start_line}`
  }
  const model = out.llm?.model ? `, model ${out.llm.model}` : ''
  const lines = [
    `${comments.length} candidate(s) from OCR (status ${out.status ?? 'unknown'}${model}). Leads from another `
      + 'reviewer, not findings: confirm each against the code before you report it, in your own '
      + 'words and severity, or drop it.',
  ]
  for (const w of out.warnings ?? []) lines.push(`Warning from OCR: ${typeof w === 'string' ? w : JSON.stringify(w)}`)
  for (const c of [...comments].sort((a, b) => rank(a) - rank(b))) {
    const tag = [c.severity, c.category].filter(Boolean).join('/')
    const body = String(c.content ?? '').trim().replace(/\n/g, '\n  ')
    lines.push(`- [${tag || 'unrated'}] ${where(c)} — ${body}`)
  }
  return `${head}${lines.join('\n')}\n`
}

process.stdout.write(section())
