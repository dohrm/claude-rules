// Layered sources (ADR-0008), offline. Every source is a local bare repository
// reached through a `file://` URL, so the installer's real fetch path — `git init`,
// `git fetch --depth 1 <url> <ref>`, `checkout FETCH_HEAD` — runs with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, cpSync, readdirSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
    // They must still read the lock; remove and doctor work from the lock's inventory.
    assert.match(ok(cli(['list'], repo)).stdout, /Installed: \[rust, team-only\]/)
    assert.doesNotMatch(ok(cli(['doctor'], repo)).stdout, /unknown to the registry bundled with this CLI/)
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
    const { files, ...record } = inv.find(i => i.from === 'rules/rust')
    assert.deepEqual(record, { source: 'core', kind: 'rule', from: 'rules/rust', to: '.claude/rules/team-rust', profile: 'rust' })
    assert.ok(Object.keys(files).length && Object.keys(files).every(p => p.startsWith('.claude/rules/team-rust/')), 'its files, where the source put them')
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
    assert.match(r.stdout, /✗ \.claude\/rules\/rust\/code-style\.md {2}\(no longer installed\)/)
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

// ADR-0010: deleting what is owned and unchanged before writing makes a move into a
// child of the old destination an ordinary update, with nothing left of the old copy.
test('a registry that moves a destination into a child of itself needs nothing special', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.rust = reg.profiles.rust.map(e => e.from === 'rules/rust' ? { ...e, to: '.claude/rules/rust/current' } : e)
    core.commit({ 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    ok(cli(['update'], repo))
    assert.deepEqual(readdirSync(join(repo, '.claude/rules/rust')), ['current'], 'the old copy is gone')
    assert.equal(read(repo, '.claude/rules/rust/current/code-style.md'), read(REPO, STYLE))
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

// remove deletes the files a record holds, never a directory a `to` names: a forged
// nesting in the lock cannot take a remaining entry's files with it.
test('remove deletes recorded files only, whatever the records\' destinations claim', () => {
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
    ok(cli(['remove', 'rust'], repo))
    assert.ok(!has(repo, '.claude/rules/rust'), 'rust is gone')
    assert.ok(has(repo, '.claude/rules/go/quality-gates.md'), 'go is untouched')
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

// ------------------------------------------------------------------ layers (phase 3)
// A core with one extra profile, `team`: a rule directory and a skill of two files.
function teamCore(root, extra = {}) {
  const reg = JSON.parse(read(REPO, 'registry.json'))
  reg.profiles.team = [
    { from: 'rules/team', to: '.claude/rules/team', kind: 'rule' },
    { from: 'skills/team', to: '.claude/skills/team', kind: 'skill' },
  ]
  return makeSource(root, 'core', CORE_PATHS, {
    'registry.json': JSON.stringify(reg, null, 2) + '\n',
    'rules/team/a.md': '# core a\n',
    'rules/team/b.md': '# core b\n',
    'skills/team/SKILL.md': '---\nname: team\ndescription: core\n---\n',
    'skills/team/notes.md': 'core notes\n',
    ...extra,
  })
}
const consumer = (root, sources, profiles = ['team']) => {
  const repo = join(root, 'consumer')
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, LOCK), JSON.stringify({ sources, profiles, agents: ['claude'], levels: Object.fromEntries(profiles.map(p => [p, 'rules'])) }, null, 2) + '\n')
  return repo
}

test('an overlay replaces files by path, and a skill directory whole', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], {
      'rules/team/a.md': '# overlay a\n',
      'skills/team/SKILL.md': '---\nname: team\ndescription: overlay\n---\n',
    })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# overlay a\n', 'the overlay rule wins')
    assert.equal(read(repo, '.claude/rules/team/b.md'), '# core b\n', 'a rule file the overlay lacks stays core\'s')
    assert.equal(read(repo, '.claude/skills/team/SKILL.md'), '---\nname: team\ndescription: overlay\n---\n', 'the overlay skill wins')
    assert.deepEqual(readdirSync(join(repo, '.claude/skills/team')), ['SKILL.md'], 'no half skill: core\'s notes.md is not kept')
    assert.deepEqual(lockOf(repo).sources.map(s => s.name), ['core', 'team'])
    assert.deepEqual(Object.keys(lockOf(repo).installed.find(i => i.from === 'skills/team').files), ['.claude/skills/team/SKILL.md'])
    // The overlay's ref replays from the lock: a new overlay commit lands on update.
    team.commit({ 'rules/team/a.md': '# overlay a v2\n' })
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# overlay a v2\n')
  })
})

