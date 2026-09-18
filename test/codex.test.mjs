import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, runCli, runCliBare, withTmpRepo, read, has } from './helpers.mjs'
const ok = r => { assert.equal(r.status, 0, r.stderr + r.stdout); return r }
const lock = dir => JSON.parse(read(dir, '.claude-rules.lock'))
const put = (dir, path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text) }
const start = '<!-- claude-rules:start (managed — do not edit inside this block) -->'
const end = '<!-- claude-rules:end -->'

test('Codex modules resolve alias assets and root guidance without Claude', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust-api', '--root', 'apps/api', '--agent', 'codex'], dir))
  ok(runCli(['add', 'ts-web-app', '--root', 'apps/web'], dir))
  ok(runCli(['add', 'agent', 'product'], dir))
  const installed = lock(dir)
  assert.deepEqual(installed.modules['.'], ['agent', 'product'])
  assert.deepEqual(installed.modules['apps/api'], ['rust', 'hexagonal', 'api', 'backend'])
  assert.ok(!has(dir, '.claude'))
  const root = read(dir, 'AGENTS.md'), api = read(dir, 'apps/api/AGENTS.md'), web = read(dir, 'apps/web/AGENTS.md')
  assert.match(root, /apps\/api\/AGENTS.md/)
  assert.match(root, /AGENTS.override.md/)
  assert.match(api, /\.\.\/\.\.\/\.agents\/rules\/rust\/code-style.md/)
  assert.doesNotMatch(api, /portal-http/)
  assert.doesNotMatch(web, /rules\/rust/)
  assert.ok(has(dir, '.agents/skills/architect/SKILL.md'))
  assert.ok(!has(dir, '.agents/rules/api/go.md'))
  const before = read(dir, '.claude-rules.lock')
  ok(runCli(['update'], dir))
  assert.equal(read(dir, '.claude-rules.lock'), before)
}))

test('each target and combined targets remain usable with identical skills', () => {
  for (const agents of ['claude', 'codex', 'cursor', 'claude,codex,cursor']) withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', 'product', '--agent', agents, '--level', 'gates'], dir))
    assert.ok(has(dir, '.dev/kit/common/gate.just'))
    if (agents.includes('claude')) assert.equal(read(dir, '.claude/skills/architect/SKILL.md'), read(REPO, 'skills/architect/SKILL.md'))
    if (agents.includes('codex') || agents.includes('cursor')) assert.equal(read(dir, '.agents/skills/architect/SKILL.md'), read(REPO, 'skills/architect/SKILL.md'))
    if (agents === 'codex') { ok(runCliBare(['init'], dir)); assert.ok(!has(dir, 'CLAUDE.md')) }
  })
})

test('existing targets stay locked until Codex is explicitly added', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'claude,cursor'], dir))
  ok(runCli(['update'], dir))
  ok(runCli(['add', 'rust'], dir))
  assert.deepEqual(lock(dir).agents, ['claude', 'cursor'])
  assert.ok(!has(dir, 'AGENTS.md'))
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  assert.deepEqual(lock(dir).agents, ['claude', 'cursor', 'codex'])
}))

test('legacy locks and alias memberships normalize without changing scope', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust-api', 'product', '--agent', 'claude'], dir))
  const before = read(dir, '.claude/rules/rust/code-style.md'), old = lock(dir)
  delete old.modules
  old.profiles = ['rust-api', 'product']; old.levels = { 'rust-api': 'rules', product: 'rules' }
  put(dir, '.claude-rules.lock', JSON.stringify(old))
  ok(runCli(['update'], dir))
  assert.equal(read(dir, '.claude/rules/rust/code-style.md'), before)
  assert.deepEqual(lock(dir).modules['.'], ['rust', 'hexagonal', 'api', 'backend', 'product'])
  ok(runCli(['add', 'rust-api', '--root', 'apps/api'], dir))
  assert.deepEqual(lock(dir).modules['.'], ['product'])
  assert.doesNotMatch(read(dir, '.claude/rules/rust/code-style.md'), /"\.\//)
}))

test('root bindings do not widen existing scoped profiles', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--root', 'apps/api', '--agent', 'codex'], dir))
  ok(runCli(['add', 'rust'], dir))
  const before = read(dir, '.claude-rules.lock')
  const r = runCli(['add', 'rust', '--root', '.'], dir)
  assert.equal(r.status, 1); assert.match(r.stderr, /Conflicting root/)
  assert.equal(read(dir, '.claude-rules.lock'), before)
}))

