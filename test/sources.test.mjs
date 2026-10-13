// Layered sources (ADR-0008), offline. Every source is a local bare repository
// reached through a `file://` URL, so the installer's real fetch path — `git init`,
// `git fetch --depth 1 <url> <ref>`, `checkout FETCH_HEAD` — runs with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, cpSync, readdirSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, CLI, registry, withTmpRepo, read, has } from './helpers.mjs'

const LOCK = '.claude-rules.lock'
const lockOf = dir => JSON.parse(read(dir, LOCK))
const ok = r => { assert.equal(r.status, 0, `cli failed (${r.status}):\n${r.stderr}${r.stdout}`); return r }

// No --local: the CLI must fetch core from the lock's URL.
function cli(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  if (r.error) throw r.error
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

// The host's git config must not leak in: no signing, no hooks, a fixed identity.
function git(args, cwd) {
  const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

// What `rust` at --level rules emits, plus the registry: a core small enough to commit
// per test, and shaped like the real one.
const CORE_PATHS = ['registry.json', ...[...registry.shared, ...registry.profiles.rust].map(e => e.from)]

/** A source repository: `paths` copied from this working tree, then `edits` written
 *  over them. Returns { url, commit(edits) → sha, tag(name) }. */
function makeSource(root, name, paths, edits = {}) {
  const work = join(root, `${name}-work`)
  mkdirSync(work, { recursive: true })
  git(['init', '-q', '-b', 'main'], work)
  for (const p of paths) cpSync(join(REPO, p), join(work, p), { recursive: true })
  const bare = join(root, `${name}.git`)
  const commit = (changes) => {
    for (const [p, text] of Object.entries(changes)) { mkdirSync(dirname(join(work, p)), { recursive: true }); writeFileSync(join(work, p), text) }
    git(['add', '-A'], work)
    git(['commit', '-q', '--allow-empty', '-m', 'fixture'], work)
    if (existsSync(bare)) git(['push', '-q', bare, 'main', '--tags'], work)
    else git(['clone', '-q', '--bare', work, bare], root)
    return git(['rev-parse', 'HEAD'], work)
  }
  const first = commit(edits)
  const tag = t => { git(['tag', t], work); git(['push', '-q', bare, '--tags'], work) }
  return { url: `file://${bare}`, first, commit, tag }
}

function writeLock(dir, sources) {
  writeFileSync(join(dir, LOCK), JSON.stringify({ sources, profiles: ['rust'], agents: ['claude'], levels: { rust: 'rules' } }, null, 2) + '\n')
}

const STYLE = 'rules/rust/code-style.md'
const marked = label => read(REPO, STYLE) + `\n<!-- fixture: ${label} -->\n`

test('update fetches core from a git URL at a branch, a tag and a SHA', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS, { [STYLE]: marked('v1') })
    core.tag('v1')
    core.commit({ [STYLE]: marked('main') })
    const repo = join(root, 'consumer')
    mkdirSync(repo)

    writeLock(repo, [{ name: 'core', url: core.url, ref: 'v1' }])
    // No --ref: core follows defaultRef (main), as it always has.
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules', 'rust/code-style.md'), marked('main'), 'the branch head, from the source — not the CLI\'s own tree')
    assert.equal(lockOf(repo).sources[0].ref, registry.defaultRef)

    ok(cli(['update', '--ref', 'v1'], repo))
    assert.equal(read(repo, '.claude/rules', 'rust/code-style.md'), marked('v1'))
    assert.deepEqual(lockOf(repo).sources, [{ name: 'core', url: core.url, ref: 'v1' }])

    ok(cli(['update', '--ref', core.first], repo))
    assert.equal(read(repo, '.claude/rules', 'rust/code-style.md'), marked('v1'), 'a SHA, which `clone --branch` refuses')
  })
})

test('a ref the source does not have fails before writing anything', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const before = read(repo, LOCK)
    const r = cli(['update', '--ref', 'no-such-ref'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /source core \(file:\/\/.*#no-such-ref\)/)
    assert.equal(read(repo, LOCK), before)
    assert.deepEqual(readdirSync(repo), [LOCK], 'nothing emitted')
  })
})

test('an option-shaped URL or ref never reaches git as a flag', () => {
  withTmpRepo(repo => {
    writeLock(repo, [{ name: 'core', url: '--upload-pack=touch pwned', ref: 'main' }])
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /must not start with "-"/)
    assert.ok(!has(repo, 'pwned'))
  })
})

// The fetched sources and the merged tree may hold private content: they live in temp
// dirs, and none survives the run — success or failure.
test('no fetched source or staged tree outlives the run', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    const tmp = join(root, 'tmp')
    mkdirSync(repo)
    mkdirSync(tmp)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo, { TMPDIR: tmp }))
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'))
    assert.deepEqual(readdirSync(tmp), [], 'after success')
    assert.equal(cli(['update', '--ref', 'no-such-ref'], repo, { TMPDIR: tmp }).status, 1)
    assert.deepEqual(readdirSync(tmp), [], 'after a failed fetch')
    // Validation that exits after the fetch must not skip the cleanup.
    const unknown = cli(['add', 'no-such-profile'], repo, { TMPDIR: tmp })
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /Unknown profile\(s\): no-such-profile/)
    assert.deepEqual(readdirSync(tmp), [], 'after an unknown profile')
    const agent = cli(['add', 'rust', '--agent', 'nobody'], repo, { TMPDIR: tmp })
    assert.equal(agent.status, 1)
    assert.match(agent.stderr, /Unknown agent\(s\): nobody/)
    assert.deepEqual(readdirSync(tmp), [], 'after an unknown agent')
  })
})