test('a path that is a file in one layer and a directory in another is refused', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], { 'rules/team/a.md/inner.md': '# a directory now\n' })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /source team: rules\/team\/a\.md is a directory, where an earlier layer has a file/)
    assert.deepEqual(readdirSync(repo), [LOCK], 'nothing emitted')
  })
})

test('registries merge in source order: an overlay-only profile, appended entries, a later alias', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const overlayReg = {
      profiles: {
        'team-extra': [{ from: 'rules/team-extra', to: '.claude/rules/team-extra', kind: 'rule' }],
        team: [{ from: 'rules/team-more', to: '.claude/rules/team-more', kind: 'rule' }],
      },
      aliases: { 'team-all': ['team', 'team-extra'], 'rust-api': ['rust'] },
    }
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify(overlayReg),
      'rules/team-extra/x.md': '# extra\n',
      'rules/team-more/m.md': '# more\n',
    })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['rust'])
    const r = ok(cli(['add', 'team-all'], repo))
    assert.match(r.stdout, /unpack team-all → team team-extra/)
    assert.equal(read(repo, '.claude/rules/team-extra/x.md'), '# extra\n', 'the overlay-only profile installs')
    assert.equal(read(repo, '.claude/rules/team-more/m.md'), '# more\n', 'an entry appended to a core profile installs')
    assert.ok(has(repo, '.claude/rules/team/a.md'), 'the core entries of that profile stay')
    const lock = lockOf(repo)
    assert.deepEqual(lock.profiles, ['rust', 'team', 'team-extra'])
    const by = from => lock.installed.find(i => i.from === from).source
    assert.equal(by('rules/team-extra'), 'team', 'an entry\'s source is the registry that declared it')
    assert.equal(by('rules/team-more'), 'team')
    assert.equal(by('rules/team'), 'core')
    // The later alias wins on the same key: rust-api is just rust here.
    ok(cli(['add', 'rust-api'], repo))
    assert.deepEqual(lockOf(repo).profiles, ['rust', 'team', 'team-extra'])
  })
})

test('an overlay registry of the wrong shape is refused before any write', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const cases = [[{ profiles: { team: 'rules/team' } }, /source team: registry\.json "profiles" must map names to lists/],
      // An alias the lock could not read back would make every later command fail.
      [{ aliases: { unused: [42] } }, /source team: registry\.json "aliases" must map names to lists of profile names/],
      [{ retired: { profiles: 'all of them' } }, /source team: registry\.json "retired" must be an object/]]
    for (const [i, [reg, why]] of cases.entries()) {
      const at = join(root, `case${i}`)
      mkdirSync(at)
      const team = makeSource(at, 'team', [], { 'registry.json': JSON.stringify(reg) })
      const repo = consumer(at, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
      const before = read(repo, LOCK)
      const r = cli(['update'], repo)
      assert.equal(r.status, 1)
      assert.match(r.stderr, why)
      assert.deepEqual(readdirSync(repo), [LOCK])
      assert.equal(read(repo, LOCK), before)
    }
  })
})

test('an overlay\'s exclude removes core paths from the merged tree, and update deletes their installed copies', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], { 'registry.json': JSON.stringify({ exclude: ['rules/team/b.md', 'skills/team'] }) })
    const coreOnly = [{ name: 'core', url: core.url, ref: 'main' }]
    const repo = consumer(root, coreOnly)
    ok(cli(['update'], repo))
    assert.ok(has(repo, '.claude/rules/team/b.md') && has(repo, '.claude/skills/team/SKILL.md'))

    const lock = lockOf(repo)
    lock.sources = [...coreOnly, { name: 'team', url: team.url, ref: 'main' }]
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
    const r = ok(cli(['update'], repo))
    assert.match(r.stdout, /− rules\/team\/b\.md {2}\(excluded by team\)/)
    assert.match(r.stdout, /− skills\/team {2}\(excluded by team\)/)
    assert.ok(!has(repo, '.claude/rules/team/b.md'), 'the excluded rule disappears')
    assert.ok(!has(repo, '.claude/skills/team'), 'the excluded skill disappears whole')
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# core a\n', 'the rest of the entry stays')
    const after = lockOf(repo)
    assert.ok(!after.installed.some(i => i.from === 'skills/team'), 'an entry excluded whole is not inventoried')
    assert.ok(!Object.keys(after.installed.find(i => i.from === 'rules/team').files).includes('.claude/rules/team/b.md'))
  })
})

