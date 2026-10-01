#!/usr/bin/env node
// Skill evaluation against frozen fixtures; no Quill checkout access.
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { RUNNERS } from '../../runners.mjs'
import { observedReads, eventUsage, claudeInitMetadata } from '../metrics.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ADR_ROOT = dirname(ROOT)
const REPO = dirname(dirname(ADR_ROOT))
const SYNTHETIC_CASES = new Set(['search-option-a', 'search-option-b'])
const argv = process.argv.slice(2)
const opt = (flag, fallback) => { const i = argv.indexOf(flag); return i < 0 ? fallback : argv[i + 1] }
const runnerName = opt('--runner', 'codex')
const skill = opt('--skill', 'solution-exploration')
const topic = opt('--case', 'transport')
const revision = opt('--revision', 'current')
const binary = opt('--bin', null)
const model = opt('--model', null)
const timeout = Number(opt('--timeout', '240')) * 1000
const outDir = opt('--out', null) || mkdtempSync(join(tmpdir(), 'adr-skill-study-result-'))
const setupOnly = argv.includes('--setup-only')
if (!RUNNERS[runnerName]?.benchArgs || !['solution-exploration', 'adr-review'].includes(skill)
  || !['runtime', 'transport', ...SYNTHETIC_CASES].includes(topic)
  || (skill === 'adr-review' && SYNTHETIC_CASES.has(topic))
  || !['current', 'baseline'].includes(revision) || !Number.isFinite(timeout) || timeout <= 0) {
  console.error('usage: node eval/adr-bench/skill-study/run.mjs --runner claude|codex|opencode [--bin opencode2] --skill solution-exploration|adr-review [--case runtime|transport|search-option-a|search-option-b] [--revision current|baseline] [--model ID] [--timeout SECONDS] [--out DIR] [--setup-only]')
  process.exit(2)
}
const runner = RUNNERS[runnerName]
const runnerBin = binary || runner.bin
const ws = mkdtempSync(join(tmpdir(), 'adr-skill-study-'))
const paths = () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
  return walk(ws).map(p => relative(ws, p)).sort()
}
const hash = p => createHash('sha256').update(readFileSync(join(ws, p))).digest('hex')
const skillPath = join(runner.layout === 'claude' ? '.claude/skills' : '.agents/skills', skill, 'SKILL.md')
const skillSource = revision === 'current' ? join(REPO, 'skills', skill, 'SKILL.md')
  : join(ROOT, 'skills', skill, 'SKILL.md')
mkdirSync(dirname(join(ws, skillPath)), { recursive: true })
cpSync(skillSource, join(ws, skillPath))
const skillSha256 = hash(skillPath)

function reveal() {
  const baselineRuleDir = join(ROOT, 'rules', 'agent')
  const ruleSourceDir = revision === 'current' ? join(REPO, 'rules', 'agent') : baselineRuleDir
  for (const name of readdirSync(baselineRuleDir)) {
    const source = join(ruleSourceDir, name)
    if (!existsSync(source)) continue
    const target = join(ws, 'rules', 'agent', name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
  }
  if (SYNTHETIC_CASES.has(topic)) {
    cpSync(join(ROOT, 'cases', 'search-history', 'reveal'), ws, { recursive: true })
    return
  }
  cpSync(join(ADR_ROOT, 'snapshot'), ws, { recursive: true })
  cpSync(join(ADR_ROOT, 'fixtures', 'runtime'), ws, { recursive: true })
  cpSync(join(ADR_ROOT, 'fixtures', 'transport'), ws, { recursive: true })
}
const ruleProvenance = () => paths().filter(p => p.startsWith('rules/agent/'))
  .map(path => ({ path, sha256: hash(path) }))
function invoke(phase, prompt) {
  const before = Object.fromEntries(paths().map(p => [p, hash(p)]))
  const started = performance.now()
  const result = spawnSync(runnerBin, runner.benchArgs({ prompt, model }), {
    cwd: ws, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    timeout, maxBuffer: 64 * 1024 * 1024,
  })
  const raw = result.stdout || ''
  const events = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  const response = runnerName === 'codex'
    ? events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text || '').join('\n')
    : runnerName === 'opencode'
      ? events.filter(e => e.type === 'text').map(e => e.part?.text || '').join('\n')
      : events.filter(e => e.type === 'result').map(e => e.result || '').join('\n')
  const readPaths = observedReads(events, paths())
  const changed = paths().filter(p => before[p] !== hash(p))
  const report = {
    runner: runnerName, binary: runnerBin, modelRequested: model, skill, topic, phase, prompt,
    ...(runnerName === 'claude' ? claudeInitMetadata(events) : {}),
    skillRevision: revision, skillSha256,
    rulesRevision: revision, ruleFiles: ruleProvenance(),
    sourceCommit: SYNTHETIC_CASES.has(topic) ? null : '6ae2994dcf2dc040452e600cebf2d8718859b95b',
    durationMs: Math.round(performance.now() - started), exitCode: result.status,
    error: result.error?.message || null, observedReadPaths: readPaths,
    observedAdrReads: readPaths.filter(p => /docs\/adr\/\d{4}-/.test(p)),
    readMeasurement: 'paths inferred from visible tool events and shell globs; these are read attempts, not proof that every file was fully read',
    changedFixturePaths: changed, usage: eventUsage(events), response,
  }
  mkdirSync(outDir, { recursive: true })
  const label = `${runnerName}-${skill}-${topic}-${phase}`
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(outDir, `${label}.events.jsonl`), raw)
  writeFileSync(join(outDir, `${label}.stderr.txt`), result.stderr || '')
  console.log(`${label}: exit=${result.status} duration=${report.durationMs}ms ADRs=${report.observedAdrReads.length} changed=${changed.length} response=${response.length} chars`)
  if (result.status !== 0 || changed.length || !response.trim()) {
    console.log(`result: ${join(outDir, `${label}.json`)}`)
    process.exitCode = 1
  }
  return report
}

