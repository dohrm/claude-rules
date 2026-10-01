import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'
import { observedReads, eventUsage, claudeInitMetadata } from '../eval/adr-bench/metrics.mjs'

const root = join(REPO, 'eval/adr-bench')
const read = name => readFileSync(join(root, name))
const manifest = JSON.parse(read('provenance.json'))
const scenarios = JSON.parse(read('scenarios.json'))

test('ADR bench snapshot is complete, pinned and self-contained', () => {
  assert.match(manifest.commit, /^[0-9a-f]{40}$/)
  const adrs = manifest.files.filter(f => /^snapshot\/docs\/adr\/\d{4}-/.test(f.snapshot))
  assert.deepEqual(adrs.map(f => f.snapshot.match(/\d{4}/)[0]),
    Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0')))
  for (const file of manifest.files) {
    assert.ok(existsSync(join(root, file.snapshot)), file.snapshot)
    assert.equal(createHash('sha256').update(read(file.snapshot)).digest('hex'), file.sha256, file.snapshot)
  }
  assert.ok(manifest.files.filter(f => f.exactCopy).length >= 18)
})

test('both architectural conflicts have current and alternative questions', () => {
  for (const name of ['runtime', 'transport']) {
    for (const task of ['current', 'alternative']) {
      assert.ok(scenarios[name][task].question)
      assert.ok(scenarios[name][task].evidence.length >= 3)
    }
  }
})

test('CLI probe invokes only the selected binary version command', () => {
  const result = spawnSync(process.execPath,
    [join(root, 'run.mjs'), '--runner', 'opencode', '--bin', process.execPath, '--probe-cli'],
    { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /opencode \(.+node\): v?\d+/)
})

test('event metrics distinguish completed reads from listings and started commands', () => {
  const paths = ['docs/adr/0001-a.md', 'docs/adr/0002-b.md', 'docs/adr/0015-c.md', 'docs/adr/README.md']
  const events = [
    { type: 'tool_use', part: { type: 'tool', tool: 'glob', state: { input: { pattern: 'docs/adr/*' } } } },
    { type: 'tool_use', part: { type: 'tool', tool: 'read', state: { input: { path: '/tmp/x/docs/adr/README.md' } } } },
    { type: 'item.completed', item: { type: 'command_execution', command: "rg -n foo --glob '!docs/adr/*.md' ." } },
    { type: 'item.started', item: { type: 'command_execution', command: 'cat docs/adr/0015-*.md' } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'cat docs/adr/000{1,2}-*.md docs/adr/0015-*.md' } },
    { type: 'step_finish', part: { tokens: { input: 4, output: 2 }, cost: 0 } },
  ]
  assert.deepEqual(observedReads(events, paths), paths)
  assert.deepEqual(eventUsage(events), [{ usage: { input: 4, output: 2 }, costUsd: 0 }])
})

test('Claude init metadata records the observed model and CLI version when present', () => {
  assert.deepEqual(claudeInitMetadata([
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5[1m]', claude_code_version: '2.1.283' },
  ]), { modelObserved: 'claude-opus-5-5[1m]', claudeCodeVersion: '2.1.283' })
  assert.deepEqual(claudeInitMetadata([]), { modelObserved: null, claudeCodeVersion: null })
})

test('solution exploration setup physically withholds ADRs until pass 2', () => {
  const result = spawnSync(process.execPath,
    [join(root, 'skill-study/run.mjs'), '--runner', 'codex', '--skill', 'solution-exploration', '--setup-only'],
    { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const setup = JSON.parse(result.stdout)
  assert.deepEqual(setup.phase1Files, ['.agents/skills/solution-exploration/SKILL.md', 'problem.md'])
  assert.equal(setup.phase2Files.filter(p => /^docs\/adr\/\d{4}-/.test(p)).length, 16)
})

test('skill snapshots have pinned content hashes', () => {
  const provenance = JSON.parse(read('skill-study/provenance.json'))
  for (const file of provenance.files) {
    const actual = createHash('sha256').update(read(`skill-study/${file.path}`)).digest('hex')
    assert.equal(actual, file.sha256, file.path)
  }
})

test('two neutral search fixtures distinguish a changed proposal from a repeated refusal', () => {
  const setups = ['search-option-a', 'search-option-b'].map(name => {
    const result = spawnSync(process.execPath,
      [join(root, 'skill-study/run.mjs'), '--runner', 'codex', '--skill', 'solution-exploration',
        '--case', name, '--setup-only'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  })
  for (const setup of setups) {
    assert.deepEqual(setup.phase1Files, ['.agents/skills/solution-exploration/SKILL.md', 'problem.md'])
    assert.deepEqual(setup.phase2Files.filter(p => /^docs\/adr\/\d{4}-/.test(p)),
      ['docs/adr/0001-local-lexical-search.md', 'docs/adr/0002-hosted-vector-search.md'])
    assert.doesNotMatch(setup.phase1Prompt + setup.phase2Prompt, /Qdrant|hosted|daemon|embedded|vector/i)
    assert.doesNotMatch(setup.phase2Prompt, /refus|reject/i)
    assert.ok(setup.phase2Files.every(p => !p.endsWith('expect.json')))
    assert.ok(setup.phase2Files.some(p => p === 'rules/agent/decisions.md'))
    assert.equal(setup.skillSha256,
      createHash('sha256').update(readFileSync(join(REPO, 'skills/solution-exploration/SKILL.md'))).digest('hex'))
  }

  const history = 'skill-study/cases/search-history/reveal/docs/adr/'
  const status = file => read(file).toString().match(/^\*\*(?:Status|Statut)\s*:\*\*\s*([^\s]+)/m)?.[1]
  assert.equal(status(history + '0001-local-lexical-search.md'), 'Accepté')
  assert.equal(status(history + '0002-hosted-vector-search.md'), 'Rejeté')
  assert.equal(status('snapshot/docs/adr/0010-rejected-technical-scope.md'), 'Accepté')

  const changed = read('skill-study/cases/search-option-a/problem.md').toString()
  const repeated = read('skill-study/cases/search-option-b/problem.md').toString()
  for (const brief of [changed, repeated]) {
    assert.doesNotMatch(brief, /\bADR\b|decision record|rejected|refused|Qdrant|daemon|historical/i)
  }
  assert.match(changed, /in-process semantic index.*without a separate service.*computed on the laptop/s)
  assert.match(repeated, /hosted search service/)
  assert.doesNotMatch(repeated, /offline|egress|must not leave|must remain|on-device|in-process/i)
  assert.doesNotMatch(changed, /hosted search service/)
})

test('current rule provenance differs from pinned baseline after reveal', () => {
  const runSetup = revision => {
    const result = spawnSync(process.execPath,
      [join(root, 'skill-study/run.mjs'), '--runner', 'codex', '--skill', 'adr-review',
        '--revision', revision, '--setup-only'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const current = runSetup('current')
  const baseline = runSetup('baseline')
  const file = 'rules/agent/decisions.md'
  const selected = setup => setup.ruleFiles.find(entry => entry.path === file)?.sha256
  assert.equal(selected(current), createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex'))
  assert.equal(selected(baseline), createHash('sha256').update(read(`skill-study/${file}`)).digest('hex'))
  assert.notEqual(selected(current), selected(baseline))
})

test('future corpus review prompt does not name the target discrepancies or consolidation answer', () => {
  const result = spawnSync(process.execPath,
    [join(root, 'skill-study/run.mjs'), '--runner', 'codex', '--skill', 'adr-review', '--setup-only'],
    { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const setup = JSON.parse(result.stdout)
  assert.doesNotMatch(setup.prompt, /Rig|genai|iroh|git remote|single consolidat/i)
  assert.equal(setup.files.filter(p => /^docs\/adr\/\d{4}-/.test(p)).length, 16)
})