// What a ref installs is decided by that ref's registry, not by the copy bundled with
// the CLI — those drift as soon as `npx …#<cli ref>` and `--ref` differ.
test('the source\'s registry decides: a profile only it defines installs', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles['team-only'] = [{ from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, {
      'registry.json': JSON.stringify(reg, null, 2) + '\n',
      'rules/team-only/house.md': '# House rule\n',
    })
    assert.ok(!registry.profiles['team-only'], 'the bundled registry must not know it')
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])

    ok(cli(['add', 'team-only'], repo))
    assert.equal(read(repo, '.claude/rules/team-only/house.md'), '# House rule\n')
    assert.deepEqual(lockOf(repo).profiles, ['rust', 'team-only'])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/team-only/house.md'), 'update reads the lock against the same registry')

    // The offline commands keep the bundled registry, which does not know team-only.
    // They must still read the lock; doctor and remove work from its inventory.
    assert.match(ok(cli(['list'], repo)).stdout, /Installed: \[rust, team-only\]/)
    assert.doesNotMatch(ok(cli(['doctor'], repo)).stdout, /unknown to the registry/)
    ok(cli(['remove', 'team-only'], repo))
    assert.ok(!has(repo, '.claude/rules/team-only'))
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'), 'the other profile stays')
    assert.deepEqual(lockOf(repo).profiles, ['rust'])
  })
})

test('list fetches nothing and falls back to the bundled registry', () => {
  withTmpRepo(repo => {
    writeLock(repo, [{ name: 'core', url: 'file:///nowhere/at/all.git', ref: 'main' }])
    const r = ok(cli(['list'], repo))
    for (const name of Object.keys(registry.profiles)) assert.match(r.stdout, new RegExp(`^  ${name}  \\(`, 'm'))
    assert.match(r.stdout, /Installed: \[rust\] for \[claude\] @ core@main/)
  })
})

test('a registry entry that climbs out of its source is refused', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles['escape'] = [{ from: '../outside', to: '.claude/rules/escape', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg) })
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', 'stolen.md'), 'not the source\'s\n')
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const r = cli(['add', 'escape'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /registry: entry .*"\.\.\/outside".* must come from a relative path/)
    assert.ok(!has(repo, '.claude/rules/escape'))
  })
})

// Copying dereferences links, so a link committed in a source must not reach a file of
// the machine running the install. A link that stays inside the source is fine.
test('a link in a source that resolves outside it is refused before any write', () => {
  withTmpRepo(root => {
    const secret = join(root, 'secret.txt')
    writeFileSync(secret, 'machine-local secret\n')
    const core = makeSource(root, 'core', CORE_PATHS)
    const work = join(root, 'core-work')
    symlinkSync(secret, join(work, 'rules/rust/leak.md'))
    symlinkSync('code-style.md', join(work, 'rules/rust/alias.md'))
    core.commit({})
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const before = read(repo, LOCK)
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /rules\/rust\/leak\.md: resolves outside its source/)
    assert.deepEqual(readdirSync(repo), [LOCK], 'nothing emitted')
    assert.equal(read(repo, LOCK), before)

    git(['rm', '-q', 'rules/rust/leak.md'], work)
    core.commit({})
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/rust/alias.md'), read(REPO, STYLE), 'an inside link is copied as its content')
  })
})

// remove deletes what was installed, from the lock's inventory — never from a registry.
// Here the source maps `rust` somewhere the bundled registry does not: removing it must
// delete exactly that, and leave alone the path the bundled registry would have named.
test('remove deletes from the inventory: a source that redefines a known profile\'s `to` is removed exactly', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = reg.profiles.rust.map(e => e.from === 'rules/rust' ? { ...e, to: '.claude/rules/team-rust' } : e)
    const core = makeSource(root, 'core', [...CORE_PATHS, 'rules/go', ...registry.profiles.go.map(e => e.from)], { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['add', 'go'], repo))
    assert.ok(has(repo, '.claude/rules/team-rust/code-style.md'))
    assert.ok(has(repo, '.claude/rules/go'))
    const inv = lockOf(repo).installed
    assert.deepEqual(inv.find(i => i.from === 'rules/rust'), { source: 'core', kind: 'rule', from: 'rules/rust', to: '.claude/rules/team-rust', profile: 'rust' })
    assert.ok(inv.some(i => i.profile === null && i.from === 'rules/common'), 'shared entries are inventoried with profile null')
    // The bundled destination holds something this install never wrote.
    mkdirSync(join(repo, '.claude/rules/rust'), { recursive: true })
    writeFileSync(join(repo, '.claude/rules/rust/mine.md'), 'not installed\n')

    ok(cli(['remove', 'rust'], repo))
    assert.ok(!has(repo, '.claude/rules/team-rust'), 'the installed copy is gone')
    assert.equal(read(repo, '.claude/rules/rust/mine.md'), 'not installed\n', 'the bundled path was never ours')
    assert.ok(has(repo, '.claude/rules/go') && has(repo, '.claude/rules/common'), 'go and the shared rules stay')
    const after = lockOf(repo)
    assert.deepEqual(after.profiles, ['go'])
    assert.ok(!after.installed.some(i => i.profile === 'rust'), 'the lock forgets rust')
    assert.ok(after.installed.some(i => i.profile === 'go'))
  })
})

test('remove refuses a lock with no inventory', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    const lock = lockOf(repo)
    delete lock.installed
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
    const r = cli(['remove', 'rust'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no "installed" inventory; run `update` once/)
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'))
  })
})