try {
  if (skill === 'solution-exploration') {
    const problem = SYNTHETIC_CASES.has(topic) ? join(ROOT, 'cases', topic, 'problem.md')
      : join(ROOT, `problem-${topic}.md`)
    cpSync(problem, join(ws, 'problem.md'))
    const firstPaths = paths()
    if (firstPaths.some(p => p.startsWith('docs/adr/') || p.includes('ARCHITECTURE.md'))) throw new Error('blind phase contains decision files')
    const firstPrompt = `Use the installed /solution-exploration skill: read ${skillPath} and problem.md. Perform ONLY pass 1 of the skill. ADRs and architecture decision records are absent from this workspace. Compare credible options, giving the contributor's proposal its strongest case; state criteria, risks and unknowns. End with a clearly labeled Provisional recommendation and the evidence that could change it. Do not ask to reveal ADRs yet and do not edit files.`
    const revealedContext = SYNTHETIC_CASES.has(topic)
      ? 'A synthetic decision history is now available.'
      : 'The frozen Quill decision corpus and source extracts are now available.'
    const secondPrompt = `Continue the installed /solution-exploration skill, pass 2 only. Read ${skillPath} and provisional.md, then use the newly available decision records and other evidence relevant to the proposal. ${revealedContext} Reconcile the provisional recommendation with decisions in force and current evidence; explain whether it changes, identify concrete code/docs/migration impacts and decisions a human would need to reopen. Give a sourced final recommendation without editing files or changing ADR status.`
    if (setupOnly) {
      reveal()
      console.log(JSON.stringify({ runner: runnerName, binary: runnerBin, skill, topic, revision, skillSha256,
        phase1Files: firstPaths, phase2Files: paths(), ruleFiles: ruleProvenance(), phase1Prompt: firstPrompt,
        phase2Prompt: secondPrompt }, null, 2))
    } else {
      const first = invoke('blind', firstPrompt)
      if (process.exitCode) throw new Error('blind phase failed; reconciliation was not run')
      if (first.observedAdrReads.length) throw new Error('blind phase read an ADR')
      writeFileSync(join(ws, 'provisional.md'), '# Provisional first-pass response\n\n' + first.response + '\n')
      reveal()
      invoke('reconcile', secondPrompt)
    }
  } else {
    reveal()
    const prompt = `Use the installed /adr-review skill: read ${skillPath}. Review the frozen docs/adr corpus and its index, using available source extracts and project decision rules where relevant. Identify active and historical decisions, dependencies, contradictions, stale guidance, and uncertain findings. Return a source-linked map and prioritized action table. Evaluate consolidation only where it would clarify a coherent decision; keep accepted statuses intact. Do not edit files.`
    if (setupOnly) console.log(JSON.stringify({ runner: runnerName, binary: runnerBin, skill, revision, skillSha256, files: paths(), ruleFiles: ruleProvenance(), prompt }, null, 2))
    else invoke('review', prompt)
  }
} finally { rmSync(ws, { recursive: true, force: true }) }
