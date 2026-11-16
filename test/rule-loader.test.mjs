// The Codex rule loader answers "deny, inject or stay silent" on real hook payloads,
// so it gets black-box tests like the guards: a payload on stdin, the answer on stdout.
// Each test runs in its own repo fixture and its own TMPDIR, so session state never
// leaks between tests or onto the machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'
import { globToRe } from '../bin/glob.mjs'

const LOADER = join(REPO, 'kit', 'common', 'hooks', 'rule-loader.mjs')
const RUST = '.agents/rules/rust/code-style.md'
const LANG = '.agents/rules/common/language.md'

const put = (dir, path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text) }
const lockOf = rules => JSON.stringify({ agents: ['codex'], codex: { version: 1, files: {}, rules, blocks: [] } })
const RULES = [
  { path: LANG, profiles: [], title: 'Language', rawGlobs: [], globs: [] },
  { path: RUST, profiles: ['rust'], title: 'Rust Code Style', rawGlobs: ['**/*.rs'], globs: ['apps/api/**/*.rs'] },
]

// A repo with a module, its lock and its rule files, plus a private TMPDIR.
function fixture(fn, { rules = RULES, bodies = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'rule-loader-test-'))
  const repo = join(base, 'repo'), tmp = join(base, 'tmp')
  mkdirSync(tmp)
  put(repo, '.claude-rules.lock', typeof rules === 'string' ? rules : lockOf(rules))
  put(repo, LANG, '---\ntitle: Language\n---\n\nWrite in English.\n')
  put(repo, RUST, bodies[RUST] ?? '---\npaths:\n  - "apps/api/**/*.rs"\ntitle: Rust Code Style\n---\n\nNo unwrap in library code.\n')
  put(repo, 'apps/api/src/a.rs', 'fn main() {}\n')
  try { return fn({ repo, tmp, base }) } finally { rmSync(base, { recursive: true, force: true }) }
}

