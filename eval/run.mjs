#!/usr/bin/env node
// Regression harness for the perishable layer — the subagents and the skills.
// A new model can silently change how they behave; this catches it on a model bump
// instead of in the field.
//
// For each case: build a throwaway git workspace with the target asset + its rules +
// the fixture, invoke it headlessly (single-shot, or driven turn by turn from a
// scripted user), then assert. Assertions are deterministic on purpose — the model's
// prose varies, its OUTPUT SHAPE must not:
//   • regex over what it said, and over the files it wrote;
//   • and, best of all, the kit's own gates run against the artifacts. `/architect`
//     is judged by adr-check, `/prd` by docs-check. The gate we ship to
//     consumers is the oracle here — if it passes for them, it must pass for us.
//
// See eval/README.md. No dependency beyond Node + the `claude` CLI.
//
// Usage:
//   node eval/run.mjs                      # all cases, default runner (claude), default model
//   node eval/run.mjs --model <alias|id>   # re-run against a candidate model
//   node eval/run.mjs runbook-commands     # a single case (or several: a b c)
//   node eval/run.mjs --runner cursor      # Cursor's agent CLI (see eval/runners.mjs)
//   node eval/run.mjs --bin ./my-claude    # same preset, a different binary
//   node eval/run.mjs --cmd "agy run {prompt}" --format text   # any other command
//   node eval/run.mjs --answers-inline     # fold scripted answers into the prompt (non-streaming runners)
//   node eval/run.mjs --cases <dir>        # a different case directory
//   node eval/run.mjs --timeout 900        # per-case seconds (default 600)
//   node eval/run.mjs --keep               # keep the workspaces to inspect them
//   node eval/run.mjs --setup-only         # build the workspaces and stop (free: authoring a case)
//   node eval/run.mjs --judge              # (v2, not yet implemented — stubbed)
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { LAYOUTS, resolveRunner, unsupported } from './runners.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))   // claude-rules root

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback }
const VALUE_FLAGS = ['--model', '--timeout', '--runner', '--bin', '--cmd', '--layout', '--format', '--cases']
const model = flag('--model')
const timeoutMs = Number(flag('--timeout', '600')) * 1000
const judge = argv.includes('--judge')
const keep = argv.includes('--keep')
const setupOnly = argv.includes('--setup-only')   // spends no tokens: check a new case's fixtures
const answersInline = argv.includes('--answers-inline')
const CASES = flag('--cases') || join(REPO, 'eval', 'cases')
const values = new Set(VALUE_FLAGS.map(f => flag(f)).filter(Boolean))
const only = argv.filter(a => !a.startsWith('--') && !values.has(a))

const runner = resolveRunner({
  runner: flag('--runner'), bin: flag('--bin'), cmd: flag('--cmd'),
  layout: flag('--layout'), format: flag('--format'),
})
const layout = LAYOUTS[runner.layout]
if (!layout) { console.error(`unknown layout "${runner.layout}". Known: ${Object.keys(LAYOUTS).join(', ')}`); process.exit(2) }
if (runner.unverified)
  console.log(`note: the "${runner.name}" invocation has never been run against the real CLI.`
    + ` If it fails on a flag, fix the one line in eval/runners.mjs.\n`)

if (judge) console.log('note: --judge is stubbed (v2). Running deterministic checks only.\n')

// Which shared rules a case needs loaded (path-scoped ones fire on file read).
// Override per case with "rules": [...] in expect.json.
const DEFAULT_RULE_DIRS = ['common', 'agent', 'rust', 'hexagonal', 'testing']

// Default prompt per target. `{file}` is the case fixture, when there is one.
const PROMPTS = {
  'code-reviewer': 'You MUST use the code-reviewer subagent to review the file `{file}` in this directory. Return its full review verbatim, including the trailing CI_VERDICT and REVIEWED comment lines.',
  'code-simplifier': 'You MUST use the code-simplifier subagent to simplify the file `{file}` in this directory. It must edit the file in place, preserving behavior exactly. Return its report verbatim.',
}

