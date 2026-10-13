// Ownership (ADR-0010): which files the installer wrote, checked before anything is
// written or deleted, then applied. Generalised from the Codex adapter (ADR-0003).
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'

export const hash = content => createHash('sha256').update(content).digest('hex')
const slash = path => path.split(sep).join('/')

// Check every ancestor, including dangling symlinks, before reading or writing.
export function safePath(path) {
  const root = process.cwd(), abs = resolve(path), rel = relative(root, abs)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes repository: ${path}`)
  let current = root
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    let st
    try { st = lstatSync(current) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    if (st.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${path}`)
    if (current !== abs && !st.isDirectory()) throw new Error(`Not a directory: ${current}`)
  }
  return slash(rel) || '.'
}

export function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (lstatSync(abs).isDirectory()) out.push(...walk(abs).map(f => ({ abs: f.abs, rel: join(name, f.rel) })))
    else out.push({ abs, rel: name })
  }
  return out
}

// `files`: path → content to write; `previous`: path → hash the last install wrote.
export function planFiles(files, previous = {}) {
  const writes = new Map(), deletes = []
  for (const [path, content] of Object.entries(files)) {
    safePath(path)
    if (existsSync(path)) {
      if (!lstatSync(path).isFile()) throw new Error(`Conflicting destination: ${path}`)
      const current = hash(readFileSync(path)), old = previous[path]
      if (current !== hash(content) && current !== old) throw new Error(`Conflicting local content: ${path}; reconcile before updating`)
    }
    writes.set(path, content)
  }
  for (const [path, old] of Object.entries(previous)) {
    if (files[path] || !existsSync(path)) continue
    if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== old) throw new Error(`Modified owned file would be removed: ${path}`)
    deletes.push(path)
  }
  return { writes, deletes }
}

export function applyFiles(plan) {
  for (const [path, content] of plan.writes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  for (const path of plan.deletes) {
    rmSync(path)
    // Remove empty asset directories only; never remove a module directory.
    let dir = dirname(path)
    while (dir.startsWith('.agents/') && existsSync(dir) && !readdirSync(dir).length) { rmSync(dir, { recursive: true }); dir = dirname(dir) }
  }
}
