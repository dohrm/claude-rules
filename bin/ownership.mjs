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

// ------------------------------------------------------------ the tree check
// Every file the lock says the installer wrote, path → hash. Codex's own inventory
// (`codex.files`) reads as the same record: one model, whichever wrote it.
export function ownedFiles(lock) {
  const owned = new Map()
  for (const [path, asset] of Object.entries(lock?.codex?.files || {})) owned.set(path, asset.hash)
  for (const record of lock?.installed || []) for (const [path, digest] of Object.entries(record.files || {})) owned.set(path, digest)
  return owned
}
// A lock without a hash for every record cannot tell an edit from a stale copy: its
// next update is an adoption (ADR-0010).
export const recordsHashes = lock => Array.isArray(lock?.installed) && lock.installed.every(r => r.files && typeof r.files === 'object')

// Where `path` stands, never through a link: 'absent', 'file', 'dir' or 'other' —
// or `blocker`, the first ancestor that exists and is not a directory.
function stand(path) {
  safePathPrefix(path)
  const parts = path.split('/')
  for (let i = 1; i <= parts.length; i++) {
    const at = parts.slice(0, i).join('/')
    let st
    try { st = lstatSync(at) } catch (e) { if (e.code === 'ENOENT') return { kind: 'absent' }; throw e }
    if (st.isSymbolicLink()) throw new Error(`Refusing symlink destination: ${path}`)
    if (i < parts.length && !st.isDirectory()) return { kind: 'absent', blocker: at }
    if (i === parts.length) return { kind: st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other' }
  }
}
function safePathPrefix(path) {
  const rel = relative(process.cwd(), resolve(path))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || slash(rel) !== path) throw new Error(`Not a canonical repository path: ${path}`)
}
const filesUnder = dir => walk(dir).map(f => slash(f.abs))

// The check before writing. `writes`: path → content this run produces; `deletes`:
// owned paths it no longer produces; `owned`: path → recorded hash; `dirs`: installed
// directories whose every file must be explained. A path is fine when it is absent,
// owned and unchanged, or already holds exactly what will be written. Anything else
// is a corruption — listed, never reconciled. Returns Map path → why.
export function checkTree({ writes, deletes, owned, dirs }) {
  const corrupt = new Map()
  const gone = new Set(deletes)
  for (const path of deletes) {
    const at = stand(path)
    if (at.kind === 'file') { if (hash(readFileSync(path)) !== owned.get(path)) corrupt.set(path, 'edited since it was installed') }
    else if (at.kind !== 'absent') corrupt.set(path, 'not a file, where an installed file was')
  }
  for (const [path, content] of writes) {
    const at = stand(path)
    if (at.blocker) { if (!gone.has(at.blocker)) corrupt.set(at.blocker, 'a file where a directory goes'); continue }
    if (at.kind === 'file') {
      const current = hash(readFileSync(path))
      if (current !== hash(content) && current !== owned.get(path))
        corrupt.set(path, owned.has(path) ? 'edited since it was installed' : 'not written by claude-rules')
    } else if (at.kind === 'dir') {
      if (filesUnder(path).some(f => !gone.has(f))) corrupt.set(path, 'a directory where a file goes')
    } else if (at.kind === 'other') corrupt.set(path, 'not a regular file')
  }
  for (const dir of dirs) {
    if (stand(dir).kind !== 'dir') continue
    for (const f of filesUnder(dir))
      if (!writes.has(f) && !owned.has(f) && !corrupt.has(f)) corrupt.set(f, 'not written by claude-rules, inside an installed directory')
  }
  return corrupt
}
