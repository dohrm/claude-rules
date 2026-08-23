// The eval harness is real code that normally only runs while spending tokens.
// A deterministic fake agent (test/fixtures/fake-agent.mjs) exercises it end to end
// for free — and, at the same time, proves the generic `--cmd` runner works, which
// is what any other CLI (a local model, a wrapper) goes through.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'

const RUN = join(REPO, 'eval', 'run.mjs')
const FAKE = join(REPO, 'test', 'fixtures', 'fake-agent.mjs')
const CASES = join(REPO, 'test', 'fixtures', 'eval-cases')

const run = (args) => {
  const r = spawnSync(process.execPath, [RUN, ...args], { cwd: REPO, encoding: 'utf8' })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const withFake = (extra = []) =>
  ['harness-smoke', '--cases', CASES, '--cmd', `node ${FAKE} {prompt}`, '--format', 'text', ...extra]

test('a custom --cmd runner runs a case end to end', () => {
  const r = run(withFake())
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /✓ PASS {2}harness-smoke/)
  assert.match(r.out, /runner: custom\(node\)/)
})

test('the assertions actually bite', () => {
  // The fake writes a TODO-only runbook when the prompt says BAD.
  const r = run(['harness-smoke-bad', '--cases', CASES, '--cmd', `node ${FAKE} {prompt}`, '--format', 'text'])
  assert.equal(r.status, 1)
  assert.match(r.out, /✗ FAIL {2}harness-smoke-bad/)
  assert.match(r.out, /should NOT match/)
})

test('the workspace is laid out where the runner reads it', () => {
  const claude = run([...withFake(), '--setup-only'])
  assert.match(claude.out, /\.claude\/\n {5}rules\/|\.claude\//, claude.out)
  assert.match(claude.out, /skills\/\n {7}runbook\/|runbook\//)

  // Same case, Cursor's layout: rules move to .agents/ and a pointer file appears.
  const cursor = run([...withFake(['--layout', 'agents']), '--setup-only'])
  assert.match(cursor.out, /AGENTS\.md/)
  assert.match(cursor.out, /\.agents\//)
  assert.doesNotMatch(cursor.out, /\.claude\//)
})

test('a runner that cannot drive a conversation skips, by name, instead of pretending', () => {
  const r = run(['runbook-commands', '--cmd', `node ${FAKE} {prompt}`, '--format', 'text'])
  assert.equal(r.status, 0, 'a skip is not a failure')
  assert.match(r.out, /⊘ SKIP {2}runbook-commands/)
  assert.match(r.out, /cannot be driven turn by turn/)
  assert.match(r.out, /1 skipped/)
})

test('--answers-inline folds the answers in, and says the questioning is untested', () => {
  const r = run(['runbook-commands', '--cmd', `node ${FAKE} {prompt}`, '--format', 'text', '--answers-inline'])
  assert.doesNotMatch(r.out, /⊘ SKIP/)
  assert.match(r.out, /questioning is NOT tested/)
})

test('an unknown runner names the ones that exist', () => {
  const r = run(['--runner', 'nope', '--setup-only'])
  assert.equal(r.status, 1)
  assert.match(r.out, /unknown runner "nope"/)
  assert.match(r.out, /claude/)
})

// Every preset is currently verified, so this asserts the mechanism from both sides:
// a verified runner must stay silent, and any entry that IS marked unverified must
// announce itself. Written this way so it keeps working as entries come and go.
test('the unverified warning fires for exactly the presets that carry the flag', async () => {
  const { RUNNERS } = await import(join(REPO, 'eval', 'runners.mjs'))
  const WARNING = /never been run against the real CLI/

  const verified = Object.keys(RUNNERS).filter(n => !RUNNERS[n].unverified)
  assert.ok(verified.length, 'no verified runner to check against')
  assert.doesNotMatch(run(['--runner', verified[0], '--setup-only']).out, WARNING,
    `${verified[0]} is verified — it must not warn`)

  for (const name of Object.keys(RUNNERS).filter(n => RUNNERS[n].unverified))
    assert.match(run(['--runner', name, '--setup-only']).out, WARNING,
      `${name} is marked unverified — it must say so before it is used`)
})

test('--setup-only builds every real case and spends nothing', () => {
  const r = run(['--setup-only'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /· SETUP architect-adr-budget → \/architect/)
  assert.match(r.out, /· SETUP reviewer-utf8 → code-reviewer/)
})
