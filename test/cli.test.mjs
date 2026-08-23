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
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
    assert.ok(has(dir, '.dev/kit/common/gate.just'), 'the gate library ships with kit/common')
    assert.ok(has(dir, '.dev/kit/rust/rust.just'), "and one per tech, with that tech's kit")
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

test('retired --agent names fail loudly', () => {
  withTmpRepo(dir => {
    for (const name of ['codex', 'opencode', 'antigravity']) {
      const r = runCli(['add', 'rust', '--agent', name], dir)
      assert.equal(r.status, 1)
      assert.match(r.stderr, /Retired agent/)
      assert.ok(!has(dir, '.claude-rules.lock'), `${name} must not write a lock`)
    }
  })
})

test('add product: skills land as <name>/SKILL.md directories', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'product', '--agent', 'claude'], dir))
    for (const name of ['prd', 'architect', 'plan', 'tasks', 'pre-mortem']) {
      assert.ok(has(dir, `.claude/skills/${name}/SKILL.md`), `skill ${name} not installed`)
    }
    assert.equal(read(dir, '.claude/skills/prd/SKILL.md'), read(REPO, 'skills/prd/SKILL.md'))
  })
})

test('no --agent installs both remaining agents', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust'], dir))
    assert.deepEqual(lockOf(dir).agents, ['claude', 'cursor'])
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'))
    assert.ok(has(dir, '.cursor/rules/rust/code-style.mdc'))
    assert.ok(!has(dir, '.agents/rules'))
    assert.ok(!has(dir, '.dev/rules'))
    assert.ok(!has(dir, 'AGENTS.md'))
    assert.ok(!has(dir, '.opencode'))
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
    assert.ok(!has(dir, '.dev/kit/rust'))
  })
})

// The kit is the one kind no emitter transforms, so it has ONE agent-neutral home.
// Two agents must therefore yield one tree, not two identical ones — and the log must
// say so once, or the next reader assumes there is a second copy somewhere.
test('the kit has one home whatever the agents, and is copied once', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'rust', '--agent', 'claude,cursor'], dir))
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
    assert.ok(!has(dir, '.claude/kit'), 'the kit must not land under an agent directory')
    assert.equal(r.stdout.split('kit/rust  \u2192').length - 1, 1, 'kit/rust copied twice')
  })
})

// An install that predates the move leaves .claude/kit/ behind, and a justfile still
// importing from it never sees an `update` again — the exact drift the move fixes. So
// add/update purge it, BY NAME: a directory the repo put there itself survives.
test('add purges the legacy .claude/kit, keeping what is not ours', () => {
  withTmpRepo(dir => {
    mkdirSync(join(dir, '.claude/kit/rust'), { recursive: true })
    writeFileSync(join(dir, '.claude/kit/rust/deny.toml'), 'stale\n')
    mkdirSync(join(dir, '.claude/kit/mine'), { recursive: true })
    writeFileSync(join(dir, '.claude/kit/mine/notes.md'), 'mine\n')

    const r = ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    assert.ok(!has(dir, '.claude/kit/rust'), 'the legacy kit copy must go')
    assert.ok(has(dir, '.claude/kit/mine/notes.md'), 'only registry-known kit dirs may be deleted')
    assert.match(r.stdout, /\.claude\/kit/, 'a silent move leaves the reader with two trees')
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
  })
})

test('remove <profile> deletes only that profile and updates the lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'hexagonal', '--agent', 'claude'], dir))
    assert.ok(has(dir, '.claude/rules/hexagonal/principle.md'))

    ok(runCliBare(['remove', 'hexagonal'], dir))
    assert.ok(!has(dir, '.claude/rules/hexagonal'), 'hexagonal rules should be gone')
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'), 'rust must survive')
    assert.ok(has(dir, '.claude/rules/agent/guardrails.md'), 'shared must survive a partial remove')
    assert.deepEqual(lockOf(dir).profiles, ['rust'])
  })
})