test('an exclude inside a skill, or one that is not a plain relative path, is refused', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const cases = [[['skills/team/notes.md'], /exclude skills\/team\/notes\.md: a skill is excluded whole \(skills\/team\)/],
      [['../outside'], /source team: registry\.json "exclude" must be a list of relative paths/]]
    for (const [i, [exclude, why]] of cases.entries()) {
      const at = join(root, `case${i}`)
      mkdirSync(at)
      const team = makeSource(at, 'team', [], { 'registry.json': JSON.stringify({ exclude }) })
      const repo = consumer(at, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
      const r = cli(['update'], repo)
      assert.equal(r.status, 1, exclude[0])
      assert.match(r.stderr, why)
      assert.deepEqual(readdirSync(repo), [LOCK])
    }
  })
})

test('.dev/overrides/ is the last layer: a repo-owned rule survives update, and is never written or locked', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], { 'rules/common/language.md': '# team language\n' })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    const mine = '# Language\n\n- This repo writes in French.\n'
    mkdirSync(join(repo, '.dev/overrides/rules/common'), { recursive: true })
    writeFileSync(join(repo, '.dev/overrides/rules/common/language.md'), mine)
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/common/language.md'), mine, 'the project layer wins over every source')
    core.commit({ 'rules/common/language.md': '# Language v2\n' })
    ok(cli(['update'], repo))
    assert.equal(read(repo, '.claude/rules/common/language.md'), mine, 'and survives an upstream change')
    assert.equal(read(repo, '.dev/overrides/rules/common/language.md'), mine, 'never written')
    assert.deepEqual(readdirSync(join(repo, '.dev/overrides')), ['rules'])
    assert.deepEqual(lockOf(repo).sources.map(s => s.name), ['core', 'team'], 'no ref, no lock entry')
  })
})

test('add --source appends an overlay to the lock; remove --source drops it, its files and the profiles only it defined', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ profiles: { 'team-extra': [{ from: 'rules/team-extra', to: '.claude/rules/team-extra', kind: 'rule' }] } }),
      'rules/team-extra/x.md': '# extra\n',
      'rules/team/a.md': '# overlay a\n',
    })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }])
    ok(cli(['update'], repo))

    ok(cli(['add', 'team-extra', '--source', `team=${team.url}#main`], repo))
    let lock = lockOf(repo)
    assert.deepEqual(lock.sources, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    assert.deepEqual(lock.profiles, ['team', 'team-extra'])
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# overlay a\n')
    assert.ok(has(repo, '.claude/rules/team-extra/x.md'))

    const r = ok(cli(['remove', '--source', 'team'], repo))
    assert.match(r.stdout, /Dropping \[team-extra\]: no remaining source defines it/)
    lock = lockOf(repo)
    assert.deepEqual(lock.sources, [{ name: 'core', url: core.url, ref: 'main' }])
    assert.deepEqual(lock.profiles, ['team'])
    assert.ok(!has(repo, '.claude/rules/team-extra'), 'the overlay-only profile\'s files go')
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# core a\n', 'the file it overrode is core\'s again')
    assert.ok(!lock.installed.some(i => i.source === 'team'))
  })
})

test('--source refuses core, a source already locked, an unknown one, and a malformed value', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: core.url, ref: 'main' }])
    const before = read(repo, LOCK)
    for (const [args, why] of [
      [['add', '--source', `core=${core.url}#main`], /"core" is this library; pin it with --ref/],
      [['add', '--source', `team=${core.url}#main`], /source "team" is already locked; move it with --ref team=<ref>/],
      [['add', '--source', 'team-no-ref'], /--source team-no-ref: expected <name>=<url>#<ref>/],
      [['remove', '--source', 'nobody'], /source "nobody" is not locked\. Locked: core, team/],
      [['remove', '--source', 'core'], /source "core" cannot be removed; "remove all" uninstalls/],
    ]) {
      const r = cli(args, repo)
      assert.equal(r.status, 1, args.join(' '))
      assert.match(r.stderr, why)
    }
    assert.equal(read(repo, LOCK), before)
  })
})