test('shared React and document rules remain reachable from appropriate entries', () => withTmpRepo(dir => {
  ok(runCli(['add', 'react', 'ts', '--root', 'apps/web', '--agent', 'codex'], dir))
  ok(runCli(['add', 'react', '--root', 'apps/mobile'], dir))
  ok(runCli(['add', 'ops', '--root', 'deploy'], dir))
  assert.match(read(dir, 'apps/web/AGENTS.md'), /apps\/web\/\*\*\/\*\.tsx/)
  assert.doesNotMatch(read(dir, 'apps/web/AGENTS.md'), /apps\/mobile\/\*\*/)
  assert.match(read(dir, 'apps/mobile/AGENTS.md'), /rules\/react/)
  assert.match(read(dir, 'AGENTS.md'), /rules\/ops\/slo.md/)
  assert.doesNotMatch(read(dir, '.agents/rules/ops/slo.md'), /deploy\/\*\*\/docs/)
}))

test('update and removal preserve exact outside text and unknown files', () => withTmpRepo(dir => {
  const before = '<!-- pane-agent-context:start -->\nPersonal guidance.\n<!-- pane-agent-context:end -->\n\n'
  const after = '\n\n## Local\nKeep this verbatim.\n'
  put(dir, 'apps/api/AGENTS.md', before + start + '\nlegacy\n' + end + after)
  ok(runCli(['add', 'rust', '--root', 'apps/api', '--agent', 'codex'], dir))
  put(dir, '.agents/rules/rust/local.md', 'mine')
  ok(runCli(['update'], dir))
  const text = read(dir, 'apps/api/AGENTS.md')
  assert.ok(text.startsWith(before + start)); assert.ok(text.endsWith(end + after))
  ok(runCliBare(['remove', 'all'], dir))
  assert.equal(read(dir, 'apps/api/AGENTS.md'), before + after)
  assert.equal(read(dir, '.agents/rules/rust/local.md'), 'mine')
  assert.ok(!has(dir, '.claude-rules.lock'))
}))

test('partial removal retains shared rules and removes obsolete module block', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--root', 'apps/api', '--agent', 'codex'], dir))
  ok(runCli(['add', 'product'], dir))
  ok(runCliBare(['remove', 'rust'], dir))
  assert.ok(!has(dir, 'apps/api/AGENTS.md'))
  assert.ok(has(dir, '.agents/rules/common/language.md'))
  assert.ok(has(dir, '.agents/skills/architect/SKILL.md'))
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /apps\/api/)
}))

for (const malformed of [start, end + start, start + end + start + end]) {
  test(`malformed markers reject installation before mutation: ${malformed.length}`, () => withTmpRepo(dir => {
    put(dir, 'apps/api/AGENTS.md', malformed)
    const r = runCli(['add', 'rust', '--root', 'apps/api'], dir)
    assert.equal(r.status, 1); assert.match(r.stderr, /Malformed/)
    assert.ok(!has(dir, '.claude')); assert.ok(!has(dir, '.agents'))
    assert.equal(read(dir, 'apps/api/AGENTS.md'), malformed)
  }))
}

test('unowned conflicting asset rejects adoption without mutating other targets', () => withTmpRepo(dir => {
  put(dir, '.agents/rules/rust/code-style.md', 'custom')
  const r = runCli(['add', 'rust'], dir)
  assert.equal(r.status, 1); assert.match(r.stderr, /Conflicting local content/)
  assert.ok(!has(dir, '.claude'))
  assert.equal(read(dir, '.agents/rules/rust/code-style.md'), 'custom')
}))

test('symlinked files and module ancestors are rejected before writes', () => withTmpRepo(dir => withTmpRepo(outside => {
  symlinkSync(outside, join(dir, 'apps'))
  let r = runCli(['add', 'rust', '--root', 'apps/api'], dir)
  assert.equal(r.status, 1); assert.match(r.stderr, /symlink/)
  assert.ok(!has(outside, 'api')); assert.ok(!has(dir, '.claude-rules.lock'))
  rmSync(join(dir, 'apps'))
  put(outside, 'instructions', 'untouched')
  symlinkSync(join(outside, 'instructions'), join(dir, 'AGENTS.md'))
  r = runCli(['add', 'rust'], dir)
  assert.equal(r.status, 1); assert.equal(read(outside, 'instructions'), 'untouched')
})))

test('escaping module paths and unsafe ownership inventory are rejected', () => withTmpRepo(dir => {
  for (const root of ['../escape', '/tmp/escape', 'apps/../../escape']) {
    assert.equal(runCli(['add', 'rust', '--root', root], dir).status, 1)
    assert.ok(!has(dir, '.claude-rules.lock'))
  }
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  const state = lock(dir)
  state.codex.blocks.push('../AGENTS.md')
  put(dir, '.claude-rules.lock', JSON.stringify(state))
  const r = runCliBare(['remove', 'all'], dir)
  assert.equal(r.status, 1); assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
}))

