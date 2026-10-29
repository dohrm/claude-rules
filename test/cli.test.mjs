// Black-box installer tests — spawn bin/cli.mjs against this working tree via
// --local (offline, no ref resolution), in a throwaway cwd, then assert the
// emitted tree. Black-box on purpose: these must survive a refactor of the
// emitters, and they cover the per-agent transforms end to end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, registry, runCli, runCliBare, withTmpRepo, read, has } from './helpers.mjs'

const lockOf = dir => JSON.parse(read(dir, '.claude-rules.lock'))
const ok = r => { assert.equal(r.status, 0, `cli failed (${r.status}):\n${r.stderr}${r.stdout}`); return r }

test('experience contracts ship for all targets and the installed document gate runs', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'product', 'agent', '--level', 'gates', '--agent', 'claude,codex,cursor'], dir))
    assert.ok(has(dir, '.claude/rules/product/experience.md'))
    assert.ok(has(dir, '.cursor/rules/product/experience.mdc'))
    assert.ok(has(dir, '.claude/skills/experience/SKILL.md'))
    assert.ok(has(dir, '.agents/skills/experience/SKILL.md'))
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs/EXPERIENCE.md'), '# Experience\n[Missing](experience/missing.md)\n')
    const r = spawnSync(process.execPath, [join(dir, '.dev/kit/common/docs-check.mjs')],
      { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stderr, /missing reference experience\/missing.md/)
  })
})

test('add rust --agent claude: rules only by default; common language and the CHANGELOG are the only shared', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))

    assert.equal(read(dir, '.claude/rules/rust/code-style.md'), read(REPO, 'rules/rust/code-style.md'))
    assert.ok(has(dir, '.claude/rules/rust/utf8-safety.md'))
    assert.ok(has(dir, '.claude/rules/common/language.md'), 'shared common rules missing')
    assert.equal(read(dir, '.dev/kit/CHANGELOG.md'), read(REPO, 'CHANGELOG.md'), '/update diffs this copy')
    assert.ok(!has(dir, '.claude/rules/agent/guardrails.md'), 'agent is a profile, not a gift')
    assert.ok(!has(dir, '.claude/agents/code-reviewer.md'))
    assert.ok(!has(dir, '.dev/kit/rust/deny.toml'), 'kit is --level gates')
    assert.ok(!has(dir, '.dev/kit/common/gate.just'))
    assert.ok(!has(dir, 'lefthook.yml'), 'the installer must never write build config')

    const lock = lockOf(dir)
    assert.deepEqual(lock.profiles, ['rust'])
    assert.equal(lock.levels.rust, 'rules')
    assert.deepEqual(lock.agents, ['claude'])
    assert.deepEqual(lock.sources, [{ name: 'core', url: `github:${registry.repo}`, ref: registry.defaultRef }])
    assert.ok(!('repo' in lock) && !('ref' in lock), 'sources replace repo + ref')
  })
})

// ADR-0008: the lock pins an ordered list of sources. A lock written before that
// (`repo` + `ref`) must still read, as core alone, and leave in the new shape.
test('a legacy { repo, ref } lock reads as core and is rewritten as sources', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    delete lock.sources
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify({ repo: 'someone/fork', ref: 'v0.9.0', ...lock }, null, 2) + '\n')
    const r = ok(runCli(['update', '--ref', 'v1.0.0'], dir))
    assert.match(r.stdout, /core@v1\.0\.0/)
    const next = lockOf(dir)
    assert.deepEqual(next.sources, [{ name: 'core', url: 'github:someone/fork', ref: 'v1.0.0' }])
    assert.ok(!('repo' in next) && !('ref' in next), 'repo/ref are not written again')
  })
})