// An update whose registry maps an entry elsewhere must not leave the old copy active
// and out of the inventory, where no remove could reach it.
test('update to a registry that moves a destination removes the old copy; remove all then leaves nothing', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'))

    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = reg.profiles.rust.map(e => e.from === 'rules/rust' ? { ...e, to: '.claude/rules/team-rust' } : e)
    core.commit({ 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const r = ok(cli(['update'], repo))
    assert.match(r.stdout, /✗ \.claude\/rules\/rust {2}\(no longer installed\)/)
    assert.ok(!has(repo, '.claude/rules/rust'), 'the old destination is gone')
    assert.ok(has(repo, '.claude/rules/team-rust/code-style.md'))
    assert.ok(has(repo, '.claude/rules/common'), 'what is still installed stays')

    ok(cli(['remove', 'all'], repo))
    assert.deepEqual(readdirSync(join(repo, '.claude/rules')), [], 'nothing of the install survives')
    assert.ok(!has(repo, LOCK))
  })
})

// Stale cleanup only covers the agents the previous install wrote for: a target
// added in this run never held anything of ours.
test('stale cleanup never touches a target the previous install did not write for', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'rules/rust-extra', to: '.claude/rules/rust-extra', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'rules/rust-extra/x.md': '# extra\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/rust-extra/x.md'))
    mkdirSync(join(repo, '.cursor/rules/rust-extra'), { recursive: true })
    writeFileSync(join(repo, '.cursor/rules/rust-extra/mine.mdc'), 'hand-written\n')

    core.commit({ 'registry.json': read(REPO, 'registry.json') })   // upstream drops the entry
    ok(cli(['update', '--agent', 'cursor'], repo))
    assert.ok(!has(repo, '.claude/rules/rust-extra'), 'the claude copy we wrote is pruned')
    assert.equal(read(repo, '.cursor/rules/rust-extra/mine.mdc'), 'hand-written\n', 'cursor was never ours there')
  })
})

test('a forged inventory destination outside the installer\'s roots is refused before any deletion', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src/main.rs'), 'fn main() {}\n')
    const lock = lockOf(repo)
    lock.installed.find(i => i.from === 'rules/rust').to = 'src'
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
    for (const args of [['remove', 'rust'], ['update']]) {
      const r = cli(args, repo)
      assert.equal(r.status, 1, args.join(' '))
      assert.match(r.stderr, /installed: entry .*"to":"src".* land under \.claude\/rules\//)
      assert.equal(read(repo, 'src/main.rs'), 'fn main() {}\n', `${args[0]} must not touch src`)
    }
  })
})

test('a registry that moves a destination into a child of itself is refused', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = reg.profiles.rust.map(e => e.from === 'rules/rust' ? { ...e, to: '.claude/rules/rust/current' } : e)
    core.commit({ 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const before = read(repo, LOCK)
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /\.claude\/rules\/rust moved to \.claude\/rules\/rust\/current, which overlaps it/)
    assert.equal(read(repo, LOCK), before)
    assert.ok(!has(repo, '.claude/rules/rust/current'), 'nothing written')
  })
})

test('a fetched retired-skill name that climbs out of the skill root is refused, and src survives', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.retired = { ...(reg.retired || {}), skills: [...(reg.retired?.skills || []), '../../src'] }
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const repo = join(root, 'consumer')
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/main.rs'), 'fn main() {}\n')
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /retired skill "\.\.\/\.\.\/src" must be a plain skill directory name/)
    assert.equal(read(repo, 'src/main.rs'), 'fn main() {}\n')
    assert.ok(!has(repo, '.claude'), 'refused before emitting')
  })
})

// The offline commands read the lock as written. A profile the installing source
// defines, but the bundled registry retired, must not be renamed away by remove.
test('remove keeps a source-defined profile that the bundled registry retired', () => {
  withTmpRepo(root => {
    const retired = Object.keys(registry.retired?.profiles || {})[0]
    assert.ok(retired, 'the bundled registry retires at least one profile')
    const reg = JSON.parse(read(REPO, 'registry.json'))
    delete reg.retired.profiles[retired]
    reg.profiles[retired] = [{ from: `rules/${retired}`, to: `.claude/rules/${retired}`, kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', [`rules/${retired}/r.md`]: '# kept\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['add', retired], repo))
    assert.ok(has(repo, `.claude/rules/${retired}/r.md`))
    ok(cli(['remove', 'rust'], repo))
    assert.deepEqual(lockOf(repo).profiles, [retired], 'remove must not drop it through the bundled retirement list')
    ok(cli(['remove', 'all'], repo))
    assert.ok(!has(repo, `.claude/rules/${retired}`), 'remove all reaches it')
    assert.ok(!has(repo, LOCK))
  })
})

// Emitting an entry resets its directory and removing one deletes it recursively:
// two entries that nest would take each other's files.
test('a registry whose entries nest is refused before any write', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles['team-a'] = [{ from: 'rules/team-a', to: '.claude/rules/team', kind: 'rule' }]
    reg.profiles['team-b'] = [{ from: 'rules/team-b', to: '.claude/rules/team/extra', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'rules/team-a/a.md': '# a\n', 'rules/team-b/b.md': '# b\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const r = cli(['add', 'team-a', 'team-b'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /installs to \.claude\/rules\/team\/extra, inside \.claude\/rules\/team/)
    assert.deepEqual(readdirSync(repo), [LOCK])
  })
})

test('remove refuses to delete a destination that holds one a remaining entry owns', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', [...CORE_PATHS, ...registry.profiles.go.map(e => e.from)])
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['add', 'go'], repo))
    const lock = lockOf(repo)
    // A forged nesting: go stays installed, and its record now sits inside rust's.
    lock.installed.find(i => i.from === 'rules/go').to = '.claude/rules/rust/go'
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
    const r = cli(['remove', 'rust'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Removing \.claude\/rules\/rust would delete \.claude\/rules\/rust\/go/)
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'), 'nothing deleted')
  })
})