test('add/update purge leftover trees from retired agent targets', () => {
  withTmpRepo(dir => {
    mkdirSync(join(dir, '.dev/rules/rust'), { recursive: true })
    writeFileSync(join(dir, '.dev/rules/rust/code-style.md'), 'stale\n')
    mkdirSync(join(dir, '.opencode/agent'), { recursive: true })
    writeFileSync(join(dir, '.opencode/agent/code-reviewer.md'), 'stale\n')
    mkdirSync(join(dir, '.agents/rules/rust'), { recursive: true })
    writeFileSync(join(dir, '.agents/rules/rust/code-style.md'), 'stale\n')
    writeFileSync(join(dir, 'AGENTS.md'), [
      '# Mine',
      '',
      '<!-- claude-rules:start (managed — do not edit inside this block) -->',
      'retired block',
      '<!-- claude-rules:end -->',
      '',
    ].join('\n'))

    const r = ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    assert.ok(!has(dir, '.dev/rules'), 'Codex/opencode rule copies must go')
    assert.ok(!has(dir, '.opencode'), 'the opencode tree must go')
    assert.ok(!has(dir, '.agents/rules'), 'Antigravity rules must go')
    assert.equal(read(dir, 'AGENTS.md').trim(), '# Mine', 'user AGENTS.md content must survive the strip')
    assert.match(r.stdout, /retired/)
  })
})

test('update drops retired agents from an old lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    lock.agents = ['claude', 'cursor', 'antigravity', 'codex', 'opencode']
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')

    const r = ok(runCli(['update'], dir))
    assert.deepEqual(lockOf(dir).agents, ['claude', 'cursor'])
    assert.match(r.stdout, /Dropped retired agent/)
    assert.ok(!has(dir, '.dev/rules'))
    assert.ok(!has(dir, '.opencode'))
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

    // The generated justfile is the COMPOSITION: the imports, the dirs, and `check`
    // derived from the locked techs. The recipes themselves stay in the library, so
    // this file must NOT contain them.
    const just = read(dir, 'justfile')
    assert.match(just, /^check: rust-check ts-check$/m)
    assert.match(just, /^import '\.dev\/kit\/common\/gate\.just'$/m)
    assert.match(just, /^import '\.dev\/kit\/rust\/rust\.just'$/m)
    assert.match(just, /^import '\.dev\/kit\/ts\/ts\.just'$/m)
    assert.match(just, /^set allow-duplicate-recipes := true$/m, 'without it the repo cannot override a library recipe')
    assert.match(just, /^set allow-duplicate-variables := true$/m)
    assert.ok(!/^rust-check:/m.test(just), 'a recipe in this file would fork the library')
    assert.ok(!/^rust-lint:/m.test(just))
    const lefthook = read(dir, 'lefthook.yml')
    assert.match(lefthook, /pre-commit:/)
    assert.match(lefthook, /run: just rust-lint/)
    assert.match(lefthook, /run: just ts-check/)
    // The git floor ships with the generated file: a floor nobody wired is not a floor.
    assert.match(lefthook, /no-commit-on-trunk:/)
    assert.match(lefthook, /- ref: main/)
  })
})

// The trunk guard is not about a language, so it must not wait for one to be locked.
// A justfile holding its own copy of a library recipe is the drift the import exists to
// kill: the copy is frozen at install time. doctor WARNS rather than fails — an install
// that predates the library is in exactly this state, and migrating is the human's call.
test('doctor warns about a justfile that redefines the library instead of importing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    writeFileSync(join(dir, 'justfile'), 'rust_dir := "."\ncheck: rust-check\nrust-check:\n    @echo mine\n')

    const r = runCliBare(['doctor'], dir)
    assert.match(r.stdout, /does not import \.dev\/kit\/rust\/rust\.just/)
    assert.match(r.stdout, /redefines 1 of its recipes \(rust-check\)/)
    assert.match(r.stdout, /README\.md/, 'a warning without the migration pointer is a dead end')

    // Importing it clears the warning — the check is about the import, not the file's age.
    writeFileSync(join(dir, 'justfile'), "import '.dev/kit/rust/rust.just'\nimport '.dev/kit/common/gate.just'\ncheck: rust-check\n")
    assert.doesNotMatch(runCliBare(['doctor'], dir).stdout, /does not import/)
  })
})