test('--ref targets core; --ref <name>=<ref> must name a locked source', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--ref', 'v2.0.0'], dir))
    assert.equal(lockOf(dir).sources[0].ref, 'v2.0.0')
    const moved = ok(runCli(['update', '--ref', 'core=v2.1.0'], dir))
    assert.match(moved.stdout, /core {2}v2\.0\.0 → v2\.1\.0 {2}local \(no rev\)/, 'a --local run still shows the ref it moved')
    assert.equal(lockOf(dir).sources[0].ref, 'v2.1.0', 'core=<ref> is the long form of --ref <ref>')
    const pinned = lockOf(dir)
    pinned.sources[0].rev = 'b'.repeat(40)
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(pinned, null, 2) + '\n')
    const local = ok(runCli(['update'], dir))
    assert.equal(lockOf(dir).sources[0].ref, 'v2.1.0', 'without --ref, core replays its locked ref (#54)')
    assert.match(local.stdout, /core {2}v2\.1\.0 {2}local \(no rev\)/, 'a tree on disk is reported as local')
    assert.ok(!('rev' in lockOf(dir).sources[0]), 'and drops the recorded rev: a tree on disk is not that commit')
    const before = read(dir, '.claude-rules.lock')
    const r = runCli(['update', '--ref', 'team=v1'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /--ref names unknown source\(s\): team\. Locked: core/)
    assert.equal(read(dir, '.claude-rules.lock'), before, 'a refused update leaves the lock alone')
    const twice = runCli(['update', '--ref', 'v1', '--ref', 'core=v2'], dir)
    assert.equal(twice.status, 1)
    assert.match(twice.stderr, /--ref given twice for source "core"/)
  })
})

test('a lock whose sources do not start with core is refused', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    lock.sources = [{ name: 'team', url: 'file:///nowhere', ref: 'main' }, ...lock.sources]
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')
    const r = runCli(['update'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /the first source must be "core", found "team"/)
  })
})

test('add rust --level gates copies the kit; add agent --level gates copies kit/common', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
    assert.ok(has(dir, '.dev/kit/rust/rust.just'))
    assert.ok(!has(dir, '.dev/kit/common/gate.just'), 'common is the agent profile')
    assert.equal(lockOf(dir).levels.rust, 'gates')

    ok(runCli(['add', 'agent', '--level', 'gates', '--agent', 'claude'], dir))
    assert.ok(has(dir, '.claude/rules/agent/guardrails.md'))
    assert.ok(has(dir, '.claude/agents/code-reviewer.md'))
    assert.ok(has(dir, '.dev/kit/common/gate.just'))
    assert.equal(lockOf(dir).levels.agent, 'gates')
  })
})

test('add --agent cursor: path-scoped rules get globs, agent rules alwaysApply', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'rust', 'agent', '--level', 'gates', '--agent', 'cursor'], dir))

    const scoped = read(dir, '.cursor/rules/rust/code-style.mdc')
    assert.match(scoped, /^---\n/)
    assert.match(scoped, /globs:\n  - "\*\*\/\*\.rs"/)
    assert.match(scoped, /alwaysApply: false/)
    assert.match(scoped, /description: /)

    const crossCutting = read(dir, '.cursor/rules/agent/guardrails.mdc')
    assert.match(crossCutting, /alwaysApply: true/)
    assert.doesNotMatch(crossCutting, /globs:/)

    assert.ok(!has(dir, '.cursor/agents'))
    assert.match(r.stdout, /native subagent definitions are not emitted/)
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
  })
})

test('retired --agent names fail loudly', () => {
  withTmpRepo(dir => {
    for (const name of ['opencode', 'antigravity']) {
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
    for (const name of ['prd', 'architect', 'rfc', 'pre-mortem', 'onboard', 'interview', 'migrate', 'update']) {
      assert.ok(has(dir, `.claude/skills/${name}/SKILL.md`), `skill ${name} not installed`)
    }
    assert.equal(read(dir, '.claude/skills/prd/SKILL.md'), read(REPO, 'skills/prd/SKILL.md'))
  })
})

test('no --agent installs Claude and Codex', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust'], dir))
    assert.deepEqual(lockOf(dir).agents, ['claude', 'codex'])
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'))
    assert.ok(has(dir, '.agents/rules/rust/code-style.md'))
    assert.ok(!has(dir, '.cursor/rules'))
    assert.ok(!has(dir, '.dev/rules'))
    assert.ok(has(dir, 'AGENTS.md'))
    assert.ok(!has(dir, '.opencode'))
  })
})