// A Cursor skill written before Codex was adopted is in no Codex inventory: when the
// source drops it, the stale cleanup must reach it, or nothing ever will.
test('a skill dropped upstream while Codex is adopted is still pruned, and remove all leaves nothing', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'skills/team', to: '.claude/skills/team', kind: 'skill' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'skills/team/SKILL.md': '---\nname: team\ndescription: x\n---\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeFileSync(join(repo, LOCK), JSON.stringify({ sources: [{ name: 'core', url: core.url, ref: 'main' }], profiles: ['rust'], agents: ['cursor'], levels: { rust: 'rules' } }, null, 2) + '\n')
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.agents/skills/team/SKILL.md'))

    core.commit({ 'registry.json': read(REPO, 'registry.json') })   // upstream drops the skill
    ok(cli(['update', '--agent', 'codex'], repo))
    assert.ok(!has(repo, '.agents/skills/team'), 'pruned although Codex now owns .agents/skills')
    ok(cli(['remove', 'all'], repo))
    assert.ok(!has(repo, '.agents/skills/team'))
  })
})

// ------------------------------------------------------------------ several layers
// Two sources in one lock: core first, then a team overlay. The last path wins.
function writeLayers(dir, sources, profiles = ['rust'], agents = ['claude']) {
  writeFileSync(join(dir, LOCK), JSON.stringify({ sources, profiles, agents, levels: Object.fromEntries(profiles.map(p => [p, 'rules'])) }, null, 2) + '\n')
}
const withSkill = reg => ({ ...reg, profiles: { ...reg.profiles, rust: [...reg.profiles.rust, { from: 'skills/team', to: '.claude/skills/team', kind: 'skill' }] } })
const SKILL = '---\nname: team\ndescription: core\n---\n'

test('an overlay replaces a core rule file, and a core skill whole', () => {
  withTmpRepo(root => {
    const reg = withSkill(JSON.parse(read(REPO, 'registry.json')))
    const core = makeSource(root, 'core', CORE_PATHS, {
      'registry.json': JSON.stringify(reg, null, 2) + '\n',
      'skills/team/SKILL.md': SKILL,
      'skills/team/reference.md': '# core-only page\n',
    })
    const team = makeSource(root, 'team', [], {
      [STYLE]: '# team code style\n',
      'skills/team/SKILL.md': '---\nname: team\ndescription: team\n---\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/rust/code-style.md'), '# team code style\n', 'the overlay file wins')
    assert.equal(read(repo, '.claude/rules/rust/error-handling.md'), read(REPO, 'rules/rust/error-handling.md'), 'core files the overlay does not name stay')
    assert.match(read(repo, '.claude/skills/team/SKILL.md'), /description: team/)
    assert.ok(!has(repo, '.claude/skills/team/reference.md'), 'no half skill: the overlay directory replaces the core one whole')
    assert.deepEqual(lockOf(repo).sources.map(s => s.name), ['core', 'team'])
  })
})

// Each source carries its own registry; they merge in source order (ADR-0008).
test('registries merge: an overlay-only profile installs, a known profile gains entries, aliases merge', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({
        profiles: {
          'team-only': [{ from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' }],
          rust: [{ from: 'rules/team-rust', to: '.claude/rules/team-rust', kind: 'rule' }],
        },
        aliases: { 'team-pack': ['team-only'], 'rust-api': ['rust'] },
      }, null, 2) + '\n',
      'rules/team-only/house.md': '# House rule\n',
      'rules/team-rust/extra.md': '# Team Rust\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['add', 'team-pack'], repo))
    assert.equal(read(repo, '.claude/rules/team-only/house.md'), '# House rule\n', 'a profile only the overlay defines')
    assert.equal(read(repo, '.claude/rules/team-rust/extra.md'), '# Team Rust\n', 'rust gains the overlay entry')
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'), 'and keeps its core ones')
    const lock = lockOf(repo)
    assert.deepEqual(lock.profiles, ['rust', 'team-only'])
    const src = from => lock.installed.find(i => i.from === from).source
    assert.equal(src('rules/team-only'), 'team')
    assert.equal(src('rules/team-rust'), 'team')
    assert.equal(src('rules/rust'), 'core')
    // The later source wins on the same alias key.
    ok(cli(['remove', 'all'], repo))
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['team-only'])
    ok(cli(['add', 'rust-api'], repo))
    assert.deepEqual(lockOf(repo).profiles, ['team-only', 'rust'], 'rust-api unpacks to the overlay\'s list, not core\'s')
  })
})

// A source registry's `exclude` removes paths from the merged tree; the emitters'
// cleanup then deletes the copies an earlier install wrote.
test('exclude: an excluded core rule and skill disappear on update, for Claude and Codex', () => {
  withTmpRepo(root => {
    const reg = withSkill(JSON.parse(read(REPO, 'registry.json')))
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'skills/team/SKILL.md': SKILL })
    const team = makeSource(root, 'team', [], { 'registry.json': '{}\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['rust'], ['claude', 'codex'])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/rust/logging.md') && has(repo, '.agents/rules/rust/logging.md'))
    assert.ok(has(repo, '.claude/skills/team/SKILL.md'))

    team.commit({ 'registry.json': JSON.stringify({ exclude: ['rules/rust/logging.md', 'skills/team'] }) + '\n' })
    ok(cli(['update'], repo))
    assert.ok(!has(repo, '.claude/rules/rust/logging.md'), 'the excluded rule file is gone')
    assert.ok(!has(repo, '.agents/rules/rust/logging.md'), 'from the Codex tree too')
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'), 'the rest of the rule stays')
    assert.ok(!has(repo, '.claude/skills/team') && !has(repo, '.agents/skills/team'), 'the excluded skill is gone')
    assert.ok(!lockOf(repo).installed.some(i => i.from === 'skills/team'), 'and out of the inventory')

    team.commit({ 'registry.json': JSON.stringify({ exclude: ['skills/team/SKILL.md'] }) + '\n' })
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /exclude skills\/team\/SKILL\.md: a skill is excluded whole/)
  })
})