// --------------------------------------------------------------------- workspace
const walkMd = (dir, base = '') => readdirSync(dir).flatMap(n =>
  statSync(join(dir, n)).isDirectory() ? walkMd(join(dir, n), join(base, n)) : (n.endsWith('.md') ? [join(base, n)] : []))

function setupWorkspace(caseDir, expect) {
  const ws = mkdtempSync(join(tmpdir(), 'cr-eval-'))

  // Assets where THIS runner reads them (eval/runners.mjs). Same destinations the
  // installer emits to, so a case exercises the assets as that agent actually sees them.
  const ruleDirs = expect.rules || DEFAULT_RULE_DIRS
  for (const d of ruleDirs) {
    const src = join(REPO, 'rules', d)
    if (!existsSync(src)) throw new Error(`case requests rules/${d}, which does not exist`)
    cpSync(src, join(ws, layout.rules, d), { recursive: true })
  }
  // Agents without per-file path scoping read one file; the workspace is throwaway,
  // so this is a plain generated pointer, not the installer's managed block.
  if (layout.agentsMd) {
    const refs = ruleDirs.flatMap(d => walkMd(join(REPO, 'rules', d))
      .map(f => `- read \`${join(layout.rules, d, f)}\` when working on files it applies to`))
    writeFileSync(join(ws, 'AGENTS.md'), `# Project rules\n\n${refs.join('\n')}\n`)
  }
  if (expect.agent) {
    if (!layout.agents) throw new Error(`${runner.name} has no place to install a subagent`)
    mkdirSync(join(ws, layout.agents), { recursive: true })
    cpSync(join(REPO, 'agents', `${expect.agent}.md`), join(ws, layout.agents, `${expect.agent}.md`))
  }
  if (expect.skill) {
    const src = join(REPO, 'skills', expect.skill)
    if (!existsSync(src)) throw new Error(`case targets skill "${expect.skill}", which does not exist`)
    cpSync(src, join(ws, layout.skills, expect.skill), { recursive: true })
  }

  // A shared fixture repo (eval/cases/_fixtures/<name>), then the case's own `files/`
  // tree over it (a justfile, docs/, manifests, an RFC…) — the repo the target reads.
  if (expect.fixture) {
    const shared = join(CASES, '_fixtures', expect.fixture)
    if (!existsSync(shared)) throw new Error(`case uses fixture "${expect.fixture}", which is not in _fixtures/`)
    cpSync(shared, ws, { recursive: true })
  }
  const filesDir = join(caseDir, 'files')
  if (existsSync(filesDir)) cpSync(filesDir, ws, { recursive: true })

  // A git baseline, so the workspace behaves like a real repo: the reviewer has a
  // diff to review, and adr-check has a HEAD to compare against. The branch is `main`
  // whatever the machine's init.defaultBranch, so a fixture RFC can name it. The
  // baseline's author, `eval`, is never the agent's: the workspace's own identity is
  // `eval-agent`, so a skill that checks who committed a line (`/rfc`'s `ready` guard)
  // sees a human's commit. `eval-baseline` tags it for the oracle's diffs.
  const git = (...args) => spawnSync('git', args, { cwd: ws, stdio: 'ignore' })
  git('init', '-q')
  git('symbolic-ref', 'HEAD', 'refs/heads/main')
  git('config', 'user.name', 'eval-agent')
  git('config', 'user.email', 'eval-agent@example.com')
  git('-c', 'user.email=eval@example.com', '-c', 'user.name=eval', 'commit', '-q', '--allow-empty', '-m', 'baseline')
  if (expect.fixture || existsSync(filesDir)) {
    git('add', '-A')
    git('-c', 'user.email=eval@example.com', '-c', 'user.name=eval', 'commit', '-q', '-m', 'fixture')
  }
  git('tag', 'eval-baseline')

  // The single-file fixture stays UNCOMMITTED: it is the working change under review.
  let file = null
  for (const f of readdirSync(caseDir)) {
    if (f.startsWith('input.')) { cpSync(join(caseDir, f), join(ws, f)); file = f }
  }
  if (expect.agent && !file) throw new Error('an agent case needs an input.* fixture')
  return { ws, file }
}

