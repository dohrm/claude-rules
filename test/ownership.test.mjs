// Ownership (ADR-0010): the installer writes only over what it owns, and refuses a tree
// it cannot explain. Black-box, offline (--local), every target.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, lstatSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { REPO, runCli, runCliBare, withTmpRepo, read } from './helpers.mjs'

const LOCK = '.claude-rules.lock'
const ok = r => { assert.equal(r.status, 0, `cli failed (${r.status}):\n${r.stderr}${r.stdout}`); return r }

// Every file under `dir`, with its content: what "the tree is untouched" compares.
function snapshot(dir) {
  const out = {}
  const rec = rel => {
    for (const name of readdirSync(join(dir, rel))) {
      const path = rel ? `${rel}/${name}` : name
      if (lstatSync(join(dir, path)).isDirectory()) rec(path)
      else out[path] = read(dir, path)
    }
  }
  rec('')
  return out
}

test('update over an unchanged install rewrites nothing, for every target', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))
  const before = snapshot(dir)
  ok(runCli(['update'], dir))
  assert.deepEqual(snapshot(dir), before)
}))

const sha256 = text => createHash('sha256').update(text).digest('hex')
const ROOTS = ['.claude/rules', '.claude/skills', '.claude/agents', '.agents/rules', '.agents/skills', '.cursor/rules', '.dev/kit']
const owned = lock => Object.assign({}, ...lock.installed.map(i => i.files))

test('the inventory records every file written, with its hash, for every target and kind', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', 'agent', '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))
  const lock = JSON.parse(read(dir, LOCK))
  for (const record of lock.installed) assert.equal(typeof record.files, 'object', `${record.kind} ${record.from} has no files`)
  const files = owned(lock)
  const onDisk = Object.keys(snapshot(dir)).filter(p => ROOTS.some(r => p.startsWith(`${r}/`)))
  assert.deepEqual(Object.keys(files).sort(), onDisk.sort(), 'every installed file, and nothing else')
  for (const [path, digest] of Object.entries(files)) assert.equal(digest, sha256(read(dir, path)), path)
  for (const kind of ['rule', 'skill', 'kit', 'agent'])
    assert.ok(lock.installed.some(i => i.kind === kind && Object.keys(i.files).length), `a ${kind} with files`)
  for (const prefix of ['.claude/rules/', '.cursor/rules/', '.agents/rules/', '.agents/skills/', '.claude/skills/', '.dev/kit/', '.claude/agents/'])
    assert.ok(Object.keys(files).some(p => p.startsWith(prefix)), prefix)
  // Codex's own inventory is the same record, not a second one.
  for (const [path, asset] of Object.entries(lock.codex.files)) assert.equal(files[path], asset.hash, path)
}))