// Agent and kit directories are not reset on emit (the kit is "copy and own"), so a
// file excluded inside one is deleted by name, from the inventory — and only that file.
test('exclude: a file inside an agent directory is deleted by name', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents', to: '.claude/agents', kind: 'agent' }]
    const core = makeSource(root, 'core', [...CORE_PATHS, 'agents'], { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const team = makeSource(root, 'team', [], { 'registry.json': '{}\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    writeFileSync(join(repo, '.claude/agents/mine.md'), 'the repo\'s own\n')
    team.commit({ 'registry.json': JSON.stringify({ exclude: ['agents/code-simplifier.md'] }) + '\n' })
    const r = ok(cli(['update'], repo))
    assert.match(r.stdout, /− agents\/code-simplifier\.md {2}\(excluded\)/)
    assert.ok(!has(repo, '.claude/agents/code-simplifier.md'))
    assert.ok(has(repo, '.claude/agents/code-reviewer.md'))
    assert.equal(read(repo, '.claude/agents/mine.md'), 'the repo\'s own\n')
  })
})

// `.dev/overrides/` is the repo's own layer: last, no ref, never written.
test('.dev/overrides: a repo-owned rules/common/language.md survives update', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(join(repo, '.dev/overrides/rules/common'), { recursive: true })
    const mine = '# Language\n\n- Ours: French in the code comments.\n'
    writeFileSync(join(repo, '.dev/overrides/rules/common/language.md'), mine)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }], ['rust'], ['claude', 'codex'])
    for (let run = 0; run < 2; run++) {
      ok(cli(['update'], repo))
      assert.equal(read(repo, '.claude/rules/common/language.md'), mine, `run ${run}: Claude`)
      assert.equal(read(repo, '.agents/rules/common/language.md'), mine, `run ${run}: Codex`)
    }
    assert.deepEqual(readdirSync(join(repo, '.dev/overrides'), { recursive: true }).sort(), ['rules', 'rules/common', 'rules/common/language.md'], 'never written')
    assert.equal(read(repo, '.dev/overrides/rules/common/language.md'), mine)
    assert.deepEqual(lockOf(repo).sources.map(s => s.name), ['core'], 'the project layer is no source: no ref, nothing locked')
  })
})

// Sources are added and dropped through the CLI, never by hand-editing the lock.
test('add --source appends a source to the lock; remove --source drops it and what only it installed', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ profiles: { 'team-only': [{ from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' }] } }) + '\n',
      'rules/team-only/house.md': '# House rule\n',
      [STYLE]: '# team code style\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))

    ok(cli(['add', '--source', `team=${team.url}#main`], repo))
    assert.deepEqual(lockOf(repo).sources, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    assert.equal(read(repo, '.claude/rules/rust/code-style.md'), '# team code style\n', 'the new layer is installed at once')
    ok(cli(['add', 'team-only'], repo))
    assert.ok(has(repo, '.claude/rules/team-only/house.md'))
    const twice = cli(['add', '--source', `team=${team.url}#main`], repo)
    assert.equal(twice.status, 1)
    assert.match(twice.stderr, /source "team" is already locked/)

    const r = ok(cli(['remove', '--source', 'team'], repo))
    assert.match(r.stdout, /team-only/)
    const lock = lockOf(repo)
    assert.deepEqual(lock.sources, [{ name: 'core', url: core.url, ref: 'main' }])
    assert.deepEqual(lock.profiles, ['rust'], 'a profile only the dropped source defined goes with it')
    assert.ok(!has(repo, '.claude/rules/team-only'))
    assert.equal(read(repo, '.claude/rules/rust/code-style.md'), read(REPO, STYLE), 'core\'s file is back')
    for (const args of [['remove', '--source', 'core'], ['remove', '--source', 'nobody']]) {
      const bad = cli(args, repo)
      assert.equal(bad.status, 1, args.join(' '))
      assert.match(bad.stderr, /cannot be removed|not locked/)
    }
  })
})

// doctor explains what is installed from the lock's inventory, not from the registry
// bundled with the CLI — so it audits an overlay's profile with no network at all.
test('doctor audits an overlay-only profile offline, and fails once an inventoried file is deleted', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ profiles: { 'team-only': [
        { from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' },
        { from: 'agents/team.md', to: '.claude/agents/team.md', kind: 'agent' },
      ] } }) + '\n',
      'rules/team-only/house.md': '# House rule\n',
      'agents/team.md': '---\nname: team\ndescription: x\n---\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['add', 'team-only'], repo))
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })   // no source reachable
    const r = cli(['doctor'], repo)
    assert.equal(r.status, 0, r.stdout)
    assert.doesNotMatch(r.stdout, /unknown to the registry/)

    rmSync(join(repo, '.claude/agents/team.md'))
    const bad = cli(['doctor'], repo)
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /\.claude\/agents\/team\.md — promised by "team-only" for claude, missing on disk/)
  })
})