test('doctor audits the inventory offline: an overlay-only profile passes, an edited or deleted file fails', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({ profiles: { 'team-extra': [{ from: 'rules/team-extra', to: '.claude/rules/team-extra', kind: 'rule' }] } }),
      'rules/team-extra/x.md': '# extra\n',
    })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['add', 'team-extra'], repo))
    writeFileSync(join(repo, 'CLAUDE.md'), '# Project\n')
    // No network, no source: doctor reads the lock and the disk only.
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })
    const clean = ok(cli(['doctor'], repo))
    assert.doesNotMatch(clean.stdout, /unknown to the registry/)
    assert.match(clean.stdout, /nothing to report/)

    writeFileSync(join(repo, '.claude/rules/team-extra/x.md'), '# extra, edited\n')
    let r = cli(['doctor'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.claude\/rules\/team-extra\/x\.md — edited since it was installed/)

    rmSync(join(repo, '.claude/rules/team/a.md'))
    r = cli(['doctor'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.claude\/rules\/team\/a\.md — installed by "team", missing on disk/)
  })
})

test('the lock records the merged aliases: an offline remove unpacks one only an overlay defined', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], {
      'registry.json': JSON.stringify({
        profiles: { 'team-extra': [{ from: 'rules/team-extra', to: '.claude/rules/team-extra', kind: 'rule' }] },
        aliases: { 'team-all': ['team', 'team-extra'] },
      }),
      'rules/team-extra/x.md': '# extra\n',
    })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['rust'])
    ok(cli(['add', 'team-all'], repo))
    assert.deepEqual(lockOf(repo).aliases['team-all'], ['team', 'team-extra'])
    assert.ok(!registry.aliases['team-all'], 'the bundled registry must not know it')
    for (const name of ['core', 'team']) rmSync(join(root, `${name}.git`), { recursive: true })

    const r = ok(cli(['remove', 'team-all'], repo))
    assert.match(r.stdout, /unpack team-all → team team-extra/)
    assert.deepEqual(lockOf(repo).profiles, ['rust'])
    assert.ok(!has(repo, '.claude/rules/team-extra') && !has(repo, '.claude/rules/team'))
    assert.deepEqual(lockOf(repo).aliases['team-all'], ['team', 'team-extra'], 'kept for the next remove')
  })
})

test('an entry no layer holds is refused, even when an exclude names a path inside it', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], { 'registry.json': JSON.stringify({
      profiles: { ghost: [{ from: 'rules/ghost', to: '.claude/rules/ghost', kind: 'rule' }] },
      exclude: ['rules/ghost/x.md'],
    }) })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    const before = read(repo, LOCK)
    const r = cli(['add', 'ghost'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /rules\/ghost: not found in source core, team/)
    assert.equal(read(repo, LOCK), before)
  })
})

// One source path, one installed copy: the inventory records files per `kind:from`, so
// two entries installing the same path to two places would share one record (ADR-0010:
// refused, not reconciled).
test('two entries that install the same source path to different destinations are refused', () => {
  withTmpRepo(root => {
    const core = makeSource(root, 'core', CORE_PATHS)
    const team = makeSource(root, 'team', [], { 'registry.json': JSON.stringify({
      profiles: { 'team-rust': [{ from: 'rules/rust', to: '.claude/rules/team-rust', kind: 'rule' }] },
    }) })
    const repo = join(root, 'consumer')
    mkdirSync(repo)
    writeLock(repo, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }])
    ok(cli(['update'], repo))
    const before = read(repo, LOCK)
    const r = cli(['add', 'team-rust'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /registry: rule:rules\/rust installs to \.claude\/rules\/rust and to \.claude\/rules\/team-rust: one source path installs once/)
    assert.equal(read(repo, LOCK), before)
    assert.ok(!has(repo, '.claude/rules/team-rust'))
  })
})

