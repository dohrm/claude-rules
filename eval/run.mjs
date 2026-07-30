#!/usr/bin/env node
// Agent regression harness — detects rot in the shared subagents when the model
// changes. For each case: build a throwaway workspace with the target agent +
// rules + the fixture, invoke it headlessly, assert on its output (and, for
// agents that edit code, on the resulting file).
// See eval/README.md. No dependency beyond Node + the `claude` CLI.
//
// Usage:
//   node eval/run.mjs                      # all cases, default model
//   node eval/run.mjs --model <alias|id>   # re-run against a candidate model
//   node eval/run.mjs reviewer-utf8        # a single case
//   node eval/run.mjs --judge              # (v2, not yet implemented — stubbed)
import { mkdtempSync, mkdirSync, cpSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))   // claude-rules root
const CASES = join(REPO, 'eval', 'cases')

const argv = process.argv.slice(2)
const model = (() => { const i = argv.indexOf('--model'); return i >= 0 ? argv[i + 1] : null })()
const judge = argv.includes('--judge')
const only = argv.find(a => !a.startsWith('--') && a !== model)

if (judge) console.log('note: --judge is stubbed (v2). Running deterministic checks only.\n')

// Which shared rules a case needs loaded (path-scoped ones fire on file read).
// Override per case with "rules": [...] in expect.json.
const DEFAULT_RULE_DIRS = ['common', 'agent', 'rust', 'hexagonal', 'testing']

// Per-agent default prompt. `{file}` is the case fixture.
const PROMPTS = {
  'code-reviewer': 'You MUST use the code-reviewer subagent to review the file `{file}` in this directory. Return its full review verbatim, including the trailing CI_VERDICT comment line.',
  'code-simplifier': 'You MUST use the code-simplifier subagent to simplify the file `{file}` in this directory. It must edit the file in place, preserving behavior exactly. Return its report verbatim.',
}

function setupWorkspace(caseDir, expect) {
  const ws = mkdtempSync(join(tmpdir(), 'cr-eval-'))
  mkdirSync(join(ws, '.claude', 'agents'), { recursive: true })
  const agent = expect.agent || 'code-reviewer'
  cpSync(join(REPO, 'agents', `${agent}.md`), join(ws, '.claude', 'agents', `${agent}.md`))
  for (const d of expect.rules || DEFAULT_RULE_DIRS) {
    const src = join(REPO, 'rules', d)
    if (existsSync(src)) cpSync(src, join(ws, '.claude', 'rules', d), { recursive: true })
    else throw new Error(`case requests rules/${d}, which does not exist`)
  }
  let file = null
  for (const f of readdirSync(caseDir)) {
    if (f.startsWith('input.')) { cpSync(join(caseDir, f), join(ws, f)); file = f }
  }
  if (!file) throw new Error('no input.* fixture in the case directory')
  return { ws, file }
}

function invokeAgent(ws, expect, file) {
  const agent = expect.agent || 'code-reviewer'
  const template = expect.prompt || PROMPTS[agent]
  if (!template) throw new Error(`no default prompt for agent "${agent}" — set "prompt" in expect.json`)
  const prompt = template.replace('{file}', file)
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
                '--forward-subagent-text', '--dangerously-skip-permissions']
  if (model) args.push('--model', model)
  const r = spawnSync('claude', args, { cwd: ws, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`failed to spawn claude: ${r.error.message}`)
  return r.stdout || ''
}

// Collect every text fragment from the stream-json output, and note whether a
// subagent actually ran (a Task tool use / parent_tool_use_id appears).
function parseOutput(raw) {
  let text = '', subagentRan = false
  for (const line of raw.split('\n')) {
    const s = line.trim(); if (!s) continue
    let obj; try { obj = JSON.parse(s) } catch { continue }
    if (obj.parent_tool_use_id) subagentRan = true
    const pull = (v) => {
      if (typeof v === 'string') text += v + '\n'
      else if (Array.isArray(v)) v.forEach(pull)
      else if (v && typeof v === 'object') {
        if (v.type === 'tool_use' && v.name === 'Task') subagentRan = true
        if (typeof v.text === 'string') text += v.text + '\n'
        if (typeof v.result === 'string') text += v.result + '\n'
        if (v.content) pull(v.content)
        if (v.message) pull(v.message)
      }
    }
    pull(obj)
  }
  return { text, subagentRan }
}

// Build a RegExp, supporting a leading inline flag group like `(?i)` (PCRE/Python
// style) which JS does not accept natively — convert it to the flags argument.
function rx(pattern) {
  const m = pattern.match(/^\(\?([a-z]+)\)([\s\S]*)$/)
  return m ? new RegExp(m[2], m[1]) : new RegExp(pattern)
}

function assertCase(out, expect, fileText, fileBefore) {
  const fails = []
  for (const re of expect.stdout_matches || [])
    if (!rx(re).test(out)) fails.push(`expected to match /${re}/`)
  for (const re of expect.stdout_not_matches || [])
    if (rx(re).test(out)) fails.push(`should NOT match /${re}/`)
  // For agents that edit code (code-simplifier), the resulting file is the real
  // assertion surface — the report is only what the agent claims it did.
  for (const re of expect.file_matches || [])
    if (!rx(re).test(fileText)) fails.push(`fixture expected to match /${re}/ after the run`)
  for (const re of expect.file_not_matches || [])
    if (rx(re).test(fileText)) fails.push(`fixture should NOT match /${re}/ after the run`)
  if (expect.file_changed === true && fileText === fileBefore) fails.push('fixture was not modified')
  if (expect.file_changed === false && fileText !== fileBefore) fails.push('fixture was modified but should not have been')
  if (expect.ci_verdict_in) {
    const m = out.match(/CI_VERDICT:\s*([A-Z]+)/)
    const v = m ? m[1] : '(none)'
    if (!expect.ci_verdict_in.includes(v)) fails.push(`CI_VERDICT=${v}, expected one of ${expect.ci_verdict_in.join('|')}`)
  }
  return fails
}

const names = readdirSync(CASES).filter(n => existsSync(join(CASES, n, 'expect.json')))
                                .filter(n => !only || n === only)
if (!names.length) { console.error(only ? `no such case: ${only}` : 'no cases found'); process.exit(2) }

let failed = 0
for (const name of names) {
  const caseDir = join(CASES, name)
  const expect = JSON.parse(readFileSync(join(caseDir, 'expect.json'), 'utf8'))
  let ws = null
  try {
    let file
    ;({ ws, file } = setupWorkspace(caseDir, expect))
    const before = readFileSync(join(ws, file), 'utf8')
    const { text, subagentRan } = parseOutput(invokeAgent(ws, expect, file))
    if (!subagentRan) { console.log(`⚠ ERROR ${name}: ${expect.agent || 'code-reviewer'} subagent was not invoked (non-deterministic delegation)`); failed++; continue }
    const fails = assertCase(text, expect, readFileSync(join(ws, file), 'utf8'), before)
    if (fails.length) { console.log(`✗ FAIL  ${name}\n   - ${fails.join('\n   - ')}`); failed++ }
    else console.log(`✓ PASS  ${name}`)
    if (judge && expect.judge) console.log(`   judge (skipped): ${expect.judge}`)
  } catch (e) {
    console.log(`⚠ ERROR ${name}: ${e.message}`); failed++
  } finally {
    if (ws) rmSync(ws, { recursive: true, force: true })
  }
}

console.log(`\n${names.length - failed}/${names.length} passed${model ? ` (model: ${model})` : ''}`)
process.exit(failed ? 1 : 0)
