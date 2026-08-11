// Black-box installer tests — spawn bin/cli.mjs against this working tree via
// --local (offline, no ref resolution), in a throwaway cwd, then assert the
// emitted tree. Black-box on purpose: these must survive a refactor of the
// emitters, and they cover the per-agent transforms end to end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, registry, runCli, runCliBare, withTmpRepo, read, has } from './helpers.mjs'

const lockOf = dir => JSON.parse(read(dir, '.claude-rules.lock'))
const ok = r => { assert.equal(r.status, 0, `cli failed (${r.status}):\n${r.stderr}${r.stdout}`); return r }

test('add rust --agent claude: verbatim rules, kit, agents, shared, lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))

    // rules are copied byte-for-byte for Claude (no transform)
    assert.equal(read(dir, '.claude/rules/rust/code-style.md'), read(REPO, 'rules/rust/code-style.md'))
    assert.ok(has(dir, '.claude/rules/rust/utf8-safety.md'))
    // shared assets come along with any profile
    assert.ok(has(dir, '.claude/rules/agent/guardrails.md'), 'shared agent rules missing')
    assert.ok(has(dir, '.claude/rules/common/language.md'), 'shared common rules missing')
    assert.ok(has(dir, '.claude/agents/code-reviewer.md'), 'shared subagents missing')
    // kit is copied, not merged
    assert.ok(has(dir, '.claude/kit/rust/deny.toml'))
    assert.ok(has(dir, '.claude/kit/common/justfile.snippet'))
    assert.ok(!has(dir, 'lefthook.yml'), 'the installer must never write build config')

    const lock = lockOf(dir)
    assert.deepEqual(lock.profiles, ['rust'])
    assert.deepEqual(lock.agents, ['claude'])
    assert.equal(lock.ref, registry.defaultRef)
    assert.equal(lock.repo, registry.repo)
  })
})

test('add --agent cursor: path-scoped rules get globs, cross-cutting ones alwaysApply', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'rust', '--agent', 'cursor'], dir))

    const scoped = read(dir, '.cursor/rules/rust/code-style.mdc')
    assert.match(scoped, /^---\n/)
    assert.match(scoped, /globs:\n  - "\*\*\/\*\.rs"/)
    assert.match(scoped, /alwaysApply: false/)
    assert.match(scoped, /description: /)

    const crossCutting = read(dir, '.cursor/rules/agent/guardrails.mdc')
    assert.match(crossCutting, /alwaysApply: true/)
    assert.doesNotMatch(crossCutting, /globs:/)

    // Cursor has no file-based subagents: the agent entry is skipped, with a note.
    assert.ok(!has(dir, '.cursor/agents'))
    assert.match(r.stdout, /no file-based subagents/)
    // skills and kit go to the agent-neutral locations
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
  })
})

test('add --agent codex: AGENTS.md block is idempotent and never touches user content', () => {
  withTmpRepo(dir => {
    writeFileSync(join(dir, 'AGENTS.md'), '# My repo\n\nHand-written guidance the installer must preserve.\n')

    ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
    const first = read(dir, 'AGENTS.md')
    assert.match(first, /^# My repo\n/, 'user content must stay at the top')
    assert.match(first, /Hand-written guidance the installer must preserve\./)
    assert.match(first, /<!-- claude-rules:start/)
    assert.match(first, /<!-- claude-rules:end -->/)
    // cross-cutting rules are inlined, path-scoped ones are referenced
    assert.match(first, /Path-scoped rules/)
    assert.match(first, /\.agents\/rules\/rust\/code-style\.md/)
    assert.ok(has(dir, '.agents/rules/rust/code-style.md'))

    ok(runCli(['add', 'rust', '--agent', 'codex'], dir))
    assert.equal(read(dir, 'AGENTS.md'), first, 'second install must be byte-identical (managed block rewritten in place)')
  })
})

test('add product: skills land as <name>/SKILL.md directories', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'product', '--agent', 'claude'], dir))
    for (const name of ['prd', 'architect', 'plan', 'pre-mortem']) {
      assert.ok(has(dir, `.claude/skills/${name}/SKILL.md`), `skill ${name} not installed`)
    }
    assert.equal(read(dir, '.claude/skills/prd/SKILL.md'), read(REPO, 'skills/prd/SKILL.md'))
  })
})