// `add` used to write ONLY its arguments to the lock, so a second add dropped the
// first profile out of it while leaving its files on disk: invisible to `update`,
// and orphaned by `remove all` — which deletes the lock, leaving no way to find them.
test('add extends the lock instead of replacing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go', '--agent', 'claude'], dir))

    assert.deepEqual(lockOf(dir).profiles, ['agent', 'rust', 'go'])
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'), 'the first profile must survive a second add')
    assert.ok(has(dir, '.claude/rules/go/quality-gates.md'))
  })
})

test('add without --agent keeps the locked agent set (never widens to all)', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    ok(runCli(['add', 'go'], dir))

    assert.deepEqual(lockOf(dir).agents, ['claude'])
    assert.ok(!has(dir, '.cursor/rules'), 'a bare add must not start emitting for other agents')
  })
})

test('add --agent adds a target to the locked set, and back-fills the locked profiles', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    const r = ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude,cursor'], dir))
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
    assert.ok(!has(dir, '.claude/kit'), 'the kit must not land under an agent directory')
    assert.equal(r.stdout.split('kit/rust  \u2192').length - 1, 1, 'kit/rust copied twice')
  })
})

// An install that predates the move leaves .claude/kit/ behind, and a justfile still
// importing from it never sees an `update` again — the exact drift the move fixes. So
// add/update purge it, BY NAME: a directory the repo put there itself survives.
// Legacy trees go once, with the adoption that lists them (ADR-0010): a pre-RFC lock.
test('adoption purges the legacy .claude/kit, keeping what is not ours', () => {
  withTmpRepo(dir => {
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify({ repo: 'dohrm/claude-rules', ref: 'main', profiles: ['rust'], agents: ['claude'], levels: { rust: 'gates' } }) + '\n')

    mkdirSync(join(dir, '.claude/kit/rust'), { recursive: true })
    writeFileSync(join(dir, '.claude/kit/rust/deny.toml'), 'stale\n')
    mkdirSync(join(dir, '.claude/kit/mine'), { recursive: true })
    writeFileSync(join(dir, '.claude/kit/mine/notes.md'), 'mine\n')

    const r = ok(runCli(['update', '--force'], dir))
    assert.match(r.stdout, /^  ! \.claude\/kit\/rust$/m, 'listed before it goes')
    assert.ok(!has(dir, '.claude/kit/rust'), 'the legacy kit copy must go')
    assert.ok(has(dir, '.claude/kit/mine/notes.md'), 'only registry-known kit dirs may be deleted')
    assert.match(r.stdout, /\.claude\/kit/, 'a silent move leaves the reader with two trees')
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
  })
})

test('remove <profile> deletes only that profile and updates the lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', 'hexagonal', '--level', 'gates', '--agent', 'claude'], dir))
    assert.ok(has(dir, '.claude/rules/hexagonal/principle.md'))

    ok(runCliBare(['remove', 'hexagonal'], dir))
    assert.ok(!has(dir, '.claude/rules/hexagonal'), 'hexagonal rules should be gone')
    assert.ok(has(dir, '.claude/rules/rust/code-style.md'), 'rust must survive')
    assert.ok(has(dir, '.claude/rules/agent/guardrails.md'), 'agent survives a partial remove')
    assert.deepEqual(lockOf(dir).profiles, ['agent', 'rust'])
  })
})

