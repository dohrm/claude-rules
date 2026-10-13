// Layered sources (ADR-0008), offline. Every source is a local bare repository
// reached through a `file://` URL, so the installer's real fetch path — `git init`,
// `git fetch --depth 1 <url> <ref>`, `checkout FETCH_HEAD` — runs with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, cpSync, readdirSync, existsSync, symlinkSync } from 'node:fs'
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
    // They must still read the lock; remove works from the lock's inventory.
    assert.match(ok(cli(['list'], repo)).stdout, /Installed: \[rust, team-only\]/)
    const doc = cli(['doctor'], repo)
    assert.equal(doc.status, 1)
    assert.match(doc.stdout, /profile "team-only", unknown to the registry bundled with this CLI/)
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