const run = (payload, tmp) => {
  const r = spawnSync(process.execPath, [LOADER], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
  })
  if (r.error) throw r.error
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', json: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null }
}
const envelope = (cwd, session = 's1') => ({ session_id: session, turn_id: 't1', transcript_path: null, cwd, hook_event_name: 'PreToolUse', model: 'm', permission_mode: 'default' })
const patch = (cwd, file, session) => ({ ...envelope(cwd, session), tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-fn main() {}\n+fn main() { }\n*** End Patch` } })
const bash = (cwd, command, session) => ({ ...envelope(cwd, session), tool_name: 'Bash', tool_input: { command } })
const start = (cwd, source, session = 's1') => ({ session_id: session, cwd, hook_event_name: 'SessionStart', source })

const silent = r => { assert.equal(r.status, 0, r.err); assert.equal(r.out, '', 'expected no answer') }
const refused = (r, why) => { silent(r); assert.match(r.err, why); assert.equal(r.err.trim().split('\n').length, 1, 'one stderr line') }
const denied = r => { assert.equal(r.status, 0, r.err); assert.equal(r.json.permissionDecision, 'deny'); assert.equal(r.json.hookEventName, 'PreToolUse'); return r.json.permissionDecisionReason }
const injected = r => { assert.equal(r.status, 0, r.err); assert.equal(r.json.permissionDecision, undefined); assert.equal(r.json.hookEventName, 'PreToolUse'); return r.json.additionalContext }

const tree = dir => readdirSync(dir).flatMap(n => statSync(join(dir, n)).isDirectory() ? tree(join(dir, n)).map(p => `${n}/${p}`) : [n]).sort()

test('a patch on a governed file is denied once with the rule, then passes', () => fixture(({ repo, tmp }) => {
  const before = tree(repo)
  const reason = denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  assert.match(reason, /No unwrap in library code/)
  assert.match(reason, /Rust Code Style/)
  assert.doesNotMatch(reason, /paths:/, 'frontmatter stripped')
  assert.doesNotMatch(reason, /Write in English/, 'a rule without globs stays in AGENTS.md')
  silent(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  assert.deepEqual(tree(repo), before, 'the loader never writes inside the repository')
  const [state] = readdirSync(tmp)
  if (process.getuid) assert.equal(statSync(join(tmp, state)).mode & 0o777, 0o700, 'the session state directory is private')
}))

test('a rule that cannot be read is not recorded as delivered', { skip: process.getuid?.() === 0 && 'root reads anything' }, () => fixture(({ repo, tmp }) => {
  chmodSync(join(repo, RUST), 0o000)
  const r = run(patch(repo, 'apps/api/src/a.rs'), tmp)
  chmodSync(join(repo, RUST), 0o644)
  silent(r)
  assert.match(r.err, /nothing loaded/)
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
}))

test('a state directory that is not private is not trusted: inject, never deny', { skip: !process.getuid && 'no POSIX ownership' }, () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  const [state] = readdirSync(tmp)
  chmodSync(join(tmp, state), 0o777)
  injected(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  chmodSync(join(tmp, state), 0o700)
  silent(run(patch(repo, 'apps/api/src/a.rs'), tmp))
}))

test('a Bash read injects the rule without blocking, and is not delivered twice', () => fixture(({ repo, tmp }) => {
  const ctx = injected(run(bash(repo, 'pwd; rg --files -g a.rs; cat apps/api/src/a.rs'), tmp))
  assert.match(ctx, /No unwrap in library code/)
  silent(run(bash(repo, 'cat apps/api/src/a.rs'), tmp))
  silent(run(patch(repo, 'apps/api/src/a.rs'), tmp), 'already delivered: the patch passes')
}))

test('Bash never denies and ignores commands that name no governed path', () => fixture(({ repo, tmp }) => {
  silent(run(bash(repo, 'ls -la && git status'), tmp))
  silent(run(bash(repo, 'cat README.md /etc/hosts ../outside.rs'), tmp))
  silent(run(patch(repo, 'README.md'), tmp))
}))

test('another session gets its own delivery', () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, 'apps/api/src/a.rs', 's1'), tmp))
  denied(run(patch(repo, 'apps/api/src/a.rs', 's2'), tmp))
}))

test('absolute and module-relative patch paths resolve against the repo root', () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, join(repo, 'apps/api/src/a.rs'), 'abs'), tmp))
  const api = join(repo, 'apps', 'api')
  denied(run(patch(api, 'src/a.rs', 'mod'), tmp))
  injected(run(bash(api, 'cat src/a.rs', 'mod-bash'), tmp))
  // Move to: the destination is governed even when the source is not.
  const move = { ...envelope(repo, 'move'), tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: notes.txt\n*** Move to: apps/api/src/b.rs\n*** End Patch' } }
  denied(run(move, tmp))
  const add = { ...envelope(repo, 'add'), tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: apps/api/src/c.rs\n+fn c() {}\n*** End Patch' } }
  denied(run(add, tmp))
}))

test('every refused state answers nothing, exits 0 and says why on one stderr line', () => {
  fixture(({ tmp }) => refused(run('not json', tmp), /unreadable payload/))
  fixture(({ base, tmp }) => { mkdirSync(join(base, 'bare')); refused(run(patch(join(base, 'bare'), 'a.rs'), tmp), /no \.claude-rules\.lock/) })
  fixture(({ repo, tmp }) => refused(run(patch(repo, 'apps/api/src/a.rs'), tmp), /no codex\.rules/), { rules: JSON.stringify({ agents: ['claude'] }) })
  fixture(({ repo, tmp }) => {
    rmSync(join(repo, RUST))
    refused(run(patch(repo, 'apps/api/src/a.rs'), tmp), /rule file missing on disk/)
  })
  fixture(({ repo, tmp }) => refused(run(patch(repo, '../elsewhere/a.rs'), tmp), /outside the repository root/))
  fixture(({ repo, tmp }) => refused(run(patch(repo, '/etc/a.rs'), tmp), /outside the repository root/))
})

test('an unwritable session state never denies: it injects', () => fixture(({ repo, base }) => {
  const blocked = join(base, 'not-a-dir')
  writeFileSync(blocked, '')
  const r = run(patch(repo, 'apps/api/src/a.rs'), blocked)
  assert.match(injected(r), /No unwrap in library code/)
  assert.match(r.err, /not writable/)
  injected(run(patch(repo, 'apps/api/src/a.rs'), blocked))
  const noSession = { ...patch(repo, 'apps/api/src/a.rs'), session_id: undefined }
  injected(run(noSession, base))
}))

test('an unparseable state file is treated as empty and rewritten', () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  const dir = join(tmp, readdirSync(tmp)[0])
  for (const f of readdirSync(dir)) writeFileSync(join(dir, f), '{broken')
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  silent(run(patch(repo, 'apps/api/src/a.rs'), tmp))
}))

test('beyond 6 KB the answer lists rule paths instead of bodies', () => {
  const big = `---\ntitle: Rust Code Style\n---\n\n${'x'.repeat(7 * 1024)}\n`
  fixture(({ repo, tmp }) => {
    const reason = denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
    assert.doesNotMatch(reason, /xxxx/)
    assert.match(reason, new RegExp(`- ${RUST.replace(/\./g, '\\.')}`))
    assert.match(reason, /Read these rules/)
  }, { bodies: { [RUST]: big } })
  fixture(({ repo, tmp }) => {
    assert.doesNotMatch(denied(run(patch(repo, 'apps/api/src/a.rs'), tmp)), /Read these rules/)
  })
})

test('SessionStart compact clears the session; other sources do not', () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  silent(run(start(repo, 'resume'), tmp))
  silent(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  silent(run(start(repo, 'compact'), tmp))
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
}))

test('a rule added to the lock mid-session is delivered on its next match', () => fixture(({ repo, tmp }) => {
  denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  put(repo, '.agents/rules/rust/logging.md', '---\ntitle: Rust Logging\n---\n\nUse tracing.\n')
  put(repo, '.claude-rules.lock', lockOf([...RULES, { path: '.agents/rules/rust/logging.md', profiles: ['rust'], title: 'Rust Logging', rawGlobs: ['**/*.rs'], globs: ['apps/api/**/*.rs'] }]))
  const reason = denied(run(patch(repo, 'apps/api/src/a.rs'), tmp))
  assert.match(reason, /Use tracing/)
  assert.doesNotMatch(reason, /No unwrap/, 'the delivered rule is not sent again')
}))

// The loader cannot import bin/ (the kit is copied into consuming repos), so it carries
// its own glob matcher. Parity is tested instead of shared: same table, both matchers.
const GLOBS = [
  ['apps/api/**/*.rs', ['apps/api/src/a.rs', 'apps/api/a.rs', 'apps/web/a.rs', 'apps/api/src/a.rsx']],
  ['**/*.{ts,tsx}', ['a.ts', 'src/deep/b.tsx', 'c.js', 'src/d.ts.map']],
  ['docs/**', ['docs/a.md', 'docs/x/y/z.md', 'doc/a.md']],
  ['**/docs/**/*.md', ['docs/a.md', 'apps/api/docs/b.md', 'apps/api/docs/b.txt']],
  ['src/?.rs', ['src/a.rs', 'src/ab.rs', 'src/x/a.rs']],
  ['*.json', ['a.json', 'x/a.json']],
  ['apps/web/**/*.test.ts', ['apps/web/a.test.ts', 'apps/web/src/a.ts']],
]
test('glob matching agrees with bin/glob.mjs on one table', () => {
  for (const [glob, paths] of GLOBS) {
    const rules = [{ path: RUST, profiles: [], title: 'Rule', rawGlobs: [glob], globs: [glob] }]
    for (const path of paths) fixture(({ repo, tmp }) => {
      const r = run(patch(repo, path, `${glob}|${path}`), tmp)
      assert.equal(r.status, 0, r.err)
      assert.equal(Boolean(r.out), globToRe(glob).test(path), `${glob} vs ${path}`)
    }, { rules })
  }
})