// #48: a kept profile's overlay for the removed language is one install would not emit.
test('remove <stack> also removes that language\'s overlays in the kept profiles', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'go', 'hexagonal', '--agent', 'claude,cursor,codex'], dir))
    const overlays = ['.claude/rules/hexagonal/go.md', '.cursor/rules/hexagonal/go.mdc', '.agents/rules/hexagonal/go.md']
    for (const path of overlays) assert.ok(has(dir, path), `${path} installed`)

    ok(runCliBare(['remove', 'go'], dir))
    for (const path of overlays) assert.ok(!has(dir, path), `${path} removed with go`)
    const owned = lockOf(dir).installed.flatMap(i => Object.keys(i.files))
    assert.deepEqual(owned.filter(path => overlays.includes(path)), [], 'the lock no longer owns them')
    assert.ok(has(dir, '.claude/rules/hexagonal/rust.md') && has(dir, '.cursor/rules/hexagonal/rust.mdc'), 'the kept language\'s overlay stays')
    assert.ok(has(dir, '.claude/rules/hexagonal/principle.md'), 'a language-free rule stays')
  })
})

test('remove <stack> refuses an edited overlay of that language unless --force', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'go', 'hexagonal', '--agent', 'claude'], dir))
    const overlay = '.claude/rules/hexagonal/go.md'
    writeFileSync(join(dir, overlay), read(dir, overlay) + '\nmine\n')

    assert.equal(runCliBare(['remove', 'go'], dir).status, 1)
    assert.ok(has(dir, overlay), 'an edit is never deleted silently')
    ok(runCliBare(['remove', 'go', '--force'], dir))
    assert.ok(!has(dir, overlay))
  })
})

test('adoption purges leftover trees from retired agent targets', () => {
  withTmpRepo(dir => {
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify({ repo: 'dohrm/claude-rules', ref: 'main', profiles: ['rust'], agents: ['claude'], levels: { rust: 'gates' } }) + '\n')

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

    const r = ok(runCli(['update', '--force'], dir))
    assert.match(r.stdout, /^  ! \.opencode$/m, 'listed before it goes')
    assert.ok(!has(dir, '.dev/rules'), 'Codex/opencode rule copies must go')
    assert.ok(!has(dir, '.opencode'), 'the opencode tree must go')
    assert.ok(has(dir, '.agents/rules'), 'unowned Codex bridge must survive')
    assert.match(read(dir, 'AGENTS.md'), /retired block/, 'unselected bridge is preserved')
    assert.match(r.stdout, /retired/)
  })
})

test('update drops a retired profile from an old lock; its adoption purges retired skills', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'product', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    lock.profiles = [...lock.profiles, 'goal-setup']
    lock.modules['.'] = [...lock.modules['.'], 'goal-setup']
    lock.levels = { ...lock.levels, 'goal-setup': 'rules' }
    for (const record of lock.installed) delete record.files   // an old lock: no hashes
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')
    mkdirSync(join(dir, '.claude/skills/plan'), { recursive: true })
    writeFileSync(join(dir, '.claude/skills/plan/SKILL.md'), '---\nname: plan\n---\n')

    const r = ok(runCli(['update', '--force'], dir))
    const after = lockOf(dir)
    assert.ok(!after.profiles.includes('goal-setup'))
    assert.ok(!after.modules['.'].includes('goal-setup'))
    assert.ok(!('goal-setup' in (after.levels || {})))
    assert.equal(r.stdout.match(/Dropped retired profile "goal-setup"/g)?.length, 1)
    assert.ok(!has(dir, '.claude/skills/plan'))
    assert.ok(has(dir, '.claude/skills/rfc/SKILL.md'))
  })
})