// ----------------------------------------------------------------------- invoking
function invokeOnce(ws, prompt) {
  const r = spawnSync(runner.bin, runner.args({ prompt, model, ws, streaming: false }), {
    cwd: ws, input: '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
  })
  if (r.error) throw new Error(`failed to spawn ${runner.bin}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${runner.bin} exited ${r.status}: ${(r.stderr || '').trim().slice(-1000)}`)
  return r.stdout || ''
}

// A scripted user, second flavour: no streaming stdin, but the CLI can resume its own
// last conversation (`--continue`). One invocation per turn, same session. Serial by
// construction — "the most recent conversation" is global state, and cases run one at
// a time.
function driveByResume(ws, prompt, answers) {
  let raw = invokeOnce(ws, prompt)
  let turns = 1
  for (const answer of answers) {
    const r = spawnSync(runner.bin, runner.resume({ answer, model, ws }), {
      cwd: ws, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
    })
    if (r.error) throw new Error(`failed to resume ${runner.bin}: ${r.error.message}`)
    raw += '\n' + (r.stdout || '')
    turns++
  }
  return { raw, turns, unanswered: 0 }
}

// A scripted user. A streaming runner keeps the session open on stdin, so an
// interactive skill (one question at a time) can be driven to the end: every time a
// turn completes, we send the next scripted answer; when the script runs out we close
// stdin, which ends the session after the turn in flight.
function driveConversation(ws, prompt, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(runner.bin, runner.args({ prompt, model, ws, streaming: true }),
      { cwd: ws, stdio: ['pipe', 'pipe', 'pipe'] })
    const queue = [...answers]
    let raw = '', buf = '', turns = 0, closed = false
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${timeoutMs / 1000}s`)) }, timeoutMs)

    const send = (text) => child.stdin.write(
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n')
    const endInput = () => { if (!closed) { closed = true; child.stdin.end() } }

    child.stdout.on('data', (chunk) => {
      raw += chunk
      buf += chunk
      const lineEnd = buf.lastIndexOf('\n')
      if (lineEnd < 0) return
      const lines = buf.slice(0, lineEnd).split('\n')
      buf = buf.slice(lineEnd + 1)
      for (const line of lines) {
        let obj; try { obj = JSON.parse(line) } catch { continue }
        // One `result` per completed turn: the agent is waiting on the user again.
        if (obj.type !== 'result') continue
        turns++
        if (queue.length) send(queue.shift())
        else endInput()
      }
    })
    child.stderr.on('data', () => {})
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`failed to spawn ${runner.bin}: ${e.message}`)) })
    child.on('close', () => { clearTimeout(timer); resolve({ raw, turns, unanswered: queue.length }) })

    send(prompt)
  })
}

// Collect every text fragment from the stream-json output, and note whether a
// subagent actually ran (a Task tool use / parent_tool_use_id appears). A plain-text
// runner has neither structure nor that signal: its stdout IS the answer.
function parseOutput(raw) {
  // A pretty-printing CLI mixes ANSI escapes into its output; strip them, or an
  // assertion anchored on a line start matches a colour code instead.
  if (runner.format === 'codex-json' || runner.format === 'opencode-json') {
    const lines = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
    const parts = lines.flatMap(event => {
      if (runner.format === 'codex-json' && event.type === 'item.completed'
          && event.item?.type === 'agent_message') return [event.item.text || '']
      if (runner.format === 'opencode-json' && event.type === 'text')
        return [event.part?.text || '']
      return []
    })
    return { text: parts.join('\n'), subagentRan: false }
  }
  if (runner.format !== 'stream-json')
    return { text: raw.replace(/\[[0-9;]*[A-Za-z]/g, ''), subagentRan: false }
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

// --------------------------------------------------------------------- assertions
// Supports a leading inline flag group like `(?i)`, which JS does not accept natively.
// `m` is always on: these patterns run over whole documents, so `^## Section` means
// "a heading line", never "the first line of the file".
function rx(pattern) {
  const m = pattern.match(/^\(\?([a-z]+)\)([\s\S]*)$/)
  const [body, flags] = m ? [m[2], m[1]] : [pattern, '']
  return new RegExp(body, flags.includes('m') ? flags : flags + 'm')
}

// Files matching a workspace-relative path, any segment of which may hold a `*` glob:
// `docs/runbook/*.md`, `.work/*/rfc.md`.
function resolveArtifact(ws, pattern) {
  let paths = ['']
  for (const seg of pattern.split('/')) {
    if (!seg.includes('*')) { paths = paths.map(p => join(p, seg)); continue }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    paths = paths.flatMap(p => {
      const dir = join(ws, p)
      return existsSync(dir) && statSync(dir).isDirectory()
        ? readdirSync(dir).filter(n => re.test(n)).map(n => join(p, n)) : []
    })
  }
  return paths.map(p => join(ws, p)).filter(f => existsSync(f) && statSync(f).isFile())
}

/** The kit gate we ship to consumers, run against what the skill just wrote. */
function runGate(ws, spec) {
  const [script, ...args] = spec.split(/\s+/)
  const r = spawnSync(process.execPath, [join(REPO, 'kit', 'common', script), ...args],
    { cwd: ws, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') }
}

function assertCase(ws, out, expect, fileText, fileBefore) {
  const fails = []
  for (const re of expect.stdout_matches || [])
    if (!rx(re).test(out)) fails.push(`expected to match /${re}/`)
  for (const re of expect.stdout_not_matches || [])
    if (rx(re).test(out)) fails.push(`should NOT match /${re}/`)

  // For an agent that edits code, the fixture is the truth; the report is a claim.
  if (fileText !== null) {
    for (const re of expect.file_matches || [])
      if (!rx(re).test(fileText)) fails.push(`fixture expected to match /${re}/ after the run`)
    for (const re of expect.file_not_matches || [])
      if (rx(re).test(fileText)) fails.push(`fixture should NOT match /${re}/ after the run`)
    if (expect.file_changed === true && fileText === fileBefore) fails.push('fixture was not modified')
    if (expect.file_changed === false && fileText !== fileBefore) fails.push('fixture was modified but should not have been')
  }

  // For a skill, the artifacts it wrote are the truth.
  for (const [pattern, rules] of Object.entries(expect.artifacts || {})) {
    const found = resolveArtifact(ws, pattern)
    if (!found.length) { fails.push(`no artifact at ${pattern}`); continue }
    const text = found.map(f => readFileSync(f, 'utf8')).join('\n')
    for (const re of rules.matches || [])
      if (!rx(re).test(text)) fails.push(`${pattern} expected to match /${re}/`)
    for (const re of rules.not_matches || [])
      if (rx(re).test(text)) fails.push(`${pattern} should NOT match /${re}/`)
    if (rules.max_words) {
      const w = text.split(/\s+/).filter(Boolean).length
      if (w > rules.max_words) fails.push(`${pattern}: ${w} words (max ${rules.max_words})`)
    }
  }

  // And the gates we ship are the strictest reviewer available.
  for (const spec of expect.gates || []) {
    const { ok, out: gateOut } = runGate(ws, spec)
    if (!ok) fails.push(`gate \`${spec}\` failed:\n     ${gateOut.trim().split('\n').join('\n     ')}`)
  }

  if (expect.ci_verdict_in) {
    const m = out.match(/CI_VERDICT:\s*([A-Z]+)/)
    const v = m ? m[1] : '(none)'
    if (!expect.ci_verdict_in.includes(v)) fails.push(`CI_VERDICT=${v}, expected one of ${expect.ci_verdict_in.join('|')}`)
  }
  return fails
}

// A shell command in the workspace. A `node --test` started under another test runner
// inherits its NODE_TEST_CONTEXT, skips every file and exits 0: when `npm test` drives
// this harness, every mutant would survive and every oracle command pass. The
// workspace's commands run as they would from a terminal.
function sh(ws, command) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(command, { cwd: ws, shell: true, encoding: 'utf8', env, timeout: timeoutMs })
  return { status: r.status ?? r.signal, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}

/** The oracle of an implementation case: what the agent built, judged without its word. */
function runOracle(ws, caseDir, oracle) {
  const fails = []
  const tail = (out) => out.split('\n').slice(-15).join('\n     ')
  const git = (...args) => spawnSync('git', args, { cwd: ws, encoding: 'utf8' })
  if (oracle.mutants?.length && !oracle.test) throw new Error('oracle.mutants needs oracle.test, the command they must fail')

  // Mutants first, under the workspace's own tests only: a mutant the hidden tests
  // kill says nothing about whether the agent's tests assert. A kill counts only
  // against a suite that passes unmutated — a broken test command fails every mutant.
  const baseline = oracle.mutants?.length ? sh(ws, oracle.test) : { status: 0 }
  if (baseline.status !== 0) {
    fails.push(`oracle test \`${oracle.test}\` exited ${baseline.status} before any mutant — no mutant judged:\n     ${tail(baseline.out)}`)
  }
  for (const rel of baseline.status === 0 ? oracle.mutants || [] : []) {
    const patch = resolve(caseDir, rel)   // git runs in the workspace
    const name = basename(rel).replace(/\.(patch|diff)$/, '')
    const applied = git('apply', patch)
    if (applied.status !== 0) {
      fails.push(`mutant ${name} does not apply — the oracle cannot judge it:\n     ${tail(applied.stderr)}`)
      continue
    }
    const r = sh(ws, oracle.test)
    if (git('apply', '-R', patch).status !== 0) throw new Error(`mutant ${name} could not be reverted`)
    if (r.status === 0) fails.push(`mutant ${name} survived: \`${oracle.test}\` exited 0 under it`)
  }

  if (oracle.files) cpSync(join(caseDir, oracle.files), ws, { recursive: true })
  for (const command of oracle.commands || []) {
    const r = sh(ws, command)
    if (r.status !== 0) fails.push(`oracle \`${command}\` exited ${r.status}:\n     ${tail(r.out)}`)
  }
  return fails
}

// --------------------------------------------------------------------------- run
const all = readdirSync(CASES).filter(n => existsSync(join(CASES, n, 'expect.json')))
const unknown = only.filter(n => !all.includes(n))
if (unknown.length) { console.error(`no such case: ${unknown.join(', ')}`); process.exit(2) }
const names = only.length ? all.filter(n => only.includes(n)) : all
if (!names.length) { console.error('no cases found'); process.exit(2) }

let failed = 0, skipped = 0
for (const name of names) {
  const caseDir = join(CASES, name)
  const expect = JSON.parse(readFileSync(join(caseDir, 'expect.json'), 'utf8'))
  // A case targets a skill or an agent; the agent harness predates skills, so it defaults.
  if (!expect.skill && !expect.agent) expect.agent = 'code-reviewer'
  const target = expect.skill ? `/${expect.skill}` : expect.agent

  // A runner that cannot do what the case needs is SKIPPED, loudly and by name.
  // Silently running a weaker version of the case would be worse than not running it.
  const cannot = answersInline && expect.answers?.length && !runner.drive
    ? unsupported({ ...runner, drive: "stdin" }, expect)   // the fold-in makes it single-shot
    : unsupported(runner, expect)
  if (cannot) { console.log(`⊘ SKIP  ${name} — ${cannot}`); skipped++; continue }

  let ws = null
  try {
    let file
    ;({ ws, file } = setupWorkspace(caseDir, expect))
    const before = file ? readFileSync(join(ws, file), 'utf8') : null

    const template = expect.prompt || PROMPTS[expect.agent]
    if (!template) throw new Error(`no prompt for "${target}" — set "prompt" in expect.json`)
    let prompt = template.replace('{file}', file || '')

    // Non-streaming runner + --answers-inline: hand over the answers up front instead
    // of turn by turn. It tests the OUTPUT, not the questioning — say so in the note.
    const foldIn = answersInline && expect.answers?.length && !runner.drive
    if (foldIn) {
      prompt += `\n\nAnswers to the questions you would otherwise ask, in order — use them`
        + ` and do not stop to ask:\n${expect.answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    }

    if (setupOnly) {
      const tree = (dir, pre = '') => readdirSync(dir).filter(n => n !== '.git').sort()
        .flatMap(n => statSync(join(dir, n)).isDirectory()
          ? [`${pre}${n}/`, ...tree(join(dir, n), pre + '  ')] : [`${pre}${n}`])
      console.log(`· SETUP ${name} → ${target}\n   ${tree(ws).join('\n   ')}\n   prompt: ${prompt.slice(0, 100)}…`)
      console.log(`   ${(expect.answers || []).length} scripted answer(s), gates: ${(expect.gates || []).join(', ') || 'none'}`)
      if (expect.oracle) console.log(`   oracle: ${(expect.oracle.commands || []).length} command(s),`
        + ` ${(expect.oracle.mutants || []).length} mutant(s)${expect.oracle.files ? `, files from ${expect.oracle.files}/` : ''}`)
      continue
    }

    let raw, note = ''
    if (expect.answers?.length && !foldIn) {
      const r = runner.drive === 'resume'
        ? driveByResume(ws, prompt, expect.answers)
        : await driveConversation(ws, prompt, expect.answers)
      raw = r.raw
      note = ` (${r.turns} turns${r.unanswered ? `, ${r.unanswered} scripted answers unused` : ''})`
      // Unused answers mean the skill stopped asking early — worth seeing, not a failure.
    } else {
      raw = invokeOnce(ws, prompt)
      if (foldIn) note = ' (answers folded into the prompt — the questioning is NOT tested)'
    }

    const { text, subagentRan } = parseOutput(raw)
    if (expect.agent && !subagentRan) {
      console.log(`⚠ ERROR ${name}: the ${expect.agent} subagent was not invoked (non-deterministic delegation)`)
      failed++; continue
    }
    const after = file ? readFileSync(join(ws, file), 'utf8') : null
    const fails = assertCase(ws, text, expect, after, before)
    // Last: it patches the workspace and copies hidden files into it.
    if (expect.oracle) fails.push(...runOracle(ws, caseDir, expect.oracle))
    if (fails.length) { console.log(`✗ FAIL  ${name}${note}\n   - ${fails.join('\n   - ')}`); failed++ }
    else console.log(`✓ PASS  ${name}${note}`)
    if (judge && expect.judge) console.log(`   judge (skipped): ${expect.judge}`)
    if (keep) console.log(`   workspace: ${ws}`)
  } catch (e) {
    console.log(`⚠ ERROR ${name}: ${e.message}`)
    failed++
  } finally {
    if (ws && !keep) rmSync(ws, { recursive: true, force: true })
  }
}

const ran = names.length - skipped
console.log(`\n${ran - failed}/${ran} passed${skipped ? `, ${skipped} skipped` : ''}`
  + ` (runner: ${runner.name}${model ? `, model: ${model}` : ''})`)
process.exit(failed ? 1 : 0)