// An alias an overlay defines is in no bundled registry: the lock records the merged
// aliases, so an offline `remove <alias>` unpacks it as `add` did.
test('remove unpacks a source-only alias offline, from the lock', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({
        profiles: { 'team-only': [{ from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' }] },
        aliases: { 'team-pack': ['team-only'] },
      }) + '\n',
      'rules/team-only/house.md': '# House rule\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['add', 'team-pack'], repo))
    assert.deepEqual(lockOf(repo).aliases['team-pack'], ['team-only'])
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })   // no source reachable
    const r = ok(cli(['remove', 'team-pack'], repo))
    assert.match(r.stdout, /unpack team-pack → team-only/)
    assert.ok(!has(repo, '.claude/rules/team-only'))
    assert.deepEqual(lockOf(repo).profiles, ['rust'])
    assert.deepEqual(lockOf(repo).aliases['team-pack'], ['team-only'], 'remove keeps what the sources defined')
  })
})

// A lock written before the inventory cannot say where an earlier install wrote: the
// first update says so, and lists what may be stale — it deletes none of it.
test('the first update from a lock with no inventory lists what may be stale', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = reg.profiles.rust.map(e => e.from === 'rules/rust' ? { ...e, to: '.claude/rules/team-rust' } : e)
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const repo = join(root, 'consumer')
    mkdirSync(join(repo, '.claude/rules/rust'), { recursive: true })
    writeFileSync(join(repo, '.claude/rules/rust/code-style.md'), 'from an older install\n')
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    const r = ok(cli(['update'], repo))
    assert.match(r.stdout, /had no "installed" inventory/)
    assert.match(r.stdout, /may be stale: \.claude\/rules\/rust$/m)
    assert.doesNotMatch(r.stdout, /may be stale:.*\.claude\/rules\/common/, 'what is installed now is not listed')
    assert.equal(read(repo, '.claude/rules/rust/code-style.md'), 'from an older install\n', 'listed, never deleted')
    assert.ok(Array.isArray(lockOf(repo).installed))
    assert.doesNotMatch(ok(cli(['update'], repo)).stdout, /inventory/, 'said once: the next update has one')
  })
})

// The skill unit holds on disk too, not only in the staged tree: an overlay added after
// core was installed must not leave core's other skill files behind.
test('an overlay skill added after core replaces the installed skill whole, for Claude and Cursor', () => {
  withTmpRepo(root => {
    const reg = withSkill(JSON.parse(read(REPO, 'registry.json')))
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'skills/team/SKILL.md': SKILL, 'skills/team/reference.md': '# core-only page\n' })
    const team = makeSource(root, 'team', [], { 'skills/team/SKILL.md': '---\nname: team\ndescription: team\n---\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }], ['rust'], ['claude', 'cursor'])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/skills/team/reference.md') && has(repo, '.agents/skills/team/reference.md'))
    ok(cli(['add', '--source', `team=${team.url}#main`], repo))
    for (const dir of ['.claude/skills/team', '.agents/skills/team']) {
      assert.match(read(repo, dir, 'SKILL.md'), /description: team/, dir)
      assert.ok(!has(repo, dir, 'reference.md'), `${dir}: no half skill on disk`)
    }
  })
})

// `retired` merges by key, the later source winning: an overlay that brings back a
// skill core retired keeps it installed.
test('an overlay that un-retires a core-retired skill keeps it installed', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.retired = { ...reg.retired, skills: ['team'] }
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ retired: { skills: [] }, profiles: { rust: [{ from: 'skills/team', to: '.claude/skills/team', kind: 'skill' }] } }) + '\n',
      'skills/team/SKILL.md': SKILL,
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/skills/team/SKILL.md'), 'the later retired.skills replaces the earlier one')
  })
})

// Agent and kit directories are not reset on emit, so the inventory records the files
// it wrote inside them: one no layer supplies any more is pruned by name, and a file
// the repo added there is never touched.
test('remove --source prunes the files it supplied inside core\'s agent and kit directories', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents', to: '.claude/agents', kind: 'agent' }]
    const core = makeSource(root, 'core', [...CORE_PATHS, 'agents'], { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const team = makeSource(root, 'team', [], { 'agents/team.md': '# team agent\n', 'kit/rust/team.sh': 'echo team\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeFileSync(join(repo, LOCK), JSON.stringify({ sources: [{ name: 'core', url: core.url, ref: 'main' }], profiles: ['rust'], agents: ['claude'], levels: { rust: 'gates' } }, null, 2) + '\n')
    ok(cli(['update'], repo))
    ok(cli(['add', '--source', `team=${team.url}#main`], repo))
    assert.ok(has(repo, '.claude/agents/team.md') && has(repo, '.dev/kit/rust/team.sh'))
    writeFileSync(join(repo, '.claude/agents/mine.md'), 'ours\n')
    writeFileSync(join(repo, '.dev/kit/rust/mine.sh'), 'ours\n')

    const r = ok(cli(['remove', '--source', 'team'], repo))
    assert.match(r.stdout, /✗ \.claude\/agents\/team\.md {2}\(no longer installed\)/)
    assert.ok(!has(repo, '.claude/agents/team.md'), 'the overlay agent is gone')
    assert.ok(!has(repo, '.dev/kit/rust/team.sh'), 'the overlay kit file is gone')
    assert.ok(has(repo, '.claude/agents/code-reviewer.md') && has(repo, '.dev/kit/rust/rust.just'), 'core files stay')
    assert.equal(read(repo, '.claude/agents/mine.md'), 'ours\n')
    assert.equal(read(repo, '.dev/kit/rust/mine.sh'), 'ours\n')
  })
})

// File-level cleanup compares paths, not entries: a destination another entry now owns
// keeps the files that entry has just written there.
test('file cleanup never deletes a file a current entry just wrote at a reassigned destination', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents/a', to: '.claude/agents/a', kind: 'agent' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'agents/a/review.md': '# a review\n', 'agents/a/other.md': '# a other\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.deepEqual(lockOf(repo).installed.find(i => i.from === 'agents/a').files, ['other.md', 'review.md'])

    reg.profiles.rust = [...reg.profiles.rust.filter(e => e.from !== 'agents/a'),
      { from: 'agents/a', to: '.claude/agents/b', kind: 'agent' },
      { from: 'agents/replacement', to: '.claude/agents/a', kind: 'agent' }]
    git(['rm', '-q', 'agents/a/review.md'], join(root, 'core-work'))
    core.commit({ 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'agents/replacement/review.md': '# replacement\n' })
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/agents/a/review.md'), '# replacement\n', 'the replacement keeps its fresh file')
    assert.ok(!has(repo, '.claude/agents/a/other.md'), 'what only the moved entry wrote there is pruned')
    assert.equal(read(repo, '.claude/agents/b/other.md'), '# a other\n')
  })
})

