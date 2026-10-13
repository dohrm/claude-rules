// Layered sources (ADR-0008), offline. Every source is a local bare repository
// reached through a `file://` URL, so the installer's real fetch path — `git init`,
// `git fetch --depth 1 <url> <ref>`, `checkout FETCH_HEAD` — runs with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, cpSync, readdirSync, existsSync } from 'node:fs'
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
  })
})
