// Ownership (ADR-0010): which files the installer wrote, checked before anything is
// written or deleted, then applied. Generalised from the Codex adapter (ADR-0003).
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, chmodSync } from 'node:fs'
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
// destinations whose every file must be explained. A path is fine when it is absent,
// or owned and unchanged; a directory where a file goes, only when every file in it is
// owned and goes first. Anything else is a corruption — listed, never reconciled.
// Returns Map path → why.
export function checkTree({ writes, deletes, owned, dirs }) {
  const corrupt = new Map()
  const gone = new Set(deletes)
  for (const path of deletes) {
    const at = stand(path)
    if (at.kind === 'file') { if (hash(readFileSync(path)) !== owned.get(path)) corrupt.set(path, 'edited since it was installed') }
    else if (at.kind !== 'absent') corrupt.set(path, 'not a file, where an installed file was')
  }
  for (const path of writes.keys()) {
    const at = stand(path)
    if (at.blocker) { if (!gone.has(at.blocker)) corrupt.set(at.blocker, 'a file where a directory goes'); continue }
    if (at.kind === 'file') {
      if (!owned.has(path)) corrupt.set(path, 'not written by claude-rules')
      else if (hash(readFileSync(path)) !== owned.get(path)) corrupt.set(path, 'edited since it was installed')
    } else if (at.kind === 'dir') {
      const inside = filesUnder(path)
      if (!inside.length || inside.some(f => !gone.has(f))) corrupt.set(path, 'a directory where a file goes')
    } else if (at.kind === 'other') corrupt.set(path, 'not a regular file')
  }
  for (const dir of dirs) {
    const kind = stand(dir).kind
    if (kind !== 'dir') {
      if (kind !== 'absent' && !writes.has(dir) && !owned.has(dir) && !corrupt.has(dir)) corrupt.set(dir, 'not written by claude-rules, at an installed destination')
      continue
    }
    for (const f of filesUnder(dir))
      if (!writes.has(f) && !owned.has(f) && !corrupt.has(f)) corrupt.set(f, 'not written by claude-rules, inside an installed directory')
  }
  return corrupt
}

// Apply a checked plan, in order: under --force, the listed paths no write replaces;
// then every owned file no longer produced; then every write. Deleting first is what
// lets a file turn into a directory, or back, with no special case.
export function applyTree({ writes, modes = new Map(), deletes, corrupt = new Map() }, onDelete = () => {}) {
  for (const path of corrupt.keys()) if (!writes.has(path)) removePath(path)
  for (const path of deletes) if (existsSync(path)) { removePath(path); onDelete(path) }
  for (const [path, content] of writes) {
    if (existsSync(path) && lstatSync(path).isDirectory()) rmSync(path, { recursive: true })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    if (modes.has(path)) chmodSync(path, modes.get(path))
  }
}
function removePath(path) {
  rmSync(path, { recursive: true, force: true })
  // The directories it leaves empty go too, down to the root a kind writes under
  // (`.claude/rules`, `.dev/kit`), which stays.
  for (let dir = dirname(path); dir.split('/').length > 2 && existsSync(dir) && !readdirSync(dir).length; dir = dirname(dir)) rmSync(dir, { recursive: true })
}