// A lock written by phase 1 records agent and kit entries without their files: the
// cleanup cannot tell ours from the repo's, so it lists what may be stale instead.
test('an inventory without files lists what may be stale in an agent or kit directory', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents', to: '.claude/agents', kind: 'agent' }]
    const core = makeSource(root, 'core', [...CORE_PATHS, 'agents'], { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const team = makeSource(root, 'team', [], { 'registry.json': '{}\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    const lock = lockOf(repo)
    for (const i of lock.installed) delete i.files
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
    team.commit({ 'registry.json': JSON.stringify({ exclude: ['agents/code-simplifier.md'] }) + '\n' })
    const r = ok(cli(['update'], repo))
    assert.match(r.stdout, /no file list.*may be stale: \.claude\/agents\/code-simplifier\.md/s)
    assert.ok(has(repo, '.claude/agents/code-simplifier.md'), 'listed, never deleted')
  })
})

test('doctor fails once a file inventoried inside an agent directory is deleted', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ profiles: { 'team-only': [{ from: 'agents/team', to: '.claude/agents/team', kind: 'agent' }] } }) + '\n',
      'agents/team/one.md': '# one\n', 'agents/team/two.md': '# two\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['add', 'team-only'], repo))
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })
    ok(cli(['doctor'], repo))
    rmSync(join(repo, '.claude/agents/team/two.md'))
    const bad = cli(['doctor'], repo)
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /\.claude\/agents\/team\/two\.md — promised by "team-only"/)
  })
})

// A registry with no aliases is recorded as such: an offline remove must not fall back
// to the bundled aliases and unpack a name the installing sources never defined.
test('an installing registry with no aliases records {}, so the bundled ones never apply offline', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.aliases = {}
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.deepEqual(lockOf(repo).aliases, {})
    const r = cli(['remove', 'rust-api'], repo)
    assert.equal(r.status, 1)
    assert.ok(has(repo, '.claude/rules/rust/code-style.md'), 'rust-api is no alias here: nothing removed')
    assert.deepEqual(lockOf(repo).profiles, ['rust'])
  })
})

// An entry whose every file is excluded is not installed at all: no empty record in the
// inventory for doctor to find missing.
test('excluding the only file of a rule directory uninstalls the entry, and doctor stays green', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles['team-only'] = [{ from: 'rules/team-only', to: '.claude/rules/team-only', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'rules/team-only/house.md': '# House rule\n' })
    const team = makeSource(root, 'team', [], { 'registry.json': '{}\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['rust', 'team-only'], ['claude', 'cursor'])
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/team-only/house.md') && has(repo, '.cursor/rules/team-only/house.mdc'))
    team.commit({ 'registry.json': JSON.stringify({ exclude: ['rules/team-only/house.md'] }) + '\n' })
    for (let run = 0; run < 2; run++) {
      ok(cli(['update'], repo))
      assert.ok(!has(repo, '.claude/rules/team-only') && !has(repo, '.cursor/rules/team-only'), `run ${run}`)
      assert.ok(!lockOf(repo).installed.some(i => i.from === 'rules/team-only'), `run ${run}: out of the inventory`)
    }
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })
    assert.doesNotMatch(cli(['doctor'], repo).stdout, /missing on disk/)
  })
})

// Last path wins at every depth: a later layer may turn a file into a directory, or
// a directory into a file, anywhere inside an entry.
test('a later layer replaces a file by a directory and a directory by a file inside an entry', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents/team', to: '.claude/agents/team', kind: 'agent' }]
    const core = makeSource(root, 'core', CORE_PATHS, {
      'registry.json': JSON.stringify(reg, null, 2) + '\n',
      'agents/team/checks/run': 'a file in core\n',
      'agents/team/notes/old.md': '# a directory in core\n',
    })
    const team = makeSource(root, 'team', [], {
      'agents/team/checks/run/check.md': '# a directory in the overlay\n',
      'agents/team/notes': 'a file in the overlay\n',
    })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/agents/team/checks/run/check.md'), '# a directory in the overlay\n')
    assert.equal(read(repo, '.claude/agents/team/notes'), 'a file in the overlay\n')

    // Replayed over an existing install, both ways: drop the overlay, then add it back.
    ok(cli(['remove', '--source', 'team'], repo))
    assert.equal(read(repo, '.claude/agents/team/checks/run'), 'a file in core\n')
    assert.equal(read(repo, '.claude/agents/team/notes/old.md'), '# a directory in core\n')
    ok(cli(['add', '--source', `team=${team.url}#main`], repo))
    assert.equal(read(repo, '.claude/agents/team/checks/run/check.md'), '# a directory in the overlay\n')
    assert.equal(read(repo, '.claude/agents/team/notes'), 'a file in the overlay\n')

    // A path of the repo's own in the way is never replaced.
    ok(cli(['remove', '--source', 'team'], repo))
    writeFileSync(join(repo, '.claude/agents/team/notes/mine.md'), 'ours\n')
    const r = cli(['add', '--source', `team=${team.url}#main`], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /notes is a directory holding .*mine\.md, which this install did not write/)
    assert.equal(read(repo, '.claude/agents/team/notes/mine.md'), 'ours\n')
  })
})