test('doctor catches missing rules and stale blocks; budget labels advisory reads', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--root', 'apps/api', '--agent', 'codex'], dir))
  put(dir, 'apps/api/src/lib.rs', '')
  ok(runCliBare(['doctor'], dir))
  let r = ok(runCliBare(['budget', 'apps/api/src/lib.rs', '--agent', 'codex'], dir))
  assert.match(r.stdout, /conditional rule .agents\/rules\/rust/)
  assert.match(r.stdout, /not actual runtime context/)
  put(dir, 'apps/api/AGENTS.override.md', 'Local override')
  r = ok(runCliBare(['doctor'], dir)); assert.match(r.stdout, /shadows/)
  put(dir, 'apps/api/AGENTS.md', 'No index')
  assert.equal(runCliBare(['doctor'], dir).status, 1)
  rmSync(join(dir, '.agents/rules/rust/code-style.md'))
  r = runCliBare(['doctor'], dir)
  assert.equal(r.status, 1); assert.match(r.stdout, /Codex asset missing/)
}))

test('modified owned assets cannot be silently overwritten or deleted', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  put(dir, '.agents/rules/rust/code-style.md', 'local change')
  assert.equal(runCli(['update'], dir).status, 1)
  assert.equal(runCliBare(['remove', 'all'], dir).status, 1)
  assert.equal(read(dir, '.agents/rules/rust/code-style.md'), 'local change')
}))

test('partial removal rejects modified retained assets without mutation', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', '--agent', 'codex'], dir))
  const before = read(dir, '.claude-rules.lock')
  put(dir, '.agents/skills/architect/SKILL.md', 'local')
  assert.equal(runCliBare(['remove', 'rust'], dir).status, 1)
  assert.equal(read(dir, '.claude-rules.lock'), before)
  assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
}))

test('update extends targets and doctor recognizes shared Codex skills', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'codex'], dir))
  ok(runCliBare(['doctor'], dir))
  ok(runCli(['update', '--agent', 'claude'], dir))
  assert.deepEqual(lock(dir).agents, ['codex', 'claude'])
  assert.ok(lock(dir).codex)
  ok(runCliBare(['doctor'], dir))
}))

test('canonical ownership paths cannot escape their asset tree', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  const state = lock(dir)
  state.codex.files['.agents/rules/rust/../../../README.md'] = { hash: 'bad', profiles: ['rust'], kind: 'rule' }
  put(dir, 'README.md', 'mine')
  put(dir, '.claude-rules.lock', JSON.stringify(state))
  assert.equal(runCliBare(['remove', 'all'], dir).status, 1)
  assert.equal(read(dir, 'README.md'), 'mine')
  assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
}))

test('source failure preserves installed files; source deletion removes only owned files', () => withTmpRepo(dir => withTmpRepo(source => {
  cpSync(join(REPO, 'rules'), join(source, 'rules'), { recursive: true })
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  put(dir, '.agents/rules/rust/custom.md', 'mine')
  const before = read(dir, '.claude-rules.lock')
  // runCliBare allows a distinct offline source tree.
  rmSync(join(source, 'rules/rust'), { recursive: true })
  assert.equal(runCliBare(['update', '--local', source], dir).status, 1)
  assert.equal(read(dir, '.claude-rules.lock'), before)
  assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
  cpSync(join(REPO, 'rules/rust'), join(source, 'rules/rust'), { recursive: true })
  rmSync(join(source, 'rules/rust/code-style.md'))
  ok(runCliBare(['update', '--local', source], dir))
  assert.ok(!has(dir, '.agents/rules/rust/code-style.md'))
  assert.equal(read(dir, '.agents/rules/rust/custom.md'), 'mine')
})))

test('nested instructions participate in requested reading and shared targets survive removal', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--root', 'apps/api', '--agent', 'claude,codex,cursor'], dir))
  ok(runCli(['add', 'go', '--root', 'apps/api/worker'], dir))
  ok(runCli(['add', 'product'], dir))
  const result = ok(runCliBare(['budget', 'apps/api/worker/main.go', '--agent', 'codex'], dir))
  assert.match(result.stdout, /instruction entry apps\/api\/AGENTS.md/)
  assert.match(result.stdout, /instruction entry apps\/api\/worker\/AGENTS.md/)
  assert.doesNotMatch(result.stdout, /conditional rule .agents\/rules\/rust/)
  ok(runCliBare(['remove', 'rust'], dir))
  assert.ok(has(dir, '.agents/skills/architect/SKILL.md'))
  assert.ok(has(dir, '.claude/skills/architect/SKILL.md'))
  assert.ok(has(dir, '.cursor/rules/go/quality-gates.mdc'))
  assert.ok(has(dir, 'apps/api/worker/AGENTS.md'))
}))