test('no --agent installs every known agent', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust'], dir))
    assert.deepEqual(lockOf(dir).agents, ['claude', 'cursor', 'codex', 'opencode'])
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'))
    assert.ok(has(dir, '.cursor/rules/rust/code-style.mdc'))
    assert.ok(has(dir, 'AGENTS.md'))
    assert.ok(has(dir, '.opencode/agent/code-reviewer.md'))
    assert.match(read(dir, '.opencode/agent/code-reviewer.md'), /mode: subagent/)
  })
})

// `add` used to write ONLY its arguments to the lock, so a second add dropped the
// first profile out of it while leaving its files on disk: invisible to `update`,
// and orphaned by `remove all` — which deletes the lock, leaving no way to find them.
test('add extends the lock instead of replacing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go', '--agent', 'claude'], dir))

    assert.deepEqual(lockOf(dir).profiles, ['rust', 'go'])
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'), 'the first profile must survive a second add')
    assert.ok(has(dir, '.claude/rules/go/quality-gates.md'))
  })
})

test('add without --agent keeps the locked agent set (never widens to all)', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go'], dir))

    assert.deepEqual(lockOf(dir).agents, ['claude'])
    assert.ok(!has(dir, '.cursor/rules'), 'a bare add must not start emitting for other agents')
  })
})

test('add --agent adds a target to the locked set, and back-fills the locked profiles', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go', '--agent', 'cursor'], dir))

    assert.deepEqual(lockOf(dir).agents, ['claude', 'cursor'])
    // the profile that predates the new agent must exist for it too, or the lock lies
    assert.ok(has(dir, '.cursor/rules/rust/code-style.mdc'), 'locked profile not emitted for the new agent')
    assert.ok(has(dir, '.claude/rules/go/quality-gates.md'), 'new profile not emitted for the locked agent')
  })
})

// (empty parent dirs like .claude/rules/ may remain — assets are what must go)
test('remove all after several adds deletes every installed asset', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go', '--agent', 'claude'], dir))
    ok(runCliBare(['remove', 'all'], dir))

    assert.ok(!has(dir, '.claude-rules.lock'))
    assert.ok(!has(dir, '.claude/rules/rust'), 'first-added profile orphaned by the uninstall')
    assert.ok(!has(dir, '.claude/rules/go'))
    assert.ok(!has(dir, '.claude/kit/rust'))
  })
})

test('remove <profile> deletes only that profile and updates the lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'hexagonal', '--agent', 'claude'], dir))
    assert.ok(has(dir, '.claude/rules/hexagonal/principle.md'))
    assert.ok(has(dir, '.claude/skills/rust-add-domain/SKILL.md'))

    ok(runCliBare(['remove', 'hexagonal'], dir))
    assert.ok(!has(dir, '.claude/rules/hexagonal'), 'hexagonal rules should be gone')
    assert.ok(!has(dir, '.claude/skills/rust-add-domain'), 'hexagonal skill should be gone')
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'), 'rust must survive')
    assert.ok(has(dir, '.claude/rules/agent/guardrails.md'), 'shared must survive a partial remove')
    assert.deepEqual(lockOf(dir).profiles, ['rust'])
  })
})

test('remove <profile> prunes only that profile from the AGENTS.md block', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'hexagonal', '--agent', 'codex'], dir))
    assert.match(read(dir, 'AGENTS.md'), /\.agents\/rules\/hexagonal\//)

    ok(runCliBare(['remove', 'hexagonal'], dir))
    const agentsMd = read(dir, 'AGENTS.md')
    assert.doesNotMatch(agentsMd, /\.agents\/rules\/hexagonal\//, 'stale reference left behind')
    assert.match(agentsMd, /\.agents\/rules\/rust\//, 'rust reference must survive')
    assert.ok(!has(dir, '.agents/rules/hexagonal'))
  })
})

test('remove all uninstalls everything including shared and the lock', () => {
  withTmpRepo(dir => {
    writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n')
    ok(runCli(['add', 'rust'], dir))
    ok(runCliBare(['remove', 'all'], dir))

    assert.ok(!has(dir, '.claude-rules.lock'))
    assert.ok(!has(dir, '.claude/rules/rust'))
    assert.ok(!has(dir, '.claude/rules/agent'), 'shared rules must go on a full uninstall')
    assert.ok(!has(dir, '.claude/agents'))
    assert.ok(!has(dir, '.cursor/rules/rust'))
    assert.equal(read(dir, 'AGENTS.md').trim(), '# Mine', 'user content must survive the uninstall')
  })
})