// -------------------------------------------------------- check before writing
// Each case: the run exits 1, lists every path it cannot explain, and changes nothing —
// the lock included.
function refused(dir, args, paths) {
  const before = snapshot(dir)
  const r = runCli(args, dir)
  assert.equal(r.status, 1, `expected a refusal:\n${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /not what claude-rules installed/)
  for (const [path, why] of paths) assert.match(r.stderr, new RegExp(`✗ ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — ${why}`), path)
  assert.deepEqual(snapshot(dir), before, 'tree untouched')
  return r
}
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }

test('an edited installed rule stops update, for every target that copies it', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude,codex,cursor'], dir))
  write(dir, '.claude/rules/rust/code-style.md', 'my edit\n')
  write(dir, '.cursor/rules/rust/code-style.mdc', 'my edit\n')
  write(dir, '.agents/rules/rust/code-style.md', 'my edit\n')
  refused(dir, ['update'], [
    ['.claude/rules/rust/code-style.md', 'edited since it was installed'],
    ['.cursor/rules/rust/code-style.mdc', 'edited since it was installed'],
    ['.agents/rules/rust/code-style.md', 'edited since it was installed'],
  ])
}))

test('a file the installer did not write, where it writes one, stops a first add', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md', 'hand-copied\n')
  refused(dir, ['add', 'rust', '--agent', 'claude'], [['.claude/rules/rust/code-style.md', 'not written by claude-rules']])
}))

test('a foreign file inside an installed skill stops update', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'claude,codex'], dir))
  write(dir, '.claude/skills/rfc/notes.md', 'mine\n')
  write(dir, '.agents/skills/rfc/notes.md', 'mine\n')
  refused(dir, ['update'], [
    ['.claude/skills/rfc/notes.md', 'not written by claude-rules, inside an installed directory'],
    ['.agents/skills/rfc/notes.md', 'not written by claude-rules, inside an installed directory'],
  ])
}))

test('foreign content where a directory goes stops add', () => withTmpRepo(dir => {
  write(dir, '.claude/skills/rfc', 'a file named like the skill\n')
  refused(dir, ['add', 'product', '--agent', 'claude'], [['.claude/skills/rfc', 'a file where a directory goes']])
}))

test('nested destinations: a repo directory where a file goes, a repo file above a destination', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md/mine.md', 'nested under a file destination\n')
  write(dir, '.cursor/rules/rust', 'a file above the destinations\n')
  refused(dir, ['add', 'rust', '--agent', 'claude,cursor'], [
    ['.claude/rules/rust/code-style.md', 'a directory where a file goes'],
    ['.cursor/rules/rust', 'a file where a directory goes'],
  ])
}))

test('a forged inventory path outside the installer\'s roots is refused, and the file survives', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
  write(dir, 'src/main.rs', 'fn main() {}\n')
  const lock = JSON.parse(read(dir, LOCK))
  lock.installed[0].files['src/main.rs'] = sha256('fn main() {}\n')
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  const r = runCli(['update'], dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /records src\/main\.rs — an inventoried file must be a sha256 under/)
  assert.equal(read(dir, 'src/main.rs'), 'fn main() {}\n')
}))

// ------------------------------------------------------------------- apply
// A source on disk (`--local`): the shared entries, plus `profiles` and `files`.
function source(root, profiles, files) {
  const dir = join(root, `source-${source.n = (source.n || 0) + 1}`)
  const reg = JSON.parse(read(REPO, 'registry.json'))
  reg.profiles = profiles
  reg.aliases = {}
  write(dir, 'registry.json', JSON.stringify(reg, null, 2) + '\n')
  cpSync(join(REPO, 'CHANGELOG.md'), join(dir, 'CHANGELOG.md'))
  cpSync(join(REPO, 'rules/common'), join(dir, 'rules/common'), { recursive: true })
  for (const [path, text] of Object.entries(files)) write(dir, path, text)
  return dir
}
const at = (dir, args, src) => runCliBare([...args, '--local', src], dir)
const isFile = (dir, path) => lstatSync(join(dir, path)).isFile()

test('a file turning into a directory, and back, over an unchanged install needs nothing', () => withTmpRepo(root => {
  const repo = join(root, 'repo'); mkdirSync(repo)
  const asFile = source(root, { team: [{ from: 'rules/team.md', to: '.claude/rules/team', kind: 'rule' }] }, { 'rules/team.md': '# one file\n' })
  const asDir = source(root, { team: [{ from: 'rules/team', to: '.claude/rules/team', kind: 'rule' }] }, { 'rules/team/a.md': '# a\n' })
  ok(at(repo, ['add', 'team', '--agent', 'claude'], asFile))
  assert.ok(isFile(repo, '.claude/rules/team'))
  ok(at(repo, ['update'], asDir))
  assert.equal(read(repo, '.claude/rules/team/a.md'), '# a\n')
  ok(at(repo, ['update'], asFile))
  assert.equal(read(repo, '.claude/rules/team'), '# one file\n')
  assert.deepEqual(Object.keys(owned(JSON.parse(read(repo, LOCK)))).filter(p => p.startsWith('.claude/rules/team')), ['.claude/rules/team'])
}))

test('a file dropped upstream is pruned, rule and kit alike; a repo file is never deleted', () => withTmpRepo(root => {
  const repo = join(root, 'repo'); mkdirSync(repo)
  const team = [{ from: 'rules/team', to: '.claude/rules/team', kind: 'rule' }, { from: 'kit/team', to: '.dev/kit/team', kind: 'kit' }]
  const v1 = source(root, { team }, { 'rules/team/a.md': '# a\n', 'rules/team/b.md': '# b\n', 'kit/team/x.sh': 'x\n', 'kit/team/y.sh': 'y\n' })
  const v2 = source(root, { team }, { 'rules/team/a.md': '# a\n', 'kit/team/x.sh': 'x\n' })
  const v3 = source(root, { team: [] }, {})
  ok(at(repo, ['add', 'team', '--agent', 'claude,cursor', '--level', 'gates'], v1))
  write(repo, '.claude/rules/team/mine.md', 'mine\n')
  write(repo, '.cursor/rules/team/mine.mdc', 'mine\n')
  write(repo, '.dev/kit/team/mine.toml', 'mine\n')

  const r = ok(at(repo, ['update'], v2))
  assert.match(r.stdout, /✗ \.claude\/rules\/team\/b\.md {2}\(no longer installed\)/)
  for (const gone of ['.claude/rules/team/b.md', '.cursor/rules/team/b.mdc', '.dev/kit/team/y.sh']) assert.ok(!existsSync(join(repo, gone)), gone)
  for (const kept of ['.claude/rules/team/a.md', '.cursor/rules/team/a.mdc', '.dev/kit/team/x.sh']) assert.ok(existsSync(join(repo, kept)), kept)

  ok(at(repo, ['update'], v3))   // the entry itself goes upstream
  assert.ok(!existsSync(join(repo, '.claude/rules/team/a.md')) && !existsSync(join(repo, '.dev/kit/team/x.sh')))
  for (const mine of ['.claude/rules/team/mine.md', '.cursor/rules/team/mine.mdc', '.dev/kit/team/mine.toml'])
    assert.equal(read(repo, mine), 'mine\n', `${mine} was never the installer's`)
  ok(at(repo, ['remove', 'all'], v3))
  for (const mine of ['.claude/rules/team/mine.md', '.cursor/rules/team/mine.mdc', '.dev/kit/team/mine.toml'])
    assert.equal(read(repo, mine), 'mine\n', `remove all keeps ${mine}`)
}))