// `investigate` was released; `bug` only lived on `next`. The rewrite below turns every
// "defect" into the old name, aliases included, so `stale` lists the aliases that lock
// could not have had: the next-era lock keeps `investigate: ['bug']`, as it did.
for (const [old, stale] of [['investigate', ['investigate', 'bug']], ['bug', ['bug']]]) {
  test(`a lock that installed \`${old}\` updates to \`defect\`; \`${old}\` stays an alias`, () => {
    withTmpRepo(dir => {
      // Rewrite a fresh `defect` install into what the release that called it `old` wrote.
      ok(runCli(['add', 'defect', '--agent', 'claude,codex'], dir))
      const lock = JSON.parse(read(dir, '.claude-rules.lock')
        .replace(/skills\/defect\b/g, `skills/${old}`).replace(/"defect"/g, `"${old}"`))
      for (const name of stale) delete lock.aliases[name]
      writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')
      for (const root of ['.claude/skills', '.agents/skills']) {
        mkdirSync(join(dir, root, old), { recursive: true })
        writeFileSync(join(dir, root, old, 'SKILL.md'), read(dir, root, 'defect/SKILL.md'))
        rmSync(join(dir, root, 'defect'), { recursive: true })
      }

      ok(runCli(['update'], dir))
      const after = lockOf(dir)
      assert.deepEqual(after.profiles, ['defect'])
      assert.deepEqual(after.modules['.'], ['defect'])
      assert.deepEqual([after.aliases.investigate, after.aliases.bug], [['defect'], ['defect']],
        'the old lock\'s aliases are rewritten, not kept')
      for (const root of ['.claude/skills', '.agents/skills']) {
        assert.ok(has(dir, `${root}/defect/SKILL.md`), `${root}/defect installed`)
        assert.ok(!has(dir, `${root}/${old}`), `${root}/${old} removed`)
      }

      ok(runCli(['remove', old], dir))
      assert.ok(!has(dir, '.claude/skills/defect') && !has(dir, '.agents/skills/defect'), 'the old name removes the new skill')
    })
  })
}

test('update drops retired agents from an old lock', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    lock.agents = ['claude', 'cursor', 'antigravity', 'codex', 'opencode']
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')

    const r = ok(runCli(['update'], dir))
    assert.deepEqual(lockOf(dir).agents, ['claude', 'cursor', 'codex'])
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    ok(runCli(['update'], dir))
    const lock = lockOf(dir)
    assert.deepEqual(lock.profiles, ['agent', 'rust'])
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

test('bare add with no TTY still errors instead of waiting on the interactive prompt', () => {
  withTmpRepo(dir => {
    const r = runCli(['add'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Usage: add <profile\.\.\.>/)
    assert.ok(!has(dir, '.claude-rules.lock'))
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

    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    assert.match(ok(runCliBare(['list'], dir)).stdout, /Installed: \[agent, rust\]/)
  })
})

test('init assembles justfile + lefthook from the installed kit', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', 'ts', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'cicd', 'product', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    rmSync(join(dir, '.claude/rules/rust'), { recursive: true })

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.claude\/rules\/rust — promised by "rust" for claude, missing on disk/)
  })
})

test('doctor fails on assets no locked profile explains', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))

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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    writeFileSync(join(dir, '.claude/settings.json'), read(dir, '.dev/kit/common/hooks/settings.snippet.json'))
    rmSync(join(dir, '.dev/kit/common/hooks/bash-guard.mjs'))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /wires .*bash-guard\.mjs, which is not on disk/)
  })
})

test('doctor fails on leftover trees from retired agent targets', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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

    assert.deepEqual(lockOf(dir).modules, { '.': [], 'apps/api': ['rust', 'api'] })
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /paths:\n {2}- "apps\/api\/\*\*\/\*\.rs"/)
    assert.match(read(dir, '.cursor/rules/api/rust.mdc'), /globs:\n {2}- "apps\/api\/\*\*\/\*\.rs"/)
  })
})

test('a profile no module claims stays repo-wide', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))
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

test('an install with no --module records explicit root membership', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    assert.deepEqual(lockOf(dir).modules, { '.': ['agent', 'rust'] })
  })
})

test('--module extends the map instead of replacing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCli(['add', 'ts', '--module', 'apps/web'], dir))

    assert.deepEqual(lockOf(dir).modules, { '.': [], 'apps/api': ['rust'], 'apps/web': ['ts'] })
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /- "apps\/api\/\*\*\/\*\.rs"/, 'the first module must survive')
    assert.match(read(dir, '.claude/rules/ts/code-style.md'), /- "apps\/web\/\*\*\/\*\.ts"/)
  })
})

