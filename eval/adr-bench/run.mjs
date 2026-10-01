#!/usr/bin/env node
// Paired, read-only ADR reading experiment. No Quill checkout is consulted at runtime.
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { RUNNERS } from '../runners.mjs'
import { observedReads, eventUsage } from './metrics.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
const runnerName = opt('--runner', 'codex')
const binary = opt('--bin', null)
const topic = opt('--case', 'runtime')
const task = opt('--task', 'current')
const mode = opt('--mode', 'index')
const model = opt('--model', null)
const seconds = Number(opt('--timeout', '180'))
const outputDir = opt('--out', null)
const setupOnly = args.includes('--setup-only')
const probeCli = args.includes('--probe-cli')
if (!['runtime', 'transport'].includes(topic) || !['current', 'alternative'].includes(task)
    || !['full', 'index'].includes(mode) || !RUNNERS[runnerName]?.benchArgs
    || !Number.isFinite(seconds) || seconds <= 0) {
  console.error('usage: node eval/adr-bench/run.mjs --runner claude|codex|opencode [--bin PATH] --case runtime|transport --task current|alternative --mode full|index [--model ID] [--out DIR] [--setup-only|--probe-cli]')
  process.exit(2)
}
const runner = RUNNERS[runnerName]
const runnerBin = binary || runner.bin
if (probeCli) {
  // This checks the executable only. It does not build a fixture or invoke a model.
  const dataHome = mkdtempSync(join(tmpdir(), 'adr-bench-cli-data-'))
  try {
    const result = spawnSync(runnerBin, ['--version'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    })
    if (result.error || result.status !== 0) {
      console.error(result.error?.message || result.stderr || `exit ${result.status}`)
      process.exitCode = 1
    } else console.log(`${runnerName} (${runnerBin}): ${(result.stdout || result.stderr).trim()}`)
  } finally { rmSync(dataHome, { recursive: true, force: true }) }
  process.exit(process.exitCode || 0)
}
const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios.json'), 'utf8'))[topic][task]
const workspace = mkdtempSync(join(tmpdir(), 'adr-bench-'))
const hash = data => createHash('sha256').update(data).digest('hex')
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = join(dir, e.name)
  return e.isDirectory() ? files(p) : [p]
})
try {
  cpSync(join(ROOT, 'snapshot'), workspace, { recursive: true })
  cpSync(join(ROOT, 'fixtures', topic), workspace, { recursive: true })
  const paths = files(workspace).map(p => relative(workspace, p)).sort()
  const before = Object.fromEntries(paths.map(p => [p, hash(readFileSync(join(workspace, p)))]))
  const protocol = mode === 'full'
    ? 'Read every ADR-0001 through ADR-0016 in docs/adr before answering. Use the index as well.'
    : 'Start with docs/adr/README.md. Open only the ADRs needed for this question, following supersedes/references links where relevant.'
  const prompt = `You are reviewing a frozen Quill architecture snapshot. Work only in this fixture directory. Do not edit files. ${protocol}\n\n${scenario.question}\n\nUse these headings: Decision in force; Evidence and supersession; Alternative assessment; Impacts; Uncertainties. Cite fixture paths and ADR numbers. Distinguish what the ADR decides from stale instructions or documentation. Do not treat accepted ADR status as yours to change.`
  if (setupOnly) {
    console.log(JSON.stringify({ runner: runnerName, binary: runnerBin, topic, task, mode, workspace, files: paths, prompt }, null, 2))
    // Keep the workspace so the generated fixture can be inspected.
    process.exit(0)
  }
  const invocation = runner.benchArgs
    ? runner.benchArgs({ prompt, model })
    : runner.args({ prompt, model, streaming: false })
  const started = performance.now()
  const result = spawnSync(runnerBin, invocation, {
    cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    timeout: seconds * 1000, maxBuffer: 64 * 1024 * 1024,
  })
  const durationMs = Math.round(performance.now() - started)
  const raw = result.stdout || ''
  const events = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  const response = runnerName === 'codex'
    ? events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text || '').join('\n')
    : runnerName === 'opencode'
      ? events.filter(e => e.type === 'text').map(e => e.part?.text || '').join('\n')
      : events.filter(e => e.type === 'result').map(e => e.result || '').join('\n')
  const reads = observedReads(events, paths)
  const afterPaths = files(workspace).map(p => relative(workspace, p)).sort()
  const changed = afterPaths.filter(p => !before[p] || before[p] !== hash(readFileSync(join(workspace, p))))
  const usage = eventUsage(events)
  const report = {
    runner: runnerName, binary: runnerBin, model, topic, task, mode, sourceCommit: '6ae2994dcf2dc040452e600cebf2d8718859b95b',
    question: scenario.question, expectedEvidence: scenario.evidence, durationMs,
    exitCode: result.status, error: result.error?.message || null,
    observedReadPaths: reads, observedAdrReads: reads.filter(p => /docs\/adr\/\d{4}-/.test(p)),
    readMeasurement: 'best effort from visible CLI tool events; may undercount',
    usage, changedFixturePaths: changed, response,
  }
  const destination = outputDir || mkdtempSync(join(tmpdir(), 'adr-bench-result-'))
  mkdirSync(destination, { recursive: true })
  const label = `${runnerName}-${topic}-${task}-${mode}`
  writeFileSync(join(destination, `${label}.json`), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(destination, `${label}.events.jsonl`), raw)
  writeFileSync(join(destination, `${label}.stderr.txt`), result.stderr || '')
  console.log(`${label}: exit=${result.status} duration=${durationMs}ms reads=${reads.length} ADRs=${report.observedAdrReads.length} changed=${changed.length}`)
  console.log(`result: ${join(destination, `${label}.json`)}`)
  if (result.status !== 0 || changed.length) process.exitCode = 1
} finally {
  if (!setupOnly) rmSync(workspace, { recursive: true, force: true })
}