test('remove deletes only the files its profiles recorded', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'go', '--agent', 'claude,codex,cursor', '--level', 'gates'], dir))
  write(dir, '.claude/rules/rust/mine.md', 'mine\n')
  write(dir, '.dev/kit/rust/mine.toml', 'mine\n')
  const lock = JSON.parse(read(dir, LOCK))
  const rust = lock.installed.filter(i => i.profile === 'rust').flatMap(i => Object.keys(i.files))
  const kept = lock.installed.filter(i => i.profile !== 'rust').flatMap(i => Object.keys(i.files))
  ok(runCli(['remove', 'rust'], dir))
  for (const path of rust.filter(p => !kept.includes(p))) assert.ok(!existsSync(join(dir, path)), path)
  for (const path of kept) assert.ok(existsSync(join(dir, path)), path)
  assert.equal(read(dir, '.claude/rules/rust/mine.md'), 'mine\n')
  assert.equal(read(dir, '.dev/kit/rust/mine.toml'), 'mine\n')
  assert.ok(!JSON.parse(read(dir, LOCK)).installed.some(i => i.profile === 'rust'))
}))

// ------------------------------------------------------------------ --force
// Under --force each refused case above goes through: the listed paths are printed and
// overwritten, and the tree and the inventory end up exactly as a clean install's.
function forced(dir, args, paths, clean) {
  const r = ok(runCli([...args, '--force'], dir))
  assert.match(r.stdout, /--force: overwriting \d+ path\(s\)/)
  for (const [path] of paths) assert.ok(r.stdout.includes(`! ${path} — `), `${path} printed`)
  const expected = withTmpRepo(other => { ok(runCli(clean, other)); return snapshot(other) })
  const tree = snapshot(dir)
  const lockOf = t => JSON.parse(t[LOCK])
  delete tree[LOCK]
  const want = { ...expected }
  delete want[LOCK]
  for (const [path] of paths) if (!(path in want)) assert.ok(!(path in tree), `${path} removed`)
  assert.deepEqual(Object.fromEntries(Object.entries(tree).filter(([p]) => p in want || ROOTS.some(r => p.startsWith(`${r}/`)))), want)
  assert.deepEqual(owned(JSON.parse(read(dir, LOCK))), owned(lockOf(expected)), 'the inventory is recorded again')
}