test('--root never anchors agent or product: their docs are one shared repo-root tree', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'rust', 'agent', 'product', '--level', 'gates', '--agent', 'claude', '--root', 'apps/portal'], dir))

    assert.match(r.stdout, /agent, product stay repo-wide/)
    assert.deepEqual(lockOf(dir).modules, { '.': ['agent', 'product'], 'apps/portal': ['rust'] })
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /- "apps\/portal\/\*\*\/\*\.rs"/)
    // Both spellings survive: the unprefixed one is what guarantees a repo-root
    // docs/adr/ matches on a loader that does not treat `**/` as zero segments.
    const adr = read(dir, '.claude/rules/agent/decision-records.md')
    assert.match(adr, /- "docs\/adr\/\*\*\/\*\.md"/, 'the unprefixed path must survive')
    assert.match(adr, /- "\*\*\/docs\/adr\/\*\*\/\*\.md"/, 'agent must stay unscoped')
    assert.match(read(dir, '.claude/rules/product/documents.md'), /- "docs\/\*\*\/\*\.md"/, 'product must stay unscoped')
  })
})

// The same rule at glob granularity, for a profile ROOT_FORBID cannot cover: `ops`
// legitimately anchors ops/delivery.md to a module, but ops/slo.md also names the
// shared docs/ tree — anchoring THAT glob makes the rule match nothing.
test('--root leaves a shared docs/ glob unanchored while anchoring its siblings', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'ops', '--agent', 'claude,cursor', '--root', 'apps/api'], dir))

    const slo = read(dir, '.claude/rules/ops/slo.md')
    assert.match(slo, /- "\*\*\/docs\/\*\*\/\*\.md"/, 'the docs/ glob must stay repo-wide')
    assert.match(slo, /- "apps\/api\/\*\*\/\*slo\*"/, 'its non-docs siblings must still anchor')
    assert.doesNotMatch(slo, /apps\/api\/\*\*\/docs/, 'no anchored docs/ glob')

    // and the same through the Cursor transform, which renames the key
    const mdc = read(dir, '.cursor/rules/ops/slo.mdc')
    assert.match(mdc, /- "\*\*\/docs\/\*\*\/\*\.md"/)
    assert.match(mdc, /- "apps\/api\/\*\*\/\*alert\*"/)

    // a profile with no docs/ glob is unaffected
    assert.match(read(dir, '.claude/rules/ops/delivery.md'), /- "apps\/api\/\*\*\/\*\.rs"/)
  })
})

test('doctor fails when a lock has agent or product wrongly anchored to a module', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'agent', '--level', 'gates', '--agent', 'claude', '--module', 'apps/portal'], dir))
    const lock = lockOf(dir)
    lock.modules['.'] = lock.modules['.'].filter(p => p !== 'agent')
    lock.modules['apps/portal'].push('agent')          // simulate the pre-fix bug directly in the lock
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /module "apps\/portal" claims "agent", whose rules anchor to one shared repo-root docs tree/)
  })
})

test('remove drops the module bindings of the profiles it removes', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'api', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCliBare(['remove', 'api'], dir))

    assert.deepEqual(lockOf(dir).modules, { '.': [], 'apps/api': ['rust'] })
  })
})

// The installer deletes only what it wrote (ADR-0010): a file it never recorded is the
// repo's, kept alongside the installed rules; one it wrote and upstream dropped is
// pruned (test/ownership.test.mjs).
test('update keeps a file it did not write in a rule directory', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    writeFileSync(join(dir, '.claude/rules/rust/mine.md'), '---\ntitle: x\n---\nmine\n')

    ok(runCli(['update'], dir))
    assert.ok(has(dir, '.claude/rules/rust/mine.md'), 'never recorded, so never deleted')
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
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))
    ok(runCliBare(['init'], dir))

    const md = read(dir, 'CLAUDE.md')
    assert.match(md, /\| `apps\/api` \| rust \| `just rust-check` \|/)
    assert.match(md, /just check/)
    assert.doesNotMatch(md, /autonomy\.md/, 'agent is not installed — do not point at a missing rule')

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
    ok(runCli(['add', 'python', 'testing', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'python', '--level', 'gates', '--agent', 'claude'], dir))
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
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'cursor'], dir))
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
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))
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
    assert.match(r.stdout, /always-on rules \(1\)/)
    assert.match(r.stdout, /common\/language\.md/)
    assert.match(r.stdout, /rust\/code-style\.md.*apps\/api\/\*\*\/\*\.rs/)
    assert.match(r.stdout, /total/)
    assert.doesNotMatch(r.stdout, /ts\/code-style\.md/, 'a TS rule must not show up for a .rs file')
  })
})

