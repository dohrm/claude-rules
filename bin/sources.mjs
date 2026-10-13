// Sources (ADR-0008): what the lock pins, how each source is fetched, and the one
// tree the emitters read. No emitter and no ownership logic lives here.
import { readFileSync, existsSync, cpSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { join, sep, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { safePath, plainPath, hash, walk } from './ownership.mjs'

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
function resolveSources(locked, refs, registry, edit) {
  const sources = editSources(locked || [{ name: CORE, url: `github:${registry.repo}`, ref: registry.defaultRef }], edit).map(s => ({ ...s }))
  const unknown = Object.keys(refs).filter(n => !sources.some(s => s.name === n))
  if (unknown.length)
    throw new Error(`--ref names unknown source(s): ${unknown.join(', ')}. Locked: ${sources.map(s => s.name).join(', ')}`)
  for (const s of sources) s.ref = refs[s.name] || (s.name === CORE ? registry.defaultRef : s.ref)
  return sources
}
// `add --source <name>=<url>#<ref>`: the ref is after the last `#`, so a URL may hold one.
export function parseSourceFlag(raw) {
  const m = raw.match(/^([\w.-]+)=(.+)#([^#]+)$/)
  if (!m) throw new Error(`--source ${raw}: expected <name>=<url>#<ref>`)
  if (m[1] === CORE) throw new Error(`--source: "${CORE}" is this library; pin it with --ref`)
  return { name: m[1], url: m[2], ref: m[3] }
}
// What this run changes in the lock's list: `add` appends a source, `drop` removes one.
function editSources(list, { add, drop } = {}) {
  if (add) {
    if (list.some(s => s.name === add.name)) throw new Error(`source "${add.name}" is already locked; move it with --ref ${add.name}=<ref>`)
    return [...list, add]
  }
  if (drop) {
    if (drop === CORE) throw new Error(`source "${CORE}" cannot be removed; "remove all" uninstalls`)
    if (!list.some(s => s.name === drop)) throw new Error(`source "${drop}" is not locked. Locked: ${list.map(s => s.name).join(', ')}`)
    return list.filter(s => s.name !== drop)
  }
  return list
}
// After `remove --source`, a profile only that source defined is in no registry left:
// it goes with the source, from profiles, modules and levels alike.
export function dropUndefined(lock, registry) {
  const gone = lock.profiles.filter(p => !registry.profiles[p])
  if (!gone.length) return lock
  console.log(`Dropping [${gone.join(', ')}]: no remaining source defines ${gone.length > 1 ? 'them' : 'it'}.\n`)
  const keep = ps => ps.filter(p => !gone.includes(p))
  return {
    ...lock,
    profiles: keep(lock.profiles),
    modules: Object.fromEntries(Object.entries(lock.modules || {}).map(([d, ps]) => [d, keep(ps)])),
    ...(lock.levels ? { levels: Object.fromEntries(Object.entries(lock.levels).filter(([p]) => !gone.includes(p))) } : {}),
  }
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

// The repo's own layer (ADR-0008): last, no ref, no registry, never written by the
// installer and never locked — the one place a repo's edit to an installed file
// survives `update`. It mirrors the source layout (.dev/overrides/rules/common/x.md).
export const OVERRIDES = '.dev/overrides'
function projectLayer() {
  if (!existsSync(OVERRIDES)) return []
  safePath(OVERRIDES)
  return [{ name: OVERRIDES, dir: resolve(OVERRIDES), temp: false, project: true }]
}

// Fetch the run's sources, merge their registries, hand both to `fn` with the source
// that declared each entry, and remove every temp dir however `fn` ends. The lock is read raw here: normalizing it checks profile
// names, and only the fetched registry knows them all.
// `edit`: `{ add: source }` or `{ drop: name }`, applied to the locked list first.
export async function withSources({ lockFile, refFlags, localDir, registry, edit }, fn) {
  let locked = null
  if (existsSync(lockFile)) { safePath(lockFile); locked = lockSources(JSON.parse(readFileSync(lockFile, 'utf8')), registry, lockFile) }
  const sources = resolveSources(locked, parseRefs(refFlags), registry, edit)
  const fetched = []
  // A validation deep in `fn` may process.exit, which skips `finally`: the fetched
  // trees (private content, git objects included) must not outlive the run either way.
  const cleanup = () => { for (const f of fetched.splice(0)) if (f.temp) rmSync(f.dir, { recursive: true, force: true }) }
  process.on('exit', cleanup)
  try {
    for (const source of sources) fetched.push(fetchSource(source, localDir))
    const { registry: merged, declaredBy } = mergeRegistries(fetched)
    return await fn([...fetched, ...projectLayer()], merged, declaredBy)
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
const isMap = v => Boolean(v) && typeof v === 'object' && !isList(v)
const isListMap = v => isMap(v) && Object.values(v).every(isList)
// The lock records the merged aliases, and reads them back with this same check.
export const isAliasMap = v => isListMap(v) && Object.values(v).every(ps => ps.every(p => typeof p === 'string'))
const isRetired = v => isMap(v) && (v.profiles === undefined || isMap(v.profiles))
const SHAPE = {
  profiles: [isListMap, 'map names to lists'],
  aliases: [isAliasMap, 'map names to lists of profile names'],
  shared: [isList, 'be a list'],
  retired: [isRetired, 'be an object whose "profiles" maps names to reasons'],
}
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
    // Paths this source removes from the layers before it (stageTree).
    source.exclude = reg.exclude ?? []
    if (!isList(source.exclude) || !source.exclude.every(plainPath))
      throw new Error(`source ${source.name}: registry.json "exclude" must be a list of relative paths`)
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
// A layer's `exclude` removes what the layers before it put there, a file or a whole
// skill; a later layer may put it back. Returns { tree, excluded, overrides }: excluded
// maps each path that stays removed to the source that removed it; overrides lists every
// path a layer replaced, { path, by, over, baseHash } (ADR-0008), in staging order;
// layerOf maps each staged file, or skill directory, to the layer it came from.
// A source path is staged once: one inside another would replay every layer over an
// already merged path, and record a layer replacing itself. Refused (ADR-0010).
const under = (path, dir) => path === dir || path.startsWith(dir + '/')
export function stageTree(layers, entries) {
  const froms = entries.map(e => e.from)
  for (const from of froms) {
    const outer = froms.find(other => other !== from && under(from, other))
    if (outer) throw new Error(`registry: ${from} is inside ${outer}: a source path is staged once`)
  }
  const tree = mkdtempSync(join(tmpdir(), 'claude-rules-tree-'))
  const excluded = new Map()
  // Which layer put each staged path there, and what each replacement replaced.
  const holder = new Map(), replaced = new Map()
  const place = (path, layer, base) => {
    if (base !== null) replaced.set(`${path}\0${layer}`, { path, by: layer, over: holder.get(path), baseHash: base })
    holder.set(path, layer)
  }
  const forget = at => {
    for (const path of [...holder.keys()]) if (under(path, at)) holder.delete(path)
    for (const [key, o] of [...replaced]) if (under(o.path, at)) replaced.delete(key)
  }
  try {
    for (const { from, kind } of entries) {
      const dest = join(tree, from)
      let found = false
      const gone = new Map()
      for (const layer of layers) {
        for (const path of layer.exclude || []) {
          if (!under(path, from) && !under(from, path)) continue
          if (kind === 'skill' && path !== from && under(path, from))
            throw new Error(`source ${layer.name}: exclude ${path}: a skill is excluded whole (${from})`)
          const at = under(from, path) ? from : path
          rmSync(join(tree, at), { recursive: true, force: true })
          forget(at)
          gone.set(at, layer.name)
        }
        const src = join(layer.dir, from)
        if (!existsSync(src)) continue
        assertInside(realpathSync(layer.dir), src)
        if (kind === 'skill') {
          // The unit of override is the skill: one record for the directory, none inside.
          place(from, layer.name, existsSync(dest) ? dirHash(dest) : null)
          rmSync(dest, { recursive: true, force: true })
          overlay(src, dest, from, layer.name, () => {})
        } else overlay(src, dest, from, layer.name, place)
        found = true
      }
      if (!found && !gone.has(from)) throw new Error(`${from}: not found in source ${layers.map(l => l.name).join(', ')}`)
      for (const [path, by] of gone) if (!existsSync(join(tree, path))) excluded.set(path, by)
    }
  } catch (error) { rmSync(tree, { recursive: true, force: true }); throw error }
  return { tree, excluded, overrides: [...replaced.values()], layerOf: holder }
}
// A staged skill directory, hashed as the sorted list of its (path, sha256).
function dirHash(dir) {
  const files = walk(dir).map(f => [f.rel.split(sep).join('/'), hash(readFileSync(f.abs))])
  return hash(JSON.stringify(files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))
}
// One layer over the tree, file by file. A path that is a file in one layer and a
// directory in another has no answer: it is refused, never resolved (ADR-0010).
// Links are followed (assertInside kept them in their source); `seen` stops a cycle.
// `place(path, layer, baseHash)` is told of every file, with the hash it replaces or null.
function overlay(src, dest, path, layer, place, seen = new Set()) {
  const real = realpathSync(src)
  if (!statSync(real).isDirectory()) {
    if (existsSync(dest) && statSync(dest).isDirectory()) throw new Error(`source ${layer}: ${path} is a file, where an earlier layer has a directory`)
    place(path, layer, existsSync(dest) ? hash(readFileSync(dest)) : null)
    cpSync(real, dest, { dereference: true })
    return
  }
  if (seen.has(real)) throw new Error(`source ${layer}: ${path} links back into itself`)
  if (existsSync(dest) && !statSync(dest).isDirectory()) throw new Error(`source ${layer}: ${path} is a directory, where an earlier layer has a file`)
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(real)) overlay(join(real, name), join(dest, name), `${path}/${name}`, layer, place, new Set([...seen, real]))
}

// -------------------------------------------------------------------- overrides
// The lock's `overrides` are what the last install replaced; a record is lock content,
// so it is shape-checked when read back.
export function assertOverrides(list, lockName) {
  const valid = Array.isArray(list) && list.every(o => o && plainPath(o.path) && typeof o.by === 'string' && o.by
    && typeof o.over === 'string' && o.over && typeof o.baseHash === 'string' && /^[0-9a-f]{64}$/.test(o.baseHash))
  if (!valid) throw new Error(`${lockName}: "overrides" must be a list of { path, by, over, baseHash }`)
}
// The overrides whose replaced version moved since the last install (ADR-0008), as
// { path, by, over, change }: the same path and overriding layer with another base, or
// no base left while that layer still supplies the path — the version it replaced is
// gone. A replacement new to this run has no earlier base, so nothing to compare.
export function changedUpstream(previous = [], current, layerOf) {
  const now = new Map(current.map(o => [`${o.path}\0${o.by}`, o]))
  const moved = []
  for (const was of previous) {
    const o = now.get(`${was.path}\0${was.by}`)
    if (o) { if (o.baseHash !== was.baseHash) moved.push({ ...o, change: 'changed in' }) }
    else if (layerOf.get(was.path) === was.by) moved.push({ ...was, change: 'removed from' })
  }
  return moved
}
