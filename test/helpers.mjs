// Shared test helpers — dependency-free (node:test + node:assert only).
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
export const CLI = join(REPO, 'bin', 'cli.mjs')
export const registry = JSON.parse(readFileSync(join(REPO, 'registry.json'), 'utf8'))
export const allEntries = [...registry.shared, ...Object.values(registry.profiles).flat()]

// Minimal frontmatter reader — mirrors the shipping subset (scalars + one-level
// lists) that bin/cli.mjs parses. Deliberately a separate implementation: the
// test must fail if the CLI's parser and the authored files drift apart.
//
// It is a deliberate copy of `parseFm` in bin/cli.mjs, character-equivalent today.
// The tests import nothing from bin/ on purpose — that independence is what makes
// them a witness rather than a tautology. The cost is that a change to one parser
// MUST be made to the other, or the suite stops describing the installer. Notably:
// neither handles inline YAML lists, which is the whole point of the block-list
// assertion in registry.test.mjs.
export function readFm(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { fm: null, body: text }
  const fm = {}
  let key = null
  for (const raw of m[1].split(/\r?\n/)) {
    const li = raw.match(/^\s*-\s+(.*)$/)
    if (li && Array.isArray(fm[key])) { fm[key].push(li[1].trim().replace(/^["']|["']$/g, '')); continue }
    const kv = raw.match(/^([\w-]+):\s*(.*)$/)
    if (kv) { key = kv[1]; const v = kv[2].trim(); fm[key] = v === '' ? [] : v.replace(/^["']|["']$/g, '') }
  }
  return { fm, body: m[2] }
}

export function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base))
    else out.push(abs)
  }
  return out
}

export const dirsIn = dir => readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory())

// --------------------------------------------------------------------- CLI
// Runs the installer offline against this working tree (--local), in a throwaway cwd.
export function runCli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--local', REPO], { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

// Same, without --local (for commands that never stage assets: list, init, usage).
export function runCliBare(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export function withTmpRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-rules-test-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

export const read = (...p) => readFileSync(join(...p), 'utf8')
export const has = (...p) => existsSync(join(...p))

// ------------------------------------------------------------ audit gate
// Commits the tree, so a gate run with `base=HEAD` has a real base to compare the lock
// against. `blank` (a repo-relative path) is committed EMPTY, then restored, so the tree
// shows that file changed against the base while staying valid for the toolchain.
export function commitBase(dir, blank) {
  const saved = blank && readFileSync(join(dir, blank))
  if (blank) writeFileSync(join(dir, blank), '')
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'base']]) {
    const r = spawnSync('git', [
      '-c', 'init.defaultBranch=main', '-c', 'user.name=gate-test', '-c', 'user.email=gate-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
    ], { cwd: dir, encoding: 'utf8' })
    if (r.error) throw r.error
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`)
  }
  if (blank) writeFileSync(join(dir, blank), saved)
}

// The `<tech>-check` audit decision, the same four cases for every language. The audit
// command is replaced by a sentinel: an audit's verdict depends on the date, so these
// tests assert the DECISION (the marker the recipe prints, the sentinel's presence),
// never that an audit is green. `<tech>-audit`'s wiring to the real tool is asserted
// on a dry run, which spends no network.
//   lock       — repo-relative path of the lock in the assembled fixture
//   tool       — what the dry run of `<tech>-audit` must name
//   changeLock — commits a base and leaves `lock` changed against it
export function auditGateCases({ tech, lock, tool, assemble, runJust, changeLock, skip, timeout }) {
  const SENTINEL = 'audit-sentinel-ran'
  const stub = `${tech}_audit=echo ${SENTINEL}`

  test(`just ${tech}-audit runs ${tool}`, { skip, timeout }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, `${tech}-audit`, ['--dry-run'])
      assert.equal(r.status, 0, r.out)
      assert.ok(r.out.includes(tool), `${tech}-audit must run ${tool}:\n${r.out}`)
    })
  })

  test(`just ${tech}-check skips the audit when ${lock} is unchanged against base`, { skip, timeout }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      commitBase(dir)
      const r = runJust(dir, `${tech}-check`, ['base=HEAD', stub])
      assert.equal(r.status, 0, r.out)
      assert.ok(r.out.includes(`audit: skipped — ${lock} unchanged against HEAD`), `no skip line:\n${r.out}`)
      assert.ok(!r.out.includes(SENTINEL), `the audit must not run:\n${r.out}`)
    })
  })

  test(`just ${tech}-check runs the audit when ${lock} changed against base`, { skip, timeout }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      changeLock(dir)
      const r = runJust(dir, `${tech}-check`, ['base=HEAD', stub])
      assert.equal(r.status, 0, r.out)
      assert.ok(r.out.includes(`audit: ${lock} changed`), `no changed line:\n${r.out}`)
      assert.ok(r.out.includes(SENTINEL), `the audit must run:\n${r.out}`)
    })
  })

  test(`just ${tech}-check runs the audit when base does not resolve`, { skip, timeout }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      commitBase(dir)
      const r = runJust(dir, `${tech}-check`, ['base=origin/no-such-base', stub])
      assert.equal(r.status, 0, r.out)
      assert.ok(r.out.includes('audit: origin/no-such-base unresolvable'), `no unresolvable line:\n${r.out}`)
      assert.ok(r.out.includes(SENTINEL), `the audit must run:\n${r.out}`)
    })
  })
}