test('budget shows the module anchor doing its job', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--level', 'gates', '--agent', 'claude', '--module', 'apps/api'], dir))

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

test('doctor warns about an unselected AGENTS.md bridge without removing it', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'agent', 'rust', '--level', 'gates', '--agent', 'claude'], dir))
    writeFileSync(join(dir, 'CLAUDE.md'), '# p\n')
    writeFileSync(join(dir, 'AGENTS.md'), [
      '# Mine',
      '<!-- claude-rules:start (managed — do not edit inside this block) -->',
      'retired',
      '<!-- claude-rules:end -->',
    ].join('\n'))

    const r = runCliBare(['doctor'], dir)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /AGENTS\.md has a managed block outside the selected targets/)
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
      { '.': [], 'apps/web': ['ts', 'react', 'portal-flat', 'portal-http'], 'apps/mobile': ['ts', 'react'] })
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

test('aliases unpack on add; lock stores the atoms', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'rust-api', '--agent', 'claude'], dir))
    assert.match(r.stdout, /unpack rust-api/)
    assert.deepEqual(lockOf(dir).profiles, ['rust', 'hexagonal', 'api', 'backend'])
    assert.ok(has(dir, '.claude/rules/hexagonal/principle.md'))
    assert.ok(has(dir, '.claude/rules/api/rust.md'))
  })
})

test('python-api unpacks and emits the python HTTP/hexagonal rules', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'python-api', '--agent', 'claude'], dir))
    assert.match(r.stdout, /unpack python-api/)
    assert.deepEqual(lockOf(dir).profiles, ['python', 'hexagonal', 'api', 'backend'])
    assert.ok(has(dir, '.claude/rules/api/python.md'))
    assert.ok(has(dir, '.claude/rules/hexagonal/python.md'))
    assert.ok(!has(dir, '.claude/rules/api/rust.md'), 'no Rust here — the rule can never fire')
    assert.ok(!has(dir, '.dev/kit/python'), 'kit is --level gates')
  })
})

test('--root is the same lever as --module', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude', '--root', 'apps/api'], dir))
    assert.match(read(dir, '.claude/rules/rust/code-style.md'), /- "apps\/api\/\*\*\/\*\.rs"/)
    assert.deepEqual(lockOf(dir).modules, { '.': [], 'apps/api': ['rust'] })
  })
})

test('a language-glob profile without --root is hinted, not blocked', () => {
  withTmpRepo(dir => {
    const r = ok(runCli(['add', 'ops', '--agent', 'claude'], dir))
    assert.match(r.stdout, /--root/)
    assert.ok(has(dir, '.claude/rules/ops/slo.md'))
  })
})

test('legacy lock without levels migrates agent at gates', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--agent', 'claude'], dir))
    const lock = lockOf(dir)
    delete lock.levels
    writeFileSync(join(dir, '.claude-rules.lock'), JSON.stringify(lock, null, 2) + '\n')
    const r = ok(runCli(['update'], dir))
    assert.match(r.stdout, /agent is now a profile/)
    const next = lockOf(dir)
    assert.ok(next.profiles.includes('agent'))
    assert.equal(next.levels.rust, 'gates')
    assert.equal(next.levels.agent, 'gates')
    assert.ok(has(dir, '.dev/kit/rust/deny.toml'))
    assert.ok(has(dir, '.dev/kit/common/gate.just'))
  })
})