// A documents-only install (`cicd` ships a kit directory with no `.just` in it at all)
// must still get a coherent file: no `check` claiming to gate nothing, and above all no
// hint naming a recipe no import provides — `mutate-diff: rust-mutate` in a repo with no
// Rust sends the reader at a recipe that does not exist.
test('init writes no invented recipe when no language is locked', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'cicd', 'product', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))

    const just = read(dir, 'justfile')
    assert.match(just, /^import '\.dev\/kit\/common\/gate\.just'$/m, 'the cross-language gates still apply')
    assert.ok(!/^check:/m.test(just), 'a `check` with no dependency would be green for nothing')
    assert.ok(!/rust-mutate/.test(just), 'no import provides it — the hint would be a dead end')
    assert.ok(!/mutate-diff/.test(just), 'nothing to aggregate, so the whole Tier-3 block is absent')
  })
})

test('init writes the git floor even with no language in the lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'product', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))
    const lefthook = read(dir, 'lefthook.yml')
    assert.match(lefthook, /no-commit-on-trunk:/)
    assert.doesNotMatch(lefthook, /pre-push:/, 'no tech is locked, so there is no -check recipe to trigger')
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
    // the shared rules include one scoped to docs/adr/ — without a record, it
    // legitimately can never fire, and doctor says so
    mkdirSync(join(dir, 'docs/adr'), { recursive: true })
    writeFileSync(join(dir, 'docs/adr/0001-x.md'), '- **Status**: Proposed\n')

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

// ------------------------------------------------- doctor: the gate layer
// The audit's whole value is telling "not wired" (a choice) apart from "wired to
// nothing" (drift that looks installed). So: opt-in absence is a notice and never
// scores; a reference that resolves to no file is a problem.

test('doctor notices the harness guards are installed but unwired, and confirms them once merged', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))

    const unwired = ok(runCliBare(['doctor'], dir))
    assert.match(unwired.stdout, /claude: harness guards installed .* but nothing wires them/)
    // Opt-in: declining the harness layer is a choice, so it is a notice and never
    // a scored warning — otherwise `--strict` in `just check` nags about a decision.
    const warnings = unwired.stdout.split('\nWarnings')[1] || ''
    assert.doesNotMatch(warnings, /wires them|harness/, 'an opt-in absence must not be scored as a warning')

    writeFileSync(join(dir, '.claude/settings.json'), read(dir, '.dev/kit/common/hooks/settings.snippet.json'))
    const wired = ok(runCliBare(['doctor'], dir))
    assert.match(wired.stdout, /✓ claude: guards wired in \.claude\/settings\.json/)
  })
})

test('doctor fails when a wired guard is not on disk', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    writeFileSync(join(dir, '.claude/settings.json'), read(dir, '.dev/kit/common/hooks/settings.snippet.json'))
    rmSync(join(dir, '.dev/kit/common/hooks/bash-guard.mjs'))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /wires .*bash-guard\.mjs, which is not on disk/)
  })
})

test('doctor fails on leftover trees from retired agent targets', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    writeFileSync(join(dir, 'CLAUDE.md'), '# p\n')
    mkdirSync(join(dir, '.dev/rules/rust'), { recursive: true })
    writeFileSync(join(dir, '.dev/rules/rust/code-style.md'), 'stale\n')

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.dev\/rules/)
    assert.match(r.stdout, /retired agent target/)
  })
})

test('doctor fails on a lefthook.yml git was never told about', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    mkdirSync(join(dir, '.git/hooks'), { recursive: true })
    writeFileSync(join(dir, 'lefthook.yml'), 'pre-commit:\n  commands:\n    no-commit-on-trunk:\n      run: exit 1\n')

    const inert = runCliBare(['doctor'], dir)
    assert.equal(inert.status, 1)
    assert.match(inert.stdout, /git is not calling it/)

    writeFileSync(join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\nlefthook run pre-commit\n')
    const r = ok(runCliBare(['doctor'], dir))
    assert.match(r.stdout, /✓ lefthook\.yml \(git calls it\)/)
    // The floor is opt-out by design, so a missing review-guard trigger only informs.
    assert.match(r.stdout, /no `review-guard` trigger/)
  })
})

// -------------------------------------------------------------- module scope
// `**/*.ts` is too coarse in a monorepo: it makes the Fastify rules load on a
// React component. `--module` anchors a profile's globs to a directory.

test('--module anchors the profile globs, for Claude and Cursor alike', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'api', '--agent', 'claude,cursor', '--module', 'apps/api'], dir))

    assert.deepEqual(lockOf(dir).modules, { 'apps/api': ['rust', 'api'] })
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /paths:\n {2}- "apps\/api\/\*\*\/\*\.rs"/)
    assert.match(read(dir, '.cursor/rules/api/rust.mdc'), /globs:\n {2}- "apps\/api\/\*\*\/\*\.rs"/)
  })
})