test('update replays the locked profiles and agents', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCli(['update'], dir))
    const lock = lockOf(dir)
    assert.deepEqual(lock.profiles, ['rust'])
    assert.deepEqual(lock.agents, ['claude'], 'update must not widen the agent set')
    assert.ok(!has(dir, '.cursor/rules'))
  })
})

test('unknown profile and unknown agent fail loudly', () => {
  withTmpRepo(dir => {
    const bad = runCli(['add', 'nope'], dir)
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /Unknown profile\(s\): nope/)
    assert.ok(!has(dir, '.claude-rules.lock'), 'a failed add must not write a lock')

    const badAgent = runCli(['add', 'rust', '--agent', 'emacs'], dir)
    assert.equal(badAgent.status, 1)
    assert.match(badAgent.stderr, /Unknown agent\(s\): emacs/)
  })
})

test('remove without a lock exits 1', () => {
  withTmpRepo(dir => {
    const r = runCliBare(['remove', 'rust'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /nothing to remove/i)
  })
})

test('list shows every registry profile and the installed state', () => {
  withTmpRepo(dir => {
    const before = ok(runCliBare(['list'], dir))
    for (const p of Object.keys(registry.profiles)) assert.match(before.stdout, new RegExp(`\\b${p}\\b`))
    assert.match(before.stdout, /Installed: none/)

    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    assert.match(ok(runCliBare(['list'], dir)).stdout, /Installed: \[rust\]/)
  })
})

test('init assembles justfile + lefthook from the installed kit', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'ts', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))

    assert.equal(read(dir, 'justfile'), read(REPO, 'kit/common/justfile.snippet'))
    const lefthook = read(dir, 'lefthook.yml')
    assert.match(lefthook, /pre-commit:/)
    assert.match(lefthook, /run: just rust-lint/)
    assert.match(lefthook, /run: just ts-check/)
  })
})

test('init without a lock exits 1', () => {
  withTmpRepo(dir => {
    const r = runCliBare(['init'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /run "add <profile\.\.\.>" first/)
  })
})

test('no args prints usage without failing', () => {
  withTmpRepo(dir => {
    const r = ok(runCliBare([], dir))
    assert.match(r.stdout, /claude-rules — usage:/)
    assert.ok(!existsSync(join(dir, '.claude-rules.lock')))
  })
})

// ------------------------------------------------------------------- doctor
// `doctor` is offline and deterministic: it reads the lock, the registry and the
// files on disk. These tests drive it through each verdict it can reach.

test('doctor on a coherent install reports nothing and exits 0', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/main.rs'), 'fn main() {}\n')
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n')

    const r = ok(runCliBare(['doctor'], dir))
    assert.match(r.stdout, /nothing to report/)
    assert.match(r.stdout, /every path-scoped rule matches at least one file/)
  })
})

test('doctor fails when the lock promises a destination that is not on disk', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    rmSync(join(dir, '.claude/rules/rust'), { recursive: true })

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.claude\/rules\/rust — promised by "rust" for claude, missing on disk/)
  })
})

test('doctor fails on assets no locked profile explains', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    // What a pre-80c5344 `add` left behind: files on disk, absent from the lock.
    mkdirSync(join(dir, '.claude/rules/go'), { recursive: true })
    writeFileSync(join(dir, '.claude/rules/go/logging.md'), '---\npaths:\n  - "**/*.go"\n---\nx\n')

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.claude\/rules\/go — on disk but nothing in the lock explains it/)
  })
})

test('doctor warns (not fails) on rules whose globs match no file, and --strict promotes it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'go', '--agent', 'claude'], dir))   // a repo with no .go file
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n')

    const r = ok(runCliBare(['doctor'], dir))
    assert.match(r.stdout, /can never load/)
    assert.match(r.stdout, /go\/quality-gates\.md/)
    assert.match(r.stdout, /0 problem\(s\), 1 warning\(s\)/)

    assert.equal(runCliBare(['doctor', '--strict'], dir).status, 1, '--strict must fail on warnings')
  })
})

test('doctor reports the always-on budget and a missing CLAUDE.md', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/main.rs'), 'fn main() {}\n')

    const r = ok(runCliBare(['doctor'], dir))
    assert.match(r.stdout, /Context budget \(always-on\)/)
    assert.match(r.stdout, /rules\s+\d+ files/)
    assert.match(r.stdout, /agent\/decisions\.md/, 'the heaviest always-on rule should be named')
    assert.match(r.stdout, /no CLAUDE\.md/)
  })
})

test('doctor without a lock exits 1', () => {
  withTmpRepo(dir => {
    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /nothing to audit/)
  })
})
