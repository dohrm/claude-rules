// Shared test helpers — dependency-free (node:test + node:assert only).
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
export const CLI = join(REPO, 'bin', 'cli.mjs')
export const registry = JSON.parse(readFileSync(join(REPO, 'registry.json'), 'utf8'))
export const allEntries = [...registry.shared, ...Object.values(registry.profiles).flat()]

// Minimal frontmatter reader — mirrors the shipping subset (scalars + one-level
// lists) that bin/cli.mjs parses. Deliberately a separate implementation: the
// test must fail if the CLI's parser and the authored files drift apart.
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
