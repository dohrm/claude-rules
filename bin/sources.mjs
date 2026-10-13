// Sources (ADR-0008): what the lock pins, how each source is fetched, and the one
// tree the emitters read. No emitter and no ownership logic lives here.
import { readFileSync, existsSync, cpSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
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

// Fetch the run's sources, merge their registries, hand both to `fn` with the source
// that declared each entry, and remove every temp dir however `fn` ends. The lock is read raw here: normalizing it checks profile
// names, and only the fetched registry knows them all.
export async function withSources({ lockFile, refFlags, localDir, registry }, fn) {
  let locked = null
  if (existsSync(lockFile)) { safePath(lockFile); locked = lockSources(JSON.parse(readFileSync(lockFile, 'utf8')), registry, lockFile) }
  const sources = resolveSources(locked, parseRefs(refFlags), registry)
  const fetched = []
  // A validation deep in `fn` may process.exit, which skips `finally`: the fetched
  // trees (private content, git objects included) must not outlive the run either way.
  const cleanup = () => { for (const f of fetched.splice(0)) if (f.temp) rmSync(f.dir, { recursive: true, force: true }) }
  process.on('exit', cleanup)
  try {
    for (const source of sources) fetched.push(fetchSource(source, localDir))
    const { registry: merged, declaredBy } = mergeRegistries(fetched)
    return await fn([...fetched], merged, declaredBy)
  } finally {
    cleanup()
    process.off('exit', cleanup)
  }
}

// Registries merge in source order (ADR-0008): a profile seen again appends its
// entries, `shared` appends, aliases and `retired` merge with the later source winning
// on the same key. Core must carry one; an overlay that only replaces files may not.
// `declaredBy` maps each entry to the source whose registry named it: that is the
// entry's `source` in the inventory, whichever layers its files are staged from.
const isList = v => Array.isArray(v)
const isListMap = v => Boolean(v) && typeof v === 'object' && !isList(v) && Object.values(v).every(isList)
const SHAPE = { profiles: [isListMap, 'map names to lists'], aliases: [isListMap, 'map names to lists'], shared: [isList, 'be a list'] }
function mergeRegistries(fetched) {
  let merged = null
  const declaredBy = new Map()
  for (const source of fetched) {
    const file = join(source.dir, 'registry.json')
    if (!existsSync(file)) {
      if (source.name === CORE) throw new Error(`source ${CORE} (${source.url}#${source.ref}) has no registry.json`)
      continue
    }
    assertInside(realpathSync(source.dir), file)
    const reg = JSON.parse(readFileSync(file, 'utf8'))
    for (const [key, [valid, what]] of Object.entries(SHAPE))
      if (reg[key] !== undefined && !valid(reg[key])) throw new Error(`source ${source.name}: registry.json "${key}" must ${what}`)
    for (const e of [...(reg.shared || []), ...Object.values(reg.profiles || {}).flat()])
      if (e && typeof e === 'object') declaredBy.set(e, source.name)
    if (!merged) { merged = { ...reg, shared: reg.shared || [], profiles: { ...reg.profiles }, aliases: { ...reg.aliases } }; continue }
    merged.shared = [...merged.shared, ...(reg.shared || [])]
    for (const [name, entries] of Object.entries(reg.profiles || {})) merged.profiles[name] = [...(merged.profiles[name] || []), ...entries]
    merged.aliases = { ...merged.aliases, ...reg.aliases }
    if (reg.retired) merged.retired = { ...merged.retired, ...reg.retired, profiles: { ...merged.retired?.profiles, ...reg.retired.profiles } }
  }
  return { registry: merged, declaredBy }
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
// the layers into a temp dir, removed by the caller, so private content never lands
// in the repo and no emitter knows where a file came from. Layers are overlaid in
// order and the last path wins (ADR-0008): a file for rules, agents and kit, but a
// whole directory for a skill, so a skill is never half one layer, half another.
// Returns the tree's directory.
export function stageTree(layers, entries) {
  const tree = mkdtempSync(join(tmpdir(), 'claude-rules-tree-'))
  try {
    for (const { from, kind } of entries) {
      const dest = join(tree, from)
      let found = false
      for (const layer of layers) {
        const src = join(layer.dir, from)
        if (!existsSync(src)) continue
        assertInside(realpathSync(layer.dir), src)
        if (kind === 'skill') rmSync(dest, { recursive: true, force: true })
        overlay(src, dest, from, layer.name)
        found = true
      }
      if (!found) throw new Error(`${from}: not found in source ${layers.map(l => l.name).join(', ')}`)
    }
  } catch (error) { rmSync(tree, { recursive: true, force: true }); throw error }
  return tree
}
// One layer over the tree, file by file. A path that is a file in one layer and a
// directory in another has no answer: it is refused, never resolved (ADR-0010).
// Links are followed (assertInside kept them in their source); `seen` stops a cycle.
function overlay(src, dest, path, layer, seen = new Set()) {
  const real = realpathSync(src)
  if (!statSync(real).isDirectory()) {
    if (existsSync(dest) && statSync(dest).isDirectory()) throw new Error(`source ${layer}: ${path} is a file, where an earlier layer has a directory`)
    cpSync(real, dest, { dereference: true })
    return
  }
  if (seen.has(real)) throw new Error(`source ${layer}: ${path} links back into itself`)
  if (existsSync(dest) && !statSync(dest).isDirectory()) throw new Error(`source ${layer}: ${path} is a directory, where an earlier layer has a file`)
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(real)) overlay(join(real, name), join(dest, name), `${path}/${name}`, layer, new Set([...seen, real]))
}