// A skill is one unit: a directory the install empties must hold nothing it did not
// write, whether the skill is excluded, dropped or removed.
test('a foreign file in a skill that an exclude or a remove empties is refused; --force removes it', () => {
  withTmpRepo(root => {
    const core = teamCore(root)
    const team = makeSource(root, 'team', [], { 'registry.json': JSON.stringify({ exclude: ['skills/team'] }) })
    const coreOnly = [{ name: 'core', url: core.url, ref: 'main' }]
    const repo = consumer(root, coreOnly, ['rust', 'team'])
    ok(cli(['update'], repo))
    writeFileSync(join(repo, '.claude/skills/team/custom.md'), 'mine\n')

    for (const args of [['remove', 'team'], ['update']]) {
      if (args[0] === 'update') {
        const lock = lockOf(repo)
        lock.sources = [...coreOnly, { name: 'team', url: team.url, ref: 'main' }]
        writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2) + '\n')
      }
      const before = read(repo, LOCK)
      const r = cli(args, repo)
      assert.equal(r.status, 1, args.join(' '))
      assert.match(r.stderr, /\.claude\/skills\/team\/custom\.md — not written by claude-rules, inside an installed directory/)
      assert.equal(read(repo, LOCK), before, `${args[0]}: lock unchanged`)
      assert.ok(has(repo, '.claude/skills/team/SKILL.md'), `${args[0]}: tree unchanged`)
    }
    ok(cli(['update', '--force'], repo))
    assert.ok(!has(repo, '.claude/skills/team'), '--force removes the listed file with the skill')
  })
})

// ------------------------------------------------------- overrides (phase 4)
// Every path a later layer replaces is recorded and printed (ADR-0008): a file, or a
// skill directory whole, hashed as the sorted list of its (path, sha256).
const sha = text => createHash('sha256').update(text).digest('hex')
const skillHash = files => sha(JSON.stringify(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([p, t]) => [p, sha(t)])))
function layered(root) {
  const core = teamCore(root)
  const team = makeSource(root, 'team', [], {
    'rules/team/a.md': '# overlay a\n',
    'skills/team/SKILL.md': '---\nname: team\ndescription: overlay\n---\n',
  })
  const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }, { name: 'team', url: team.url, ref: 'main' }], ['rust', 'team'])
  mkdirSync(join(repo, '.dev/overrides/rules/team'), { recursive: true })
  writeFileSync(join(repo, '.dev/overrides/rules/team/a.md'), '# mine a\n')
  writeFileSync(join(repo, '.dev/overrides/rules/team/b.md'), '# mine b\n')
  return { core, team, repo }
}

test('add and update record every override in the lock, with the base it replaced, and print it', () => {
  withTmpRepo(root => {
    const { repo } = layered(root)
    const expected = [
      { path: 'rules/team/a.md', by: 'team', over: 'core', baseHash: sha('# core a\n') },
      { path: 'rules/team/a.md', by: '.dev/overrides', over: 'team', baseHash: sha('# overlay a\n') },
      { path: 'rules/team/b.md', by: '.dev/overrides', over: 'core', baseHash: sha('# core b\n') },
      { path: 'skills/team', by: 'team', over: 'core', baseHash: skillHash({ 'SKILL.md': '---\nname: team\ndescription: core\n---\n', 'notes.md': 'core notes\n' }) },
    ]
    const byPath = list => [...list].sort((x, y) => `${x.path} ${x.by}`.localeCompare(`${y.path} ${y.by}`))
    for (const args of [['update'], ['add', 'team']]) {
      const r = ok(cli(args, repo))
      assert.deepEqual(byPath(lockOf(repo).overrides), byPath(expected), `${args[0]}: lock`)
      for (const o of expected) assert.ok(r.stdout.includes(`  ↻ ${o.path}  (${o.by} over ${o.over})`), `${args[0]}: prints ${o.path} by ${o.by}`)
      assert.ok(!/⚠/.test(r.stdout), `${args[0]}: nothing changed upstream, no warning`)
    }
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# mine a\n')
    // A single-source install has nothing to record.
    const plain = join(root, 'plain')
    mkdirSync(plain)
    const core = makeSource(plain, 'core', CORE_PATHS)
    const alone = join(plain, 'consumer')
    mkdirSync(alone)
    writeLock(alone, [{ name: 'core', url: core.url, ref: 'main' }])
    const r = ok(cli(['update'], alone))
    assert.equal(lockOf(alone).overrides, undefined)
    assert.ok(!r.stdout.includes('↻'))
  })
})

