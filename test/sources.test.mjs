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
    // They must still read the lock — and remove must refuse rather than guess.
    assert.match(ok(cli(['list'], repo)).stdout, /Installed: \[rust, team-only\]/)
    const doc = cli(['doctor'], repo)
    assert.equal(doc.status, 1)
    assert.match(doc.stdout, /profile "team-only", unknown to the registry bundled with this CLI/)
    const before = read(repo, LOCK)
    const rm = cli(['remove', 'all'], repo)
    assert.equal(rm.status, 1)
    assert.match(rm.stderr, /does not know \[team-only\]/)
    assert.equal(read(repo, LOCK), before)
    assert.ok(has(repo, '.claude/rules/team-only/house.md') && has(repo, '.claude/rules/rust/code-style.md'), 'nothing deleted')
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
    assert.match(r.stderr, /registry entry "\.\.\/outside" must be a relative path inside the source/)
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
