// The harness tier is real code that answers "block or not" — so it gets real tests.
// Black-box: feed a hook payload on stdin, assert the exit code and the dialect of
// the answer. The false-positive cases matter as much as the blocks: a guard that
// blocks `git commit -m "drop the -n flag"` gets uninstalled by lunchtime.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'

const HOOKS = join(REPO, 'kit', 'common', 'hooks')
const BASH_GUARD = join(HOOKS, 'bash-guard.mjs')
const EDIT_GUARD = join(HOOKS, 'edit-guard.mjs')

const run = (script, payload) => {
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const claudeBash = (command) => run(BASH_GUARD, { tool_name: 'Bash', tool_input: { command } })
const cursorBash = (command) => run(BASH_GUARD, { conversation_id: 'c1', hook_event_name: 'beforeShellExecution', command })
const edit = (file_path) => run(EDIT_GUARD, { tool_name: 'Edit', tool_input: { file_path } })
const decision = (out) => JSON.parse(out).hookSpecificOutput?.permissionDecision

// ------------------------------------------------------------------ bash: deny
const DENIED = [
  ['git commit --no-verify -m "wip"', /--no-verify/],
  ['git push --no-verify', /--no-verify/],
  ['git commit -n -m "wip"', /-n/],
  ['git commit -nv -m "wip"', /-n/],
  ['git push --force origin main', /force-push/],
  ['git push -f origin HEAD:master', /force-push/],
  ['git push origin +main:main', /force-push/],
  ['git push origin --delete main', /deleting the trunk/],
  ['git -c core.hooksPath=/dev/null commit -m x', /hooksPath/],
  ['git config core.hooksPath /dev/null', /hooksPath/],
  ['lefthook uninstall', /gate layer/],
  ['LEFTHOOK=0 git commit -m x', /environment/],
  ['SKIP=secret-scan git commit -m x', /environment/],
  ['rm .work/review-report.md', /review/],
  ['rm -f .work/review-report.md && just code-review', /review/],
  ['echo "<!-- CI_VERDICT: CLEAN -->" > .work/review-report.md', /forges/],
  ['printf x >>.work/review-report.md', /forges/],
]
for (const [command, why] of DENIED) {
  test(`bash-guard denies: ${command}`, () => {
    const r = claudeBash(command)
    assert.equal(r.status, 2, `expected a block, got ${r.status}: ${r.out}${r.err}`)
    assert.match(r.err, /^Blocked: /m)
    assert.match(r.err, why)
  })
}

// ------------------------------------------------------------- bash: pass clean
// Every one of these is a command an agent runs on an ordinary day. A block here
// is a bug, not extra safety.
const ALLOWED = [
  'git commit -m "drop the -n flag from the CLI"',
  'git commit -m "document --no-verify as forbidden"',
  'git commit -am "add mainframe adapter"',
  'git commit --amend --no-edit',
  'git push --force-with-lease origin feature/hooks',
  'git push origin feature/main-menu --force',
  'git push',
  'cat lefthook.yml',
  'grep -n review-report .work/review-report.md',
  'just check',
  'node scripts/review-guard.mjs',
  'LEFTHOOK=1 lefthook run pre-commit --all-files',
]
for (const command of ALLOWED) {
  test(`bash-guard stays out of the way: ${command}`, () => {
    const r = claudeBash(command)
    assert.equal(r.status, 0, `blocked a legitimate command: ${r.err}`)
    assert.equal(r.out.trim(), '', `escalated a legitimate command: ${r.out}`)
  })
}

// -------------------------------------------------------------- bash: ask tier
// Writing to the gate layer is sometimes the task (/ci-setup), so it escalates.
const ASKED = [
  'sed -i "" s/rust-check//  lefthook.yml',
  'rm .github/workflows/ci.yaml',
  'echo "check:" > justfile',
  'sed -i s/0.62/0.40/ .coverage-baseline',
]
for (const command of ASKED) {
  test(`bash-guard escalates: ${command}`, () => {
    const r = claudeBash(command)
    assert.equal(r.status, 0, 'the gate layer is edited for honest reasons too — deny is wrong here')
    assert.equal(decision(r.out), 'ask')
  })
}

// ------------------------------------------------------------- the two dialects
test('bash-guard: a deny is exit 2 in both dialects', () => {
  assert.equal(cursorBash('git commit --no-verify -m x').status, 2)
})

test('bash-guard: an ask answers in the host dialect', () => {
  const claude = JSON.parse(claudeBash('rm lefthook.yml').out)
  assert.equal(claude.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(claude.hookSpecificOutput.permissionDecision, 'ask')
  assert.ok(claude.hookSpecificOutput.permissionDecisionReason)

  const cursor = JSON.parse(cursorBash('rm lefthook.yml').out)
  assert.equal(cursor.permission, 'ask', 'Cursor expects {permission}, not hookSpecificOutput')
  assert.ok(cursor.agent_message)
})

// ------------------------------------------------------------------- fail open
// A guard that bricks a session on its own bug is worse than one that misses a case.
test('both guards fail open on an unreadable payload', () => {
  for (const script of [BASH_GUARD, EDIT_GUARD]) {
    const r = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' })
    assert.equal(r.status, 0, `${script}: a parse failure must not block`)
    assert.match(r.stderr, /failing open/)
  }
})

test('bash-guard passes an empty payload through', () => {
  assert.equal(run(BASH_GUARD, {}).status, 0)
})

// ------------------------------------------------------------------ edit-guard
test('edit-guard escalates the gate layer and nothing else', () => {
  const protectedPaths = [
    'lefthook.yml',
    'justfile',
    '.github/workflows/ci.yaml',
    '.gitea/workflows/mutation.yaml',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/kit/common/hooks/bash-guard.mjs',
    'scripts/review-guard.mjs',
    'scripts/review-prompt.md',
    '.work/review-report.md',
    '.coverage-baseline',
    'api/.cargo/mutants.toml',
  ]
  for (const p of protectedPaths) {
    const r = edit(p)
    assert.equal(r.status, 0, `${p}: edit-guard asks, it never denies`)
    assert.equal(decision(r.out), 'ask', `${p}: not escalated`)
  }
  for (const p of ['src/main.rs', 'docs/PRD.md', 'apps/web/src/app.tsx', 'lefthook-notes.md']) {
    const r = edit(p)
    assert.equal(r.status, 0)
    assert.equal(r.out.trim(), '', `${p}: escalated an ordinary file`)
  }
})

test('edit-guard names WHY the file is protected', () => {
  assert.match(edit('.work/review-report.md').out, /forges the verdict/)
  assert.match(edit('.coverage-baseline').out, /HARD bypass/)
  assert.match(edit('.claude/kit/common/hooks/edit-guard.mjs').out, /meta-bypass/)
})

// ------------------------------------------------------------------- the wiring
// A snippet that does not parse is a snippet nobody can merge, and a path typo makes
// the hook silently never fire — which is indistinguishable from no hook at all.
test('the hook snippets are valid JSON and point at scripts that exist', () => {
  const files = ['settings.snippet.json', 'opencode.snippet.json', 'cursor-hooks.snippet.json']
  for (const name of files) {
    const text = readFileSync(join(HOOKS, name), 'utf8')
    let json
    assert.doesNotThrow(() => { json = JSON.parse(text) }, `${name}: invalid JSON`)
    assert.ok(json._comment, `${name}: no _comment saying where to merge it`)
    for (const m of text.matchAll(/node ([\w./-]+\.mjs)/g)) {
      const script = m[1].replace(/^\.(claude|dev)\/kit\//, '')
      assert.ok(readFileSync(join(REPO, 'kit', script), 'utf8'), `${name}: ${m[1]} does not exist in the kit`)
    }
  }
})

test('the Claude snippet wires both guards on PreToolUse', () => {
  const json = JSON.parse(readFileSync(join(HOOKS, 'settings.snippet.json'), 'utf8'))
  const entries = json.hooks.PreToolUse
  const matchers = entries.map((e) => e.matcher)
  assert.deepEqual(matchers, ['Bash', 'Edit|Write'])
  for (const e of entries) assert.equal(e.hooks[0].type, 'command')
})

// The whole point of the git floor is that it is portable — so it must actually be there.
test('the git floor ships in the common lefthook snippet', () => {
  const yml = readFileSync(join(REPO, 'kit', 'common', 'lefthook.snippet.yml'), 'utf8')
  assert.match(yml, /pre-commit:/)
  assert.match(yml, /no-commit-on-trunk:/)
  assert.match(yml, /- ref: main/)
  assert.match(yml, /- ref: master/)
  assert.match(yml, /OPT-OUT/, 'a solo repo must be told how to drop it, in the file itself')
})

// A plain YAML scalar cannot contain ": " — lefthook rejects the whole file with
// "mapping values are not allowed in this context", so every hook in the repo dies
// because of a colon in a message. Guard both copies of the command: the snippet
// people merge by hand, and the one `claude-rules init` generates.
test('no `run:` command hides a colon-space in a plain scalar', () => {
  const sources = [
    join(REPO, 'kit', 'common', 'lefthook.snippet.yml'),
    join(REPO, 'kit', 'rust', 'lefthook.snippet.yml'),
    join(REPO, 'kit', 'ts', 'lefthook.snippet.yml'),
    join(REPO, 'kit', 'go', 'lefthook.snippet.yml'),
    join(REPO, 'kit', 'python', 'lefthook.snippet.yml'),
    join(REPO, 'kit', 'godot', 'lefthook.snippet.yml'),
    join(REPO, 'bin', 'cli.mjs'),
  ]
  for (const file of sources) {
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s*run: (?!['"|>])(.*)$/gm)) {
      assert.doesNotMatch(m[1], /: /,
        `${file.slice(REPO.length + 1)}: \`run: ${m[1]}\` — a colon-space in a plain YAML scalar breaks the whole lefthook.yml`)
    }
  }
})