// An agent or kit directory that is no longer installed loses the files we wrote in
// it, never one the repo added there.
test('excluding the last file of an agent directory keeps the repo\'s own file there', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents/team', to: '.claude/agents/team', kind: 'agent' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'agents/team/sub/one.md': '# one\n' })
    const team = makeSource(root, 'team', [], { 'registry.json': '{}\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    writeFileSync(join(repo, '.claude/agents/team/mine.md'), 'ours\n')
    team.commit({ 'registry.json': JSON.stringify({ exclude: ['agents/team/sub/one.md'] }) + '\n' })
    ok(cli(['update'], repo))
    assert.ok(!has(repo, '.claude/agents/team/sub'), 'ours is gone, and the directory it emptied')
    assert.equal(read(repo, '.claude/agents/team/mine.md'), 'ours\n', 'the repo\'s own stays')
    assert.ok(!lockOf(repo).installed.some(i => i.from === 'agents/team'))
  })
})

// The installer tells a file entry from a directory by its extension, everywhere: an
// entry whose staged type contradicts it is refused, not half-installed.
test('an entry whose type contradicts its extension is refused before any write', () => {
  withTmpRepo(root => {
    for (const [from, files] of [['agents/team.v1', { 'agents/team.v1/a.md': '# a\n' }], ['kit/check', { 'kit/check': 'echo\n' }]]) {
      const reg = JSON.parse(read(REPO, 'registry.json'))
      const kind = from.startsWith('kit') ? 'kit' : 'agent'
      reg.profiles.rust = [...reg.profiles.rust, { from, to: kind === 'kit' ? `.dev/${from}` : '.claude/agents/team', kind, level: 'rules' }]
      const name = from.replace(/\W/g, '-')
      const core = makeSource(root, name, CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', ...files })
      const repo = join(root, `consumer-${name}`)
      mkdirSync(repo)
      writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }])
      const r = cli(['update'], repo)
      assert.equal(r.status, 1, from)
      assert.match(r.stderr, /a file entry needs an extension, a directory entry none/, from)
      assert.deepEqual(readdirSync(repo), [LOCK], `${from}: nothing written`)
    }
  })
})

// A skill is replaced whole on disk, so an overlay may change a file inside it into a
// directory, or back, over an existing install.
test('an overlay skill changes an internal file into a directory and back, for Claude and Cursor', () => {
  withTmpRepo(root => {
    const reg = withSkill(JSON.parse(read(REPO, 'registry.json')))
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n', 'skills/team/SKILL.md': SKILL, 'skills/team/reference': 'a file in core\n' })
    const team = makeSource(root, 'team', [], { 'skills/team/SKILL.md': SKILL, 'skills/team/reference/page.md': '# a directory in the overlay\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }], ['rust'], ['claude', 'cursor'])
    ok(cli(['update'], repo))
    ok(cli(['add', '--source', `team=${team.url}#main`], repo))
    for (const dir of ['.claude/skills/team', '.agents/skills/team']) assert.equal(read(repo, dir, 'reference/page.md'), '# a directory in the overlay\n', dir)
    ok(cli(['remove', '--source', 'team'], repo))
    for (const dir of ['.claude/skills/team', '.agents/skills/team']) assert.equal(read(repo, dir, 'reference'), 'a file in core\n', dir)
  })
})

// Profile removal, like every cleanup, deletes the files we wrote in an agent or kit
// directory and never one the repo added there.
test('remove and remove all keep the repo\'s own file in an agent directory', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = [...reg.profiles.rust, { from: 'agents/team', to: '.claude/agents/team', kind: 'agent' }]
    reg.profiles.go = [...reg.profiles.go, { from: 'agents/go', to: '.claude/agents/go', kind: 'agent' }]
    const core = makeSource(root, 'core', [...CORE_PATHS, ...registry.profiles.go.map(e => e.from)], {
      'registry.json': JSON.stringify(reg, null, 2) + '\n', 'agents/team/sub/one.md': '# one\n', 'agents/go/g.md': '# go\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLayers(repo, [{ name: 'core', url: core.url, ref: 'main' }], ['rust', 'go'])
    ok(cli(['update'], repo))
    writeFileSync(join(repo, '.claude/agents/team/mine.md'), 'ours\n')
    writeFileSync(join(repo, '.claude/agents/go/mine.md'), 'ours too\n')
    ok(cli(['remove', 'rust'], repo))
    assert.ok(!has(repo, '.claude/agents/team/sub'), 'ours is gone, and the directory it emptied')
    assert.equal(read(repo, '.claude/agents/team/mine.md'), 'ours\n')
    assert.equal(read(repo, '.claude/agents/go/g.md'), '# go\n', 'the remaining profile keeps its files')
    ok(cli(['remove', 'all'], repo))
    assert.ok(!has(repo, '.claude/agents/go/g.md'))
    assert.equal(read(repo, '.claude/agents/go/mine.md'), 'ours too\n')
  })
})