test('--force overwrites an edited installed rule, for every target', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude,codex,cursor'], dir))
  write(dir, '.claude/rules/rust/code-style.md', 'my edit\n')
  write(dir, '.cursor/rules/rust/code-style.mdc', 'my edit\n')
  write(dir, '.agents/rules/rust/code-style.md', 'my edit\n')
  forced(dir, ['update'], [['.claude/rules/rust/code-style.md'], ['.cursor/rules/rust/code-style.mdc'], ['.agents/rules/rust/code-style.md']],
    ['add', 'rust', '--agent', 'claude,codex,cursor'])
}))

test('--force overwrites a file the installer did not write', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md', 'hand-copied\n')
  forced(dir, ['add', 'rust', '--agent', 'claude'], [['.claude/rules/rust/code-style.md']], ['add', 'rust', '--agent', 'claude'])
}))

test('--force removes a foreign file inside an installed skill', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'claude,codex'], dir))
  write(dir, '.claude/skills/rfc/notes.md', 'mine\n')
  write(dir, '.agents/skills/rfc/notes.md', 'mine\n')
  forced(dir, ['update'], [['.claude/skills/rfc/notes.md'], ['.agents/skills/rfc/notes.md']], ['add', 'product', '--agent', 'claude,codex'])
}))

test('--force replaces foreign content where a directory goes', () => withTmpRepo(dir => {
  write(dir, '.claude/skills/rfc', 'a file named like the skill\n')
  forced(dir, ['add', 'product', '--agent', 'claude'], [['.claude/skills/rfc']], ['add', 'product', '--agent', 'claude'])
}))

test('--force replaces nested destinations', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md/mine.md', 'nested under a file destination\n')
  write(dir, '.cursor/rules/rust', 'a file above the destinations\n')
  forced(dir, ['add', 'rust', '--agent', 'claude,cursor'], [['.claude/rules/rust/code-style.md'], ['.cursor/rules/rust']], ['add', 'rust', '--agent', 'claude,cursor'])
}))

// ---------------------------------------------------------------- adoption
// A lock without file hashes cannot tell a local edit from a stale copy. Its next update
// warns that every installed destination is overwritten once; with no terminal (every
// test run) it needs --force, and refuses without it, changing nothing.
function adopts(dir, edited) {
  write(dir, edited, 'an edit no inventory recorded\n')
  const before = snapshot(dir)
  const r = runCli(['update'], dir)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /records no file hashes: this run adopts the install/)
  assert.match(r.stdout, /^ {2}! \.claude\/rules\/rust$/m, 'the destinations are listed')
  assert.match(r.stderr, /Adoption needs --force without a terminal/)
  assert.deepEqual(snapshot(dir), before, 'nothing changed')

  const forced = ok(runCli(['update', '--force'], dir))
  assert.match(forced.stdout, /records no file hashes: this run adopts the install/)
  assert.notEqual(read(dir, edited), 'an edit no inventory recorded\n', 'overwritten once')
  const lock = JSON.parse(read(dir, LOCK))
  assert.ok(lock.installed.every(i => i.files), 'recorded')
  assert.ok(!('repo' in lock) && !('ref' in lock))
  const next = ok(runCli(['update'], dir))
  assert.doesNotMatch(next.stdout, /adopts the install/, 'once')
}

test('adoption of a phase-1 lock (an inventory without hashes)', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', 'product', '--agent', 'claude,codex,cursor'], dir))
  const lock = JSON.parse(read(dir, LOCK))
  for (const record of lock.installed) delete record.files
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  adopts(dir, '.claude/rules/rust/code-style.md')
}))

test('adoption of a pre-RFC lock (repo and ref, no inventory)', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
  const { profiles, agents, modules, levels } = JSON.parse(read(dir, LOCK))
  writeFileSync(join(dir, LOCK), JSON.stringify({ repo: 'dohrm/claude-rules', ref: 'main', profiles, agents, modules, levels }, null, 2) + '\n')
  adopts(dir, '.claude/rules/rust/code-style.md')
}))

