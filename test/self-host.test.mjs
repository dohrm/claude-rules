// Self-host: this repository runs the skills, rules and kit it edits, through committed
// relative symlinks and a root justfile that imports the kit library in place — never
// through a copy that could drift. macOS and Linux only (symlinks).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lstatSync, readlinkSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from './helpers.mjs'

// link → the canonical directory it must resolve to (what `add agent product` installs,
// plus the Codex skill root).
const LINKS = {
  '.claude/skills': 'skills',
  '.agents/skills': 'skills',
  '.claude/agents': 'agents',
  '.claude/rules/agent': 'rules/agent',
  '.claude/rules/product': 'rules/product',
}

for (const [link, target] of Object.entries(LINKS)) {
  test(`${link} is a relative symlink to ${target}/`, () => {
    const abs = join(REPO, link)
    // lstat, not existsSync: a dangling link must fail on its target below, not here.
    assert.ok(lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink(), `${link} must be a symlink`)
    const rel = readlinkSync(abs)
    assert.ok(!rel.startsWith('/'), `${link} must be relative, got ${rel}`)
    assert.equal(realpathSync(abs), realpathSync(join(REPO, target)))
  })
}

test('rules/common is not linked: the repo keeps its own, stricter language rule', () => {
  assert.ok(!existsSync(join(REPO, '.claude/rules/common')))
  assert.ok(lstatSync(join(REPO, '.claude/rules/language.md')).isFile())
})

test('the root justfile imports the kit library in place', () => {
  const text = readFileSync(join(REPO, 'justfile'), 'utf8')
  assert.match(text, /^import 'kit\/common\/gate\.just'$/m)
  assert.match(text, /^kit\s*:=\s*"kit\/common"$/m)
  assert.match(text, /^base\s*:=\s*"origin\/next"$/m)
  assert.match(text, /^set allow-duplicate-recipes$/m)
  assert.match(text, /^set allow-duplicate-variables$/m)
})

// Local only: the main CI job runs `npm test` without `just`, so there the regexes above
// are the witness and this case skips.
test('just resolves kit and base from the root justfile', { skip: spawnSync('just', ['--version']).error && 'just not installed' }, () => {
  for (const [name, want] of [['kit', 'kit/common'], ['base', 'origin/next']]) {
    const r = spawnSync('just', ['--evaluate', name], { cwd: REPO, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, want)
  }
})