test('update warns when a replaced path changed in the layer under it; --strict fails and changes nothing', () => {
  withTmpRepo(root => {
    const { core, team, repo } = layered(root)
    ok(cli(['update'], repo))
    core.commit({ 'rules/team/a.md': '# core a v2\n', 'skills/team/notes.md': 'core notes v2\n' })
    team.commit({ 'rules/team/a.md': '# overlay a v2\n' })

    const before = read(repo, LOCK)
    const strict = cli(['update', '--strict'], repo)
    assert.equal(strict.status, 1, strict.stdout + strict.stderr)
    assert.ok(strict.stdout.includes('⚠ rules/team/a.md changed in core (overridden by team)'))
    assert.ok(strict.stdout.includes('⚠ rules/team/a.md changed in team (overridden by .dev/overrides)'))
    assert.ok(strict.stdout.includes('⚠ skills/team changed in core (overridden by team)'))
    assert.ok(!strict.stdout.includes('⚠ rules/team/b.md'), 'b.md did not change upstream')
    assert.match(strict.stderr, /--strict: 3 overridden path\(s\) changed upstream; nothing was changed/)
    assert.equal(read(repo, LOCK), before, 'lock unchanged')

    const r = ok(cli(['update'], repo))
    assert.ok(r.stdout.includes('⚠ rules/team/a.md changed in core (overridden by team)'), 'without --strict: a warning, and the install goes on')
    const base = lockOf(repo).overrides.find(o => o.path === 'rules/team/a.md' && o.by === 'team').baseHash
    assert.equal(base, sha('# core a v2\n'), 'the new base is recorded')
    // Recorded, so the next strict run passes.
    const again = ok(cli(['update', '--strict'], repo))
    assert.ok(!again.stdout.includes('⚠'))
  })
})

test('remove drops the overrides of the entries it removes', () => {
  withTmpRepo(root => {
    const { repo } = layered(root)
    mkdirSync(join(repo, '.dev/overrides/rules/common'), { recursive: true })
    writeFileSync(join(repo, '.dev/overrides/rules/common/language.md'), '# Language, mine\n')
    ok(cli(['update'], repo))
    ok(cli(['remove', 'team'], repo))
    assert.deepEqual(lockOf(repo).overrides, [{ path: 'rules/common/language.md', by: '.dev/overrides', over: 'core', baseHash: sha(read(REPO, 'rules/common/language.md')) }])
  })
})

// Staging one source path twice would replay every layer over a merged path, and record
// a layer replacing itself, or core replacing the project layer: refused (ADR-0010).
test('two entries whose source paths nest are refused before any write', () => {
  withTmpRepo(root => {
    const reg = JSON.parse(read(REPO, 'registry.json'))
    reg.profiles.team = [{ from: 'rules/common/language.md', to: '.claude/rules/extra.md', kind: 'rule' }]
    const core = makeSource(root, 'core', CORE_PATHS, { 'registry.json': JSON.stringify(reg, null, 2) + '\n' })
    const repo = consumer(root, [{ name: 'core', url: core.url, ref: 'main' }])
    const before = read(repo, LOCK)
    const r = cli(['update'], repo)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /rules\/common\/language\.md is inside rules\/common: a source path is staged once/)
    assert.equal(read(repo, LOCK), before)
    assert.deepEqual(readdirSync(repo), [LOCK], 'nothing emitted')
  })
})

test('an overridden file deleted in the layer under it warns too, and fails under --strict', () => {
  withTmpRepo(root => {
    const { core, repo } = layered(root)
    ok(cli(['update'], repo))
    // b.md leaves core, the overriding project layer still supplies it.
    spawnSync('git', ['rm', '-q', 'rules/team/b.md'], { cwd: join(root, 'core-work') })
    core.commit({})
    const before = read(repo, LOCK)
    const strict = cli(['update', '--strict'], repo)
    assert.equal(strict.status, 1, strict.stdout + strict.stderr)
    assert.ok(strict.stdout.includes('⚠ rules/team/b.md removed from core (overridden by .dev/overrides)'))
    assert.equal(read(repo, LOCK), before, 'lock unchanged')
    assert.equal(read(repo, '.claude/rules/team/b.md'), '# mine b\n')
    ok(cli(['update'], repo))
    assert.ok(!lockOf(repo).overrides.some(o => o.path === 'rules/team/b.md'), 'nothing is replaced there any more')
    ok(cli(['update', '--strict'], repo))

    // Three layers: a.md leaves core; team still supplies it, under the project layer.
    spawnSync('git', ['rm', '-q', 'rules/team/a.md'], { cwd: join(root, 'core-work') })
    core.commit({})
    const lock = read(repo, LOCK)
    const three = cli(['update', '--strict'], repo)
    assert.equal(three.status, 1, three.stdout + three.stderr)
    assert.ok(three.stdout.includes('⚠ rules/team/a.md removed from core (overridden by team)'))
    assert.equal(read(repo, LOCK), lock, 'lock unchanged')
    assert.equal(read(repo, '.claude/rules/team/a.md'), '# mine a\n')
  })
})