test('a profile no module claims stays repo-wide', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCli(['add', 'testing'], dir))

    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /- "apps\/api\/\*\*\/\*\.rs"/)
    assert.match(read(dir, '.claude/rules/testing/strategy.md'), /- "\*\*\/\*\.rs"/, 'unscoped profile must not be anchored')
  })
})

test('a rule whose every glob targets an unlocked language is not emitted', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'api', 'backend', '--agent', 'claude'], dir))

    assert.ok(has(dir, '.claude/rules/api/rust.md'), 'the locked language must be emitted')
    assert.ok(!has(dir, '.claude/rules/api/go.md'), 'no Go here — the rule can never fire')
    assert.ok(!has(dir, '.claude/rules/api/node.md'))
    // A rule that ALSO covers a locked language stays whole: its dead glob costs
    // nothing and starts working the day that language arrives.
    assert.match(read(dir, '.claude/rules/backend/config.md'), /- "\*\*\/\*\.go"/)
  })
})

test('an install with no --module writes a lock with no modules key', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    assert.ok(!('modules' in lockOf(dir)), 'an unscoped install must stay byte-compatible with older locks')
  })
})

test('--module extends the map instead of replacing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCli(['add', 'ts', '--module', 'apps/web'], dir))

    assert.deepEqual(lockOf(dir).modules, { 'apps/api': ['rust'], 'apps/web': ['ts'] })
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /- "apps\/api\/\*\*\/\*\.rs"/, 'the first module must survive')
    assert.match(read(dir, '.claude/rules/ts/code-style.md'), /- "apps\/web\/\*\*\/\*\.ts"/)
  })
})

test('remove drops the module bindings of the profiles it removes', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'api', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCliBare(['remove', 'api'], dir))

    assert.deepEqual(lockOf(dir).modules, { 'apps/api': ['rust'] })
  })
})

test('update clears a rule directory instead of leaving orphans in it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    writeFileSync(join(dir, '.claude/rules/rust/dropped-upstream.md'), '---\ntitle: x\n---\nstale\n')

    ok(runCli(['update'], dir))
    assert.ok(!has(dir, '.claude/rules/rust/dropped-upstream.md'), 'a rule dir is library-owned; update must not leave orphans')
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'))
    // kit is the "copy and own" surface — update must NOT wipe what the repo added.
    writeFileSync(join(dir, '.dev/kit/rust/mine.toml'), 'x = 1\n')
    ok(runCli(['update'], dir))
    assert.ok(has(dir, '.dev/kit/rust/mine.toml'), 'kit is owned by the repo, not the installer')
  })
})

// ---------------------------------------------------------------- init, again
// `init` owns delimited sections, never whole files: a repo may already have a
// justfile, and a CLAUDE.md is the human's from the moment it exists.

test('init derives the *_dir block from the lock modules, and nothing outside it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCliBare(['init'], dir))

    const just = read(dir, 'justfile')
    assert.match(just, /rust_dir\s+:= "apps\/api"/)
    // Only the LOCKED techs: an unimported library's variable would be dead weight,
    // and the library ships its own default anyway.
    assert.ok(!/go_dir/.test(just), 'go is not locked, so nothing reads go_dir')
    assert.ok(!/python_dir/.test(just))
    assert.match(just, /^check: rust-check$/m, 'content outside the block must survive')
  })
})

// Nothing declared, nothing derived — and re-running init must reproduce the file it
// wrote, or the "managed block" promise is a rewrite lottery.
test('init is idempotent on the justfile it generated', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))
    const first = read(dir, 'justfile')
    assert.match(first, /rust_dir\s+:= "\."/, 'no module declared: the repo root')
    ok(runCliBare(['init'], dir))
    assert.equal(read(dir, 'justfile'), first)
  })
})