// Without kit/common there are no marker recipes, so the dependency form is the only
// one that resolves — and rust-mutate's `from` defaulting to `base` is what keeps it working.
test('init writes mutate-diff live at --level ratchet', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', '--level', 'ratchet', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))
    assert.match(read(dir, 'justfile'), /^mutate-diff: rust-mutate$/m)
  })
})

// With kit/common, `mutate-diff` MUST be a body that feeds the marker in and advances it
// on the way out. The dependency form silently ran every mutator over the whole branch
// and never wrote `.work/<slug>/.latest_mutate`, so the incremental economy diff-since.mjs
// exists for was dead on arrival for mutation — while code-review, one self-contained
// recipe that marks at its end, worked. Found by running it, not by reading it.
test('init wires mutate-diff to the marker when kit/common is installed', () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'agent', '--level', 'ratchet', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))
    const just = read(dir, 'justfile')
    assert.match(just, /^mutate-diff:$/m, 'must be a recipe body, not a dependency list')
    assert.match(just, /^ {4}just .*rust-mutate "\$\(just base=\{\{quote\(base\)\}\} mutate-from\)"$/m, 'the range must come from the marker')
    // Last line, and only reached when every mutator above it passed: just stops a recipe
    // at the first failure, so a surviving mutant leaves the marker where it was.
    const body = just.split(/^mutate-diff:$/m)[1].trim().split('\n').map(l => l.trim())
    assert.equal(body[body.length - 1], 'just mutate-mark', 'mutate-mark must run last')
  })
})

// The generated body run for real, a stub `cargo` recording what reached it. A nested
// `just` re-reads its variables from the files: before #70, `just mutate_jobs=7
// mutate-diff` ran `-j 2`, and a `base=` from the command line never reached the range.
const JUST = spawnSync('just', ['--version'], { encoding: 'utf8' })
test('mutate-diff hands base, mutate_jobs and mutate_args to the nested just', { skip: JUST.error ? 'just not installed' : false }, () => {
  withTmpRepo(dir => {
    ok(runCli(['add', 'rust', 'agent', '--level', 'ratchet', '--agent', 'claude'], dir))
    ok(runCliBare(['init'], dir))
    const sh = (cmd, env = {}) => spawnSync('bash', ['-e', '-c', cmd], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } })
    const git = 'git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null'
    // Two commits on the branch; `base=` names the first, so only `after.rs` is in range.
    assert.equal(sh(`git init -q -b feat && echo a > before.rs && git add -A && ${git} commit -q -m one`
      + ` && git tag basepoint && echo b > after.rs && git add after.rs && ${git} commit -q -m two`).status, 0)
    mkdirSync(join(dir, 'stub'))
    writeFileSync(join(dir, 'stub/cargo'), '#!/bin/sh\necho "$@" > "$RECORD/args"\ncp pr.diff "$RECORD/diff"\n', { mode: 0o755 })
    const r = sh('just mutate_jobs=7 mutate_args=--foo base=basepoint mutate-diff',
      { PATH: `${join(dir, 'stub')}:${process.env.PATH}`, RECORD: dir })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const args = read(dir, 'args')
    assert.match(args, /(^|\s)-j 7(\s|$)/, `mutate_jobs: ${args}`)
    assert.match(args, /(^|\s)--foo(\s|$)/, `mutate_args: ${args}`)
    const diff = read(dir, 'diff')
    assert.match(diff, /after\.rs/, 'the range starts at the base passed on the command line')
    assert.doesNotMatch(diff, /before\.rs/, 'the base passed on the command line, not origin/main')

    // An empty base is what CI gets from a failed `ci-base`: refused, never an empty
    // diff that mutates nothing and passes.
    rmSync(join(dir, 'args'))
    const empty = sh('just base= rust-mutate', { PATH: `${join(dir, 'stub')}:${process.env.PATH}`, RECORD: dir })
    assert.equal(empty.status, 1, 'never 2 or 3: the CI step tolerates those as findings')
    assert.match(empty.stderr, /range start is empty/)
    assert.ok(!existsSync(join(dir, 'args')), 'cargo must not run on an empty range')
  })
})
