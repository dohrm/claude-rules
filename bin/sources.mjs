// Sources (ADR-0008): what the lock pins, how each source is fetched, and the one
// tree the emitters read. No emitter and no ownership logic lives here.
import { readFileSync, existsSync, cpSync, readdirSync, statSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { safePath } from './ownership.mjs'

// The lock pins an ordered list of sources. The first is this library, `core`; a lock
// written before sources existed (`repo` + `ref`) reads as core alone and is rewritten
// in the new shape by the next write.
export const CORE = 'core'
export const SOURCE_NAME = /^[\w.-]+$/
export function lockSources(raw, registry, lockName) {
  if (raw.sources === undefined)
    return [{ name: CORE, url: `github:${raw.repo || registry.repo}`, ref: raw.ref || registry.defaultRef }]
  const list = raw.sources
  const valid = Array.isArray(list) && list.length && list.every(s => s && SOURCE_NAME.test(s.name)
    && typeof s.url === 'string' && s.url && typeof s.ref === 'string' && s.ref)
  if (!valid) throw new Error(`${lockName}: "sources" must be a non-empty list of { name, url, ref }`)
  if (list[0].name !== CORE) throw new Error(`${lockName}: the first source must be "${CORE}", found "${list[0].name}"`)
  const names = list.map(s => s.name)
  const twice = names.filter((n, i) => names.indexOf(n) !== i)
  if (twice.length) throw new Error(`${lockName}: source "${twice[0]}" is listed twice`)
  return list.map(({ name, url, ref }) => ({ name, url, ref }))
}
// `--ref <ref>` → { core: ref }; `--ref <name>=<ref>` → { name: ref }.
export function parseRefs(refFlags) {
  const refs = {}
  for (const raw of refFlags) {
    const m = raw.match(/^([\w.-]+)=(.+)$/)
    const [name, ref] = m ? [m[1], m[2]] : [CORE, raw]
    if (refs[name] && refs[name] !== ref) throw new Error(`--ref given twice for source "${name}" (${refs[name]}, ${ref})`)
    refs[name] = ref
  }
  return refs
}
// The sources this run installs from: the lock's (or core alone on a first add), each
// at its --ref. Without one, core follows defaultRef, as it always has, and every
// other source replays its locked ref.
function resolveSources(locked, refs, registry) {
  const sources = (locked || [{ name: CORE, url: `github:${registry.repo}`, ref: registry.defaultRef }]).map(s => ({ ...s }))
  const unknown = Object.keys(refs).filter(n => !sources.some(s => s.name === n))
  if (unknown.length)
    throw new Error(`--ref names unknown source(s): ${unknown.join(', ')}. Locked: ${sources.map(s => s.name).join(', ')}`)
  for (const s of sources) s.ref = refs[s.name] || (s.name === CORE ? registry.defaultRef : s.ref)
  return sources
}
export const sourcesLabel = sources => sources.map(s => `${s.name}@${s.ref}`).join(', ')

// -------------------------------------------------------------------- fetching
// One shallow fetch per source, into its own temp dir. `init` + `fetch <ref>` takes a
// tag, a branch and a SHA alike, where `clone --branch` refuses a SHA. Authentication
// is the user's git (SSH keys, credential helper): the installer never sees a token.
// `localDir` (`--local <dir>`) means "core is the tree at <dir>, no git".
const gitUrl = url => { const m = url.match(/^github:([\w.-]+\/[\w.-]+)$/); return m ? `https://github.com/${m[1]}.git` : url }
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.error) throw new Error(`git: ${r.error.message} (git is required to fetch sources)`)
  if (r.status !== 0) throw new Error((r.stderr || `git ${args[0]} exited ${r.status}`).trim())
}
function fetchSource(source, localDir) {
  if (source.name === CORE && localDir) return { ...source, dir: localDir, temp: false }
  // A lock is repository content: an option-shaped value must never reach git as a flag.
  for (const [key, value] of [['url', source.url], ['ref', source.ref]])
    if (value.startsWith('-')) throw new Error(`source ${source.name}: ${key} must not start with "-" (${value})`)
  const dir = mkdtempSync(join(tmpdir(), 'claude-rules-src-'))
  try {
    git(['init', '-q', dir])
    git(['fetch', '-q', '--depth', '1', gitUrl(source.url), source.ref], dir)
    git(['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], dir)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`source ${source.name} (${source.url}#${source.ref}): ${error.message}`)
  }
  return { ...source, dir, temp: true }
}

// Fetch the run's sources, read core's registry, hand both to `fn`, and remove every
// temp dir however `fn` ends. The lock is read raw here: normalizing it checks profile
// names, and only the fetched registry knows them all.
export async function withSources({ lockFile, refFlags, localDir, registry }, fn) {
  let locked = null
  if (existsSync(lockFile)) { safePath(lockFile); locked = lockSources(JSON.parse(readFileSync(lockFile, 'utf8')), registry, lockFile) }
  const sources = resolveSources(locked, parseRefs(refFlags), registry)
  if (sources.length > 1) throw new Error(`Only the core source is supported; the lock lists ${sourcesLabel(sources)}`)
  const fetched = []
  // A validation deep in `fn` may process.exit, which skips `finally`: the fetched
  // trees (private content, git objects included) must not outlive the run either way.
  const cleanup = () => { for (const f of fetched.splice(0)) if (f.temp) rmSync(f.dir, { recursive: true, force: true }) }
  process.on('exit', cleanup)
  try {
    for (const source of sources) fetched.push(fetchSource(source, localDir))
    const file = join(fetched[0].dir, 'registry.json')
    if (!existsSync(file)) throw new Error(`source ${CORE} (${sources[0].url}#${sources[0].ref}) has no registry.json`)
    return await fn([...fetched], JSON.parse(readFileSync(file, 'utf8')))
  } finally {
    cleanup()
    process.off('exit', cleanup)
  }
}

// -------------------------------------------------------------------- staging
// A fetched source is not trusted to stay inside itself: copying dereferences links,
// so a link anywhere under `abs` that resolves outside `root` would pull a file of
// this machine (a key, a config) into the consumer repo. Every path is checked once
// resolved, links to directories included; `seen` stops a link cycle.
function assertInside(root, abs, seen = new Set()) {
  const real = realpathSync(abs)
  if (real !== root && !real.startsWith(root + sep)) throw new Error(`${abs}: resolves outside its source (${real})`)
  if (!statSync(real).isDirectory() || seen.has(real)) return
  seen.add(real)
  for (const name of readdirSync(real)) assertInside(root, join(real, name), seen)
}
// The emitters read ONE tree, never a source: each entry's `from` is copied out of
// the fetched sources into a temp dir, removed by the caller, so private content
// never lands in the repo and no emitter knows where a file came from.
// Returns { tree, origin }: origin maps each `from` to the source it was copied from.
export function stageTree(layers, froms) {
  const tree = mkdtempSync(join(tmpdir(), 'claude-rules-tree-'))
  const origin = {}
  try {
    for (const from of froms) {
      const layer = layers.find(l => existsSync(join(l.dir, from)))
      if (!layer) throw new Error(`${from}: not found in source ${layers.map(l => l.name).join(', ')}`)
      assertInside(realpathSync(layer.dir), join(layer.dir, from))
      cpSync(join(layer.dir, from), join(tree, from), { recursive: true, dereference: true })
      origin[from] = layer.name
    }
  } catch (error) { rmSync(tree, { recursive: true, force: true }); throw error }
  return { tree, origin }
}