// A justfile that predates the library holds the recipes inline. init must not rewrite
// it — only say what to add, and how to prove the migration lost nothing.
test('init reports the missing imports on a pre-library justfile', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    const legacy = 'rust_dir := "api"\ncheck: rust-check\nrust-check:\n    @echo mine\n'
    writeFileSync(join(dir, 'justfile'), legacy)
    const r = ok(runCliBare(['init'], dir))

    assert.equal(read(dir, 'justfile'), legacy, "the repo's justfile is never rewritten")
    assert.match(r.stdout, /import '\.dev\/kit\/common\/gate\.just'/)
    assert.match(r.stdout, /import '\.dev\/kit\/rust\/rust\.just'/)
    assert.match(r.stdout, /set allow-duplicate-variables := true/)
    assert.match(r.stdout, /--summary/, 'the equivalence proof is the point of the report')
  })
})

test('init writes a CLAUDE.md once and never rewrites it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCliBare(['init'], dir))

    const md = read(dir, 'CLAUDE.md')
    assert.match(md, /\| `apps\/api` \| rust \| `just rust-check` \|/)
    assert.match(md, /just check/)

    writeFileSync(join(dir, 'CLAUDE.md'), '# mine\n')
    const r = ok(runCliBare(['init'], dir))
    assert.equal(read(dir, 'CLAUDE.md'), '# mine\n', 'the installer must never rewrite CLAUDE.md')
    assert.match(r.stdout, /left untouched/)
  })
})

// A generated `check` that ran cargo in a python-only repo would leave the locked tech
// out of the one command the agent closes its loop on. It is derived from the lock.
test('init derives the check recipe from the locked language profiles', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'python', 'testing', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))

    const just = read(dir, 'justfile')
    assert.match(just, /^check: python-check$/m, 'the locked tech must be in the gate')
    assert.ok(!/^check:.*rust-check/m.test(just), 'a repo with no Rust must not run cargo')
    assert.ok(!/^python-check:/m.test(just), 'the recipe stays in the library')
    assert.match(read(dir, 'lefthook.yml'), /just python-check/)
  })
})

test('init reports check drift instead of rewriting an existing justfile', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'python', '--agent', 'claude'], dir))
    writeFileSync(join(dir, 'justfile'), 'check: rust-check adr-check\nrust-check:\n    @echo mine\n')

    const r = ok(runCliBare(['init'], dir))
    assert.equal(read(dir, 'justfile'), 'check: rust-check adr-check\nrust-check:\n    @echo mine\n', "the repo's justfile is never rewritten")
    assert.match(r.stdout, /does not run python-check/)
    assert.match(r.stdout, /runs rust-check, which no locked profile provides/)
    assert.ok(!/adr-check, which no locked/.test(r.stdout), 'a non-language dep the repo added is not drift')
  })
})

test('init writes no CLAUDE.md when claude is not a target', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'cursor'], dir))
    ok(runCliBare(['init'], dir))
    assert.ok(!has(dir, 'CLAUDE.md'))
  })
})

test('doctor fails on a module path that does not exist', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/typo'], dir))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /module "apps\/typo" does not exist/)
  })
})

test('doctor reads module-anchored globs against the real tree', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))
    mkdirSync(join(dir, 'apps/api/src'), { recursive: true })
    writeFileSync(join(dir, 'apps/api/src/main.rs'), 'fn main() {}\n')
    writeFileSync(join(dir, 'CLAUDE.md'), '# p\n')
    mkdirSync(join(dir, 'docs/adr'), { recursive: true })
    writeFileSync(join(dir, 'docs/adr/0001-x.md'), '- **Status**: Proposed\n')

    assert.match(ok(runCliBare(['doctor'], dir)).stdout, /every path-scoped rule matches at least one file/)

    // the same .rs file OUTSIDE the module must not keep the anchored rules alive
    rmSync(join(dir, 'apps/api/src'), { recursive: true })
    mkdirSync(join(dir, 'elsewhere'), { recursive: true })
    writeFileSync(join(dir, 'elsewhere/main.rs'), 'fn main() {}\n')
    assert.match(runCliBare(['doctor'], dir).stdout, /can never load/)
  })
})

// -------------------------------------------------------------------- budget
// "What does opening this file cost me?" — the question every context decision
// turns on. Same inputs as doctor: the emitted rules and their globs.

test('budget <path> lists what loads for that file, and what it costs', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'ts', '--agent', 'claude', '--module', 'apps/api'], dir))

    const r = ok(runCliBare(['budget', 'apps/api/src/main.rs'], dir))
    assert.match(r.stdout, /Context for apps\/api\/src\/main\.rs/)
    assert.match(r.stdout, /always-on rules \(4\)/)
    assert.match(r.stdout, /rust\/code-style\.md.*apps\/api\/\*\*\/\*\.rs/)
    assert.match(r.stdout, /total/)
    assert.doesNotMatch(r.stdout, /ts\/code-style\.md/, 'a TS rule must not show up for a .rs file')
  })
})