test('a lock without hashes and nothing installed on disk is no adoption', () => withTmpRepo(dir => {
  writeFileSync(join(dir, LOCK), JSON.stringify({ repo: 'dohrm/claude-rules', ref: 'main', profiles: ['rust'], agents: ['claude'] }, null, 2) + '\n')
  const r = ok(runCli(['update'], dir))
  assert.doesNotMatch(r.stdout, /adopts the install/)
}))

// ------------------------------------------------- Tier 3, round 1 findings
test('a forged Codex inventory path is refused even when Codex is not a target', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
  write(dir, 'src/main.rs', 'fn main() {}\n')
  const lock = JSON.parse(read(dir, LOCK))
  lock.codex = { version: 1, files: { 'src/main.rs': { hash: sha256('fn main() {}\n'), profiles: [], kind: 'rule' } }, rules: [], blocks: [] }
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  const r = runCli(['update'], dir)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Invalid Codex-owned path: src\/main\.rs/)
  assert.equal(read(dir, 'src/main.rs'), 'fn main() {}\n')
}))

test('a hashed install never purges a retired skill directory it did not record', () => withTmpRepo(dir => {
  ok(runCli(['add', 'product', '--agent', 'claude'], dir))
  write(dir, '.claude/skills/plan/mine.md', 'mine\n')
  ok(runCli(['update'], dir))
  assert.equal(read(dir, '.claude/skills/plan/mine.md'), 'mine\n')
}))

test('identical content and an empty directory are not ownership', () => withTmpRepo(dir => {
  write(dir, '.claude/rules/rust/code-style.md', read(REPO, 'rules/rust/code-style.md'))
  mkdirSync(join(dir, '.claude/rules/rust/logging.md'))
  refused(dir, ['add', 'rust', '--agent', 'claude'], [
    ['.claude/rules/rust/code-style.md', 'not written by claude-rules'],
    ['.claude/rules/rust/logging.md', 'a directory where a file goes'],
  ])
}))

test('adoption overwrites a moved destination and a file dropped upstream, listed first', () => withTmpRepo(dir => {
  ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
  const lock = JSON.parse(read(dir, LOCK))
  for (const record of lock.installed) delete record.files
  lock.installed.find(i => i.from === 'rules/rust').to = '.claude/rules/team'   // where a phase-1 source put it
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  write(dir, '.claude/rules/team/code-style.md', 'the old copy\n')
  write(dir, '.claude/rules/rust/dropped-upstream.md', 'stale\n')
  const r = ok(runCli(['update', '--force'], dir))
  assert.match(r.stdout, /^ {2}! \.claude\/rules\/team$/m)
  assert.ok(!existsSync(join(dir, '.claude/rules/team')), 'the moved destination goes')
  assert.ok(!existsSync(join(dir, '.claude/rules/rust/dropped-upstream.md')), 'the adopted destination is overwritten whole')
  assert.ok(existsSync(join(dir, '.claude/rules/rust/code-style.md')))
  assert.deepEqual(snapshot(dir)['.claude/rules/rust/code-style.md'], read(REPO, 'rules/rust/code-style.md'))
}))

// Tier 3, round 2: the agents root holds the repo's agents beside ours.
test('adoption never decides alone about an unexplained file in the agents root', () => withTmpRepo(dir => {
  ok(runCli(['add', 'agent', '--agent', 'claude'], dir))
  const lock = JSON.parse(read(dir, LOCK))
  for (const record of lock.installed) delete record.files
  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n')
  write(dir, '.claude/agents/dropped-upstream.md', 'one of ours, or the repo\'s?\n')
  const before = snapshot(dir)
  const r = runCli(['update'], dir)
  assert.equal(r.status, 1)
  assert.deepEqual(snapshot(dir), before)
  const forced = ok(runCli(['update', '--force'], dir))
  assert.match(forced.stdout, /! \.claude\/agents\/dropped-upstream\.md — /)
  assert.ok(!existsSync(join(dir, '.claude/agents/dropped-upstream.md')), 'gone, and listed, under an explicit --force')
}))