test('conflicting legacy destination type fails before any target writes', () => withTmpRepo(dir => {
  put(dir, '.claude/rules/rust', 'mine')
  const result = runCli(['add', 'rust'], dir)
  assert.equal(result.status, 1)
  assert.ok(!has(dir, '.agents'))
  assert.ok(!has(dir, '.claude/rules/common'))
  assert.equal(read(dir, '.claude/rules/rust'), 'mine')
}))

test('profiles sharing registry assets union their scopes and retain remaining owners', () => withTmpRepo(dir => {
  ok(runCli(['add', 'ts-web', '--root', 'apps/web', '--agent', 'claude,codex,cursor'], dir))
  ok(runCli(['add', 'ts-node', '--root', 'apps/server'], dir))
  const state = lock(dir)
  const rule = state.codex.rules.find(r => r.path.startsWith('.agents/rules/ts/') && r.globs.some(g => g.startsWith('apps/web/')))
  assert.ok(rule)
  assert.deepEqual(rule.profiles, ['ts-web', 'ts-node'])
  assert.ok(rule.globs.some(g => g.startsWith('apps/server/')))
  assert.equal(state.codex.rules.filter(r => r.path === rule.path).length, 1)
  assert.match(read(dir, 'apps/web/AGENTS.md'), /rules\/ts\//)
  assert.match(read(dir, 'apps/server/AGENTS.md'), /rules\/ts\//)
  const claudeRule = rule.path.replace('.agents/', '.claude/')
  assert.match(read(dir, claudeRule), /apps\/web/)
  assert.match(read(dir, claudeRule), /apps\/server/)
  ok(runCliBare(['remove', 'ts-web'], dir))
  assert.ok(has(dir, rule.path))
  assert.doesNotMatch(read(dir, rule.path), /apps\/web/)
  assert.match(read(dir, rule.path), /apps\/server/)
  assert.ok(has(dir, claudeRule))
  assert.ok(!has(dir, 'apps/web/AGENTS.md'))
}))

test('identical manual assets are adopted and stale lock scoping is diagnosed', () => withTmpRepo(dir => {
  put(dir, '.agents/rules/rust/code-style.md', read(REPO, 'rules/rust/code-style.md'))
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  assert.ok(lock(dir).codex.files['.agents/rules/rust/code-style.md'])
  const state = lock(dir)
  state.modules = { '.': [], 'apps/api': ['rust'] }
  put(dir, '.claude-rules.lock', JSON.stringify(state))
  const result = runCliBare(['doctor'], dir)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /stale Codex membership\/scope/)
}))

test('partial language removal refreshes the Codex rule inventory', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'go', 'api', '--agent', 'codex'], dir))
  assert.ok(has(dir, '.agents/rules/api/rust.md'))
  ok(runCliBare(['remove', 'rust'], dir))
  assert.ok(!has(dir, '.agents/rules/api/rust.md'))
  assert.ok(has(dir, '.agents/rules/api/go.md'))
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /rules\/api\/rust.md/)
}))


test('legacy Codex locks cannot authorize recursive removal of unowned trees', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  const state = lock(dir); delete state.codex
  put(dir, '.claude-rules.lock', JSON.stringify(state))
  put(dir, '.agents/rules/rust/local.md', 'mine')
  assert.equal(runCliBare(['remove', 'all'], dir).status, 1)
  assert.equal(read(dir, '.agents/rules/rust/local.md'), 'mine')
  assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
}))

test('alias cycles and unknown module aliases fail before writing an installation', () => withTmpRepo(dir => withTmpRepo(source => {
  cpSync(join(REPO, 'bin'), join(source, 'bin'), { recursive: true })
  const registry = JSON.parse(read(REPO, 'registry.json'))
  registry.aliases.loopA = ['loopB']; registry.aliases.loopB = ['loopA']
  put(source, 'registry.json', JSON.stringify(registry))
  const result = spawnSync(process.execPath, [join(source, 'bin/cli.mjs'), 'add', 'loopA', '--local', REPO], { cwd: dir, encoding: 'utf8' })
  assert.equal(result.status, 1); assert.match(result.stderr, /Alias cycle/)
  assert.ok(!has(dir, '.claude-rules.lock'))
  ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
  const state = lock(dir); state.modules['.'].push('nonexistent-alias')
  put(dir, '.claude-rules.lock', JSON.stringify(state))
  assert.equal(runCli(['update'], dir).status, 1)
})))