test('budget shows the module anchor doing its job', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--module', 'apps/api'], dir))

    assert.match(ok(runCliBare(['budget', 'apps/api/src/main.rs'], dir)).stdout, /rust\/code-style\.md/)
    // the same extension outside the module gets nothing — that is the whole point
    const outside = ok(runCliBare(['budget', 'scripts/tool.rs'], dir)).stdout
    assert.match(outside, /path-scoped rules \(0\)/)
    assert.match(outside, /no path-scoped rule matches/)
  })
})

test('budget with no path reports the session floor', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'product', '--agent', 'claude'], dir))

    const r = ok(runCliBare(['budget'], dir))
    assert.match(r.stdout, /Session floor/)
    assert.match(r.stdout, /skills, descriptions \(\d+\)/)
    assert.doesNotMatch(r.stdout, /path-scoped rules/, 'with no path there is nothing path-scoped to count')
  })
})

test('budget without an install exits 1', () => {
  withTmpRepo(dir => {
    const r = runCliBare(['budget'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /run "add <profile\.\.\.>" first/)
  })
})

test('doctor fails on a leftover AGENTS.md managed block', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    writeFileSync(join(dir, 'CLAUDE.md'), '# p\n')
    writeFileSync(join(dir, 'AGENTS.md'), [
      '# Mine',
      '<!-- claude-rules:start (managed — do not edit inside this block) -->',
      'retired',
      '<!-- claude-rules:end -->',
    ].join('\n'))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /AGENTS\.md still has a claude-rules managed block/)
  })
})

test('react is its own profile, so it can be anchored where portal-flat is not', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'ts', 'react', 'portal-flat', 'portal-http', '--agent', 'claude', '--module', 'apps/web'], dir))
    ok(runCli(['add', 'ts', 'react', '--module', 'apps/mobile'], dir))

    // Rules of Hooks apply to every React tree — web portal AND React Native
    const react = read(dir, '.claude/rules/react/quality-gates.md')
    assert.match(react, /- "apps\/web\/\*\*\/\*\.tsx"/)
    assert.match(react, /- "apps\/mobile\/\*\*\/\*\.tsx"/)
    // the portal architecture stays on the web side
    const portal = read(dir, '.claude/rules/portal-flat/principle.md')
    assert.doesNotMatch(portal, /apps\/mobile/, 'a React Native app is not a flat-domain portal')
    assert.deepEqual(lockOf(dir).modules,
      { 'apps/web': ['ts', 'react', 'portal-flat', 'portal-http'], 'apps/mobile': ['ts', 'react'] })
  })
})

// The transport is a separate axis from the architecture: two apps share the layer
// rules while their contradicting transports (HTTP cache vs IPC stores) never meet
// on the same file. Bundling the transport into `portal-flat` made that impossible.
test('portal transports are separable, and never load on each other files', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'ts', 'react', 'portal-flat', 'portal-http', '--agent', 'claude', '--module', 'apps/web'], dir))
    ok(runCli(['add', 'ts', 'react', 'portal-flat', 'tauri', '--module', 'apps/desktop'], dir))

    // the shared architecture is anchored to BOTH
    const principle = read(dir, '.claude/rules/portal-flat/principle.md')
    assert.match(principle, /- "apps\/web\/\*\*\/\*\.ts"/)
    assert.match(principle, /- "apps\/desktop\/\*\*\/\*\.ts"/)

    // …while each transport stays on its own app
    const http = read(dir, '.claude/rules/portal-http/state.md')
    assert.doesNotMatch(http, /apps\/desktop/, 'the TanStack cache policy must not reach a Tauri app')
    const tauri = read(dir, '.claude/rules/tauri/app.md')
    assert.doesNotMatch(tauri, /apps\/web/, 'Zustand/IPC rules must not reach the web portal')
    // tauri governs TypeScript — it describes stores and IPC wrappers, not Rust
    assert.match(tauri, /- "apps\/desktop\/\*\*\/\*\.tsx?"/)
  })
})
