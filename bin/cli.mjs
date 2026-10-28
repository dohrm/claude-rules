#!/usr/bin/env node
// claude-rules — install shared agent assets (rules / agents / skills / kit) into a repo.
// shadcn-style: copy + own + pin. The CLI is deliberately dumb; the source of
// truth is registry.json. It NEVER merges build config (lefthook/eslint) — kit
// entries are scaffolded and their wiring is printed for you to do once.
//
// Claude Markdown is the source format; Codex uses explicit rule references,
// Cursor uses transformed native rules. Skills and kit remain portable.
//
// Usage:
//   npx github:dohrm/claude-rules add rust [ts go] [--agent claude,codex,cursor] [--root apps/api] [--level gates] [--ref v1.2.0]
//   npx github:dohrm/claude-rules remove rust [ts go]       # uninstall profiles ("remove all" = full uninstall)
//   npx github:dohrm/claude-rules update [--ref v1.3.0|<source>=<ref>] [--force] [--strict]  # re-install locked profiles+agents at ref
//   npx github:dohrm/claude-rules add|remove --source <name>[=<url>#<ref>]  # add or drop a layered source
//   npx github:dohrm/claude-rules init                      # assemble justfile + lefthook.yml + CLAUDE.md (if absent)
//   npx github:dohrm/claude-rules doctor [--strict]         # audit the install against the repo (offline)
//   npx github:dohrm/claude-rules budget [<path>] [--agent cursor]   # what loads for that file, and what it costs
//   npx github:dohrm/claude-rules list
//   (dev/test) add … --local <path-to-this-repo>            # read assets from disk instead of GitHub
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { modulePath, checkCodexInventory, prepareCodex, applyCodex, auditCodex, codexBudget } from './codex.mjs'
import { safePath, plainPath, hash, walk, ownedFiles, recordsHashes, checkTree, applyTree } from './ownership.mjs'
import { CORE, SOURCE_NAME, lockSources as readSources, sourcesLabel, parseSourceFlag, dropUndefined, isAliasMap, withSources as fetchSources, stageTree, assertOverrides, changedUpstream } from './sources.mjs'
// No dependency: add/update fetch sources with the `git` on PATH; every other command runs offline.

// The registry bundled with the CLI. `add` and `update` replace it with the merge of
// the registries their fetched sources carry (withSources): what a ref installs is
// that ref's registry, not whatever copy the CLI happened to be run from. Commands
// that fetch nothing (list, remove, doctor, init, budget) keep the bundled one.
let registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
const LOCK = '.claude-rules.lock'
const KNOWN_AGENTS = ['claude', 'codex', 'cursor']
const DEFAULT_AGENTS = ['claude', 'codex']
const RETIRED_AGENTS = ['antigravity', 'opencode']
const RETIRED_DIRS = ['.dev/rules', '.opencode']

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
// `--ref` repeats: `--ref <ref>` targets core, `--ref <name>=<ref>` a named source.
const refFlags = argv.flatMap((a, i) => a === '--ref' && i + 1 < argv.length ? [argv[i + 1]] : [])
const agentFlag = flag('--agent')
const localFlag = flag('--local')
const forceFlag = argv.includes('--force')
const moduleFlag = flag('--module')
const rootFlag = flag('--root')
const levelFlag = flag('--level')
const strictFlag = argv.includes('--strict')
const sourceFlag = flag('--source')
if (rootFlag && moduleFlag) {
  console.error('--root and --module are the same flag; pass one.')
  process.exit(1)
}
const scopeFlag = rootFlag || moduleFlag
const reserved = new Set(['--ref', ...refFlags, '--agent', agentFlag, '--local', localFlag, '--module', moduleFlag, '--root', rootFlag, '--level', levelFlag, '--strict', '--force', '--source', sourceFlag].filter(Boolean))
const positional = argv.slice(1).filter(a => !reserved.has(a))

const LEVELS = ['rules', 'gates', 'ratchet']
const levelRank = l => { const i = LEVELS.indexOf(l); return i < 0 ? 0 : i }
const maxLevel = (a, b) => LEVELS[Math.max(levelRank(a), levelRank(b))]
const entryLevel = e => e.level || (e.kind === 'kit' ? 'gates' : 'rules')
const entriesAt = (profile, level) => (registry.profiles[profile] || []).filter(e => levelRank(entryLevel(e)) <= levelRank(level))
// Language-globbing profiles: without --root they load on every matching file in
// the repo. That is how ops/slo lands on a domain entity. Hint, never block.
const ROOT_HINT = new Set(['rust', 'ts', 'ts-web', 'ts-node', 'ts-tauri', 'go', 'python', 'godot', 'hexagonal', 'cqrs', 'api', 'backend', 'ops', 'testing', 'react', 'portal-flat', 'portal-http', 'tauri'])
// The opposite case: every scopable rule in the registry leads its globs with
// `**/` on purpose, so prefixing them with a module dir still matches anywhere
// under it (`apps/portal/**/*.rs`). `agent` (docs/adr/) and `product`
// (docs/**/*.md) are the two exceptions — one shared doc tree for the whole
// repo, never one per module — so their globs deliberately do NOT lead with
// `**/`. Scoping them under --root would silently stop matching the repo-root
// docs/ they actually live in, so --root is never applied to them, no matter
// what else was requested in the same `add` call.
const ROOT_FORBID = new Set(['agent', 'product'])

function unpackNames(names, quiet = false, aliases = registry.aliases || {}) {
  const out = []
  const seen = new Set()
  const active = new Set()
  const walk = n => {
    if (active.has(n)) throw new Error(`Alias cycle at ${n}`)
    if (aliases[n]) {
      if (!seen.has(n)) {
        seen.add(n)
        if (!quiet) console.log(`  unpack ${n} → ${aliases[n].join(' ')}`)
        active.add(n)
        aliases[n].forEach(walk)
        active.delete(n)
      }
      return
    }
    if (!seen.has(n)) { seen.add(n); out.push(n) }
  }
  names.forEach(walk)
  return out
}

// ------------------------------------------------------------------- sources
// Fetching, staging and the lock's `sources` live in bin/sources.mjs. Commands that
// fetch run under the sources' merged registry from here on; `declaredBy` names the
// source whose registry declared each of its entries.
const lockSources = raw => readSources(raw, registry, LOCK)
let declaredBy = new Map()
function withSources(fn, edit) {
  return fetchSources({ lockFile: LOCK, refFlags, localDir: localFlag, registry, edit }, (fetched, merged, declared) => {
    registry = merged
    declaredBy = declared
    return fn(fetched)
  })
}

function parseLevel() {
  if (!levelFlag) return null
  if (!LEVELS.includes(levelFlag)) {
    console.error(`Unknown --level ${levelFlag}. Known: ${LEVELS.join(', ')}`)
    process.exit(1)
  }
  return levelFlag
}

// New installations default to Claude and Codex; explicit targets select otherwise.
// Existing installations retain their targets; explicit selections extend them.
function parseAgents(fallback) {
  const raw = agentFlag || fallback || DEFAULT_AGENTS.join(',')
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  const retired = list.filter(a => RETIRED_AGENTS.includes(a))
  const bad = list.filter(a => !KNOWN_AGENTS.includes(a) && !RETIRED_AGENTS.includes(a))
  if (retired.length) {
    console.error(`Retired agent(s): ${retired.join(', ')}. Targets are ${KNOWN_AGENTS.join(', ')} (OpenCode and Antigravity were dropped).`)
    process.exit(1)
  }
  if (bad.length) { console.error(`Unknown agent(s): ${bad.join(', ')}. Known: ${KNOWN_AGENTS.join(', ')}`); process.exit(1) }
  return [...new Set(list)]
}

// A lock written before the cut may still list retired targets. Keep the ones
// that remain, drop the rest, and say so — `update` then rewrites the lock.
function agentsFromLock(lock) {
  const raw = (lock && lock.agents) ? lock.agents : []
  return {
    kept: raw.filter(a => KNOWN_AGENTS.includes(a)),
    dropped: raw.filter(a => !KNOWN_AGENTS.includes(a)),
  }
}

// ------------------------------------------------------------- destinations
// Skills for Cursor live in `.agents/skills/` — the portable SKILL.md home.
// Rules do not: Cursor reads `.cursor/rules/*.mdc`. The kit is the ONE kind no
// emitter transforms: executable gates, copied verbatim, byte-identical for every
// agent. Nothing reads it the way Claude auto-reads .claude/rules/ — its only
// consumers name the path themselves (the justfile, lefthook, settings.json).
// ONE home, agent-neutral.
const SKILL_DIR = { claude: '.claude/skills', codex: '.agents/skills', cursor: '.agents/skills' }
const KIT_DIR = '.dev/kit'
const LEGACY_KIT_DIR = '.claude/kit'      // where `--agent claude` used to put it

// ------------------------------------------------------------------ fs utils
const logCopy = (from, to) => console.log(`  ✓ ${from}  →  ${to}`)

// ------------------------------------------------------- frontmatter (dep-free)
// The frontmatter we ship is trivial (scalars + one-level lists); a full YAML
// parser would be overkill and a new dependency. This handles `key: value`,
// `key:` followed by `  - item` lines, and strips surrounding quotes.
const unq = v => v.replace(/^["']|["']$/g, '')
function splitFm(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return m ? { fm: parseFm(m[1]), body: m[2] } : { fm: {}, body: text }
}
function parseFm(s) {
  const obj = {}; let key = null
  for (const raw of s.split(/\r?\n/)) {
    const li = raw.match(/^\s*-\s+(.*)$/)
    if (li && Array.isArray(obj[key])) { obj[key].push(unq(li[1].trim())); continue }
    const kv = raw.match(/^([\w-]+):\s*(.*)$/)
    if (kv) { key = kv[1]; const v = kv[2].trim(); obj[key] = v === '' ? [] : unq(v) }
  }
  return obj
}
function dumpFm(obj) {
  const lines = []
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) { lines.push(`${k}:`); for (const it of v) lines.push(`  - "${it}"`) }
    else if (typeof v === 'boolean') lines.push(`${k}: ${v}`)
    else lines.push(`${k}: ${/[:#"'\n]/.test(v) ? JSON.stringify(v) : v}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- module scope
// A rule ships an extension-level glob (`**/*.ts`) because the library cannot know
// your layout. In a monorepo that is too coarse: `**/*.ts` makes the Fastify rules
// load on a React component. `modules` in the lock says which profiles belong to
// which directory, and emission anchors their globs there.
//
//   "modules": { "apps/api": ["rust", "api"], "apps/web": ["ts", "portal-http"] }
//
// A profile named by no module stays repo-wide, and a lock with no `modules` at all
// behaves exactly as before — the installer only rewrites what it is asked to.
const prefixesFor = (profile, modules) =>
  Object.entries(modules || {}).filter(([dir, ps]) => dir !== '.' && ps.includes(profile)).map(([dir]) => dir)
// One exception, and it is the same one ROOT_FORBID makes at profile granularity:
// a glob naming the shared `docs/` tree is never anchored. `docs/` is one tree for
// the whole repo, never one per module, so prefixing it would silently stop matching
// the docs/ it was written for. ROOT_FORBID cannot express this for a profile whose
// OTHER globs do belong to a module — `ops` owns both `ops/slo.md` (docs + alert
// config) and `ops/delivery.md` (that module's source), so the rule lives here.
const SHARED_TREE_GLOB = /(?:^|\/)docs\//
const scopeGlobs = (globs, prefixes) => {
  if (!prefixes.length) return globs
  const scopable = globs.filter(g => !SHARED_TREE_GLOB.test(g))
  const shared = globs.filter(g => SHARED_TREE_GLOB.test(g))
  return [...prefixes.flatMap(p => scopable.map(g => `${p}/${g}`)), ...shared]
}

// A rule declares the languages it is about, in its own `paths:` — no new metadata
// needed. If every glob it carries targets a language this repo did not lock, the
// rule can never fire, so it is not emitted at all: `api/go.md` has no business in
// a repo with no Go. Anything the table does not claim (yaml, CHANGELOG…) is never
// filtered, and a repo that locked no language at all is left alone.
const LANG_EXT = {
  rust: ['rs'],
  ts: ['ts', 'tsx'],
  'ts-web': ['ts', 'tsx'],
  'ts-node': ['ts', 'tsx'],
  'ts-tauri': ['ts', 'tsx'],
  go: ['go'],
  python: ['py'],
  godot: ['cs', 'tscn', 'tres', 'gd'],
}
function isLanguageDead(globs, profiles) {
  if (!Array.isArray(globs) || !globs.length) return false
  const locked = new Set(profiles.flatMap(p => LANG_EXT[p] || []))
  if (!locked.size) return false
  const known = new Set(Object.values(LANG_EXT).flat())
  const exts = globs.map(g => (g.match(/\.([a-z0-9]+)$/i) || [])[1]).filter(Boolean).map(e => e.toLowerCase())
  if (exts.length !== globs.length) return false          // a non-language glob in the set — leave the rule alone
  if (!exts.every(e => known.has(e))) return false        // an extension no profile claims
  return !exts.some(e => locked.has(e))
}

// ----------------------------------------------------------------- transforms
// Claude rule (.md, `paths:`/`title:`) → Cursor rule (.mdc, `globs:`/`alwaysApply`).
function toMdcText(text, prefixes = []) {
  const { fm, body } = splitFm(text)
  const out = {}
  const desc = fm.description || fm.title
  if (desc) out.description = desc
  if (Array.isArray(fm.paths) && fm.paths.length) { out.globs = scopeGlobs(fm.paths, prefixes); out.alwaysApply = false }
  else out.alwaysApply = true
  return `---\n${dumpFm(out)}\n---\n${body}`
}
// Claude rule, module-anchored. Returns null when nothing changes, so an unscoped
// install keeps copying byte-for-byte.
function toScopedRuleText(text, prefixes) {
  const { fm, body } = splitFm(text)
  if (!prefixes.length || !Array.isArray(fm.paths) || !fm.paths.length) return null
  return `---\n${dumpFm({ ...fm, paths: scopeGlobs(fm.paths, prefixes) })}\n---\n${body}`
}
// -------------------------------------------------------------------- staging
// Returns { dir, isFile, name } — a readable view of the entry inside the staged tree.
function makeStaged(root, entry) {
  const isFile = /\.[a-z0-9]+$/i.test(entry.from)
  const abs = join(root, entry.from)
  return { dir: isFile ? dirname(abs) : abs, isFile, name: basename(entry.from) }
}
const stagedFiles = s => s.isFile ? [{ abs: join(s.dir, s.name), rel: s.name }] : walk(s.dir)
const mdFiles = s => stagedFiles(s).filter(f => f.rel.endsWith('.md'))

// -------------------------------------------------------------------- emitters
// Signature: (staged, entry, agent, ctx) => note | null. An emitter writes nothing:
// it puts every file it produces into the run's plan, under the entry it came from.
const entryKey = e => `${e.kind}:${e.from}`
// `from`: the staged file copied verbatim, whose mode (an executable script) carries over.
function put(ctx, path, content, from = null) {
  ctx.out.set(path, content)
  if (from) ctx.modes.set(path, statSync(from).mode & 0o777)
  ctx.byEntry.set(ctx.key, [...(ctx.byEntry.get(ctx.key) || []), path])
}
function emitSkill(s, entry, agent, ctx) {
  const dest = join(SKILL_DIR[agent], basename(entry.from))
  if (ctx.skills.has(dest)) return null
  ctx.skills.add(dest)
  for (const f of stagedFiles(s)) put(ctx, join(dest, f.rel), readFileSync(f.abs), f.abs)
  logCopy(entry.from, dest); return null
}
function emitKit(s, entry, agent, ctx) {
  // One destination for every agent, so the second agent would re-copy the same
  // bytes and print the same line twice.
  if (ctx.kit.has(entry.from)) return null
  ctx.kit.add(entry.from)
  const dest = join(KIT_DIR, basename(entry.from))
  // A file entry (the CHANGELOG) lands AT dest, not inside a directory named after it.
  if (s.isFile) put(ctx, dest, readFileSync(join(s.dir, s.name)), join(s.dir, s.name))
  else for (const f of stagedFiles(s)) put(ctx, join(dest, f.rel), readFileSync(f.abs), f.abs)
  logCopy(entry.from, dest); return entry.wire ? `  • ${dest}: ${entry.wire}` : null
}
// Rules & agents for Claude. Verbatim, unless the profile is anchored to modules —
// then only the `paths:` list is rewritten. Agents carry no `paths:` and are untouched.
function emitClaudeRaw(s, entry, agent, ctx) {
  const { prefixes, langProfiles } = ctx.scope
  let n = 0
  for (const f of stagedFiles(s)) {
    const text = f.rel.endsWith('.md') ? readFileSync(f.abs, 'utf8') : null
    if (entry.kind === 'rule' && text && isLanguageDead(splitFm(text).fm.paths, langProfiles)) continue
    const t = s.isFile ? entry.to : join(entry.to, f.rel)
    const scoped = entry.kind === 'rule' && text ? toScopedRuleText(text, prefixes) : null
    if (scoped) put(ctx, t, Buffer.from(scoped)); else put(ctx, t, readFileSync(f.abs), f.abs)
    n++
  }
  logCopy(entry.from, `${entry.to}${n ? '' : '  (nothing to emit)'}`); return null
}
// Cursor rule: one file per rule, `description` + `globs` + `alwaysApply`.
function emitCursorRule(s, entry, agent, ctx) {
  const { prefixes, langProfiles } = ctx.scope
  const root = '.cursor/rules'
  for (const f of mdFiles(s)) {
    const text = readFileSync(f.abs, 'utf8')
    if (isLanguageDead(splitFm(text).fm.paths, langProfiles)) continue
    const rel = (s.isFile ? f.rel : join(basename(entry.from), f.rel)).replace(/\.md$/, '.mdc')
    put(ctx, join(root, rel), Buffer.from(toMdcText(text, prefixes)))
  }
  logCopy(entry.from, join(root, s.isFile ? '' : basename(entry.from)) + '/*.mdc'); return null
}
const emitSkip = (s, entry, agent) =>
  `  • ${agent}: native subagent definitions are not emitted — skipped "${entry.from}" (use ${agent}'s runtime agent feature instead).`

const EMITTERS = {
  claude: { skill: emitSkill, kit: emitKit, rule: emitClaudeRaw,  agent: emitClaudeRaw },
  cursor: { skill: emitSkill, kit: emitKit, rule: emitCursorRule, agent: emitSkip },
  codex: { skill: () => null, kit: emitKit, rule: () => null, agent: emitSkip },
}

// Historical marker retained for safe Codex adoption.
const AGENTS_START = '<!-- claude-rules:start (managed — do not edit inside this block) -->'

// --------------------------------------------------------------------- remove
// Inverse of add: delete the destinations each emitter produced, per locked
// agent, and update the lock. Symmetric with the EMITTERS/destination logic.
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isFileFrom = from => /\.[a-z0-9]+$/i.test(from)

// Every destination is derived from an entry, and both its sources are now content
// this CLI did not ship: a fetched registry, and the lock's inventory. An entry may
// only name a path under the root its kind owns, or a forged `to: "src"` would let
// emit write into a project directory.
const ENTRY_ROOT = { rule: '.claude/rules/', agent: '.claude/agents' }
function assertEntry(e, where) {
  const name = e && typeof e.from === 'string' ? basename(e.from) : ''
  const ok = e && ['rule', 'agent', 'skill', 'kit'].includes(e.kind) && plainPath(e.from) && name
    && (!ENTRY_ROOT[e.kind] || (plainPath(e.to) && (e.to === ENTRY_ROOT[e.kind].replace(/\/$/, '') && e.kind === 'agent'
      || e.to.startsWith(ENTRY_ROOT[e.kind].replace(/\/?$/, '/')))))
  if (!ok) throw new Error(`${where}: entry ${JSON.stringify(e)} — a ${e?.kind} must come from a relative path and land under ${ENTRY_ROOT[e?.kind] || 'its fixed root'}`)
}

// Adoption, once (ADR-0010): a lock recorded without file hashes cannot tell a local
// edit from a stale copy, so its first install overwrites whole every destination
// already on disk — this run's, the ones the old inventory names and no longer gets,
// and the trees of retired targets — says so first, and needs --force when no terminal
// is there to read it. Returns the paths it adopts (none: no adoption).
function adoption(previous, destinations, agents) {
  if (!previous || recordsHashes(previous)) return []
  const before = agentsFromLock(previous).kept
  const stale = (previous.installed || []).flatMap(e => { assertEntry(e, `${LOCK} installed`); return before.flatMap(a => destsFor(e, a)) })
  const present = [...new Set([...destinations, ...stale, ...legacyTrees(agents)])].filter(d => existsSync(safePath(d)))
  if (!present.length) return []
  console.log(`⚠ ${LOCK} records no file hashes: this run adopts the install. Every installed destination below is overwritten once, local edits included, then recorded:`)
  for (const d of present) console.log(`  ! ${d}`)
  console.log()
  if (!forceFlag && !process.stdin.isTTY)
    throw new Error('Adoption needs --force without a terminal: save any local edit under the destinations listed above, then re-run with --force. Nothing was changed.')
  return present
}

// The inventory's file paths are lock content too: each must sit under a root the
// installer writes, or a forged record would let a prune delete a project file.
const OWNED_ROOTS = ['.claude/rules/', '.claude/agents/', '.claude/skills/', '.agents/rules/', '.agents/skills/', '.cursor/rules/', `${KIT_DIR}/`]
function assertFiles(e) {
  if (e.files === undefined) return
  const bad = !e.files || typeof e.files !== 'object' || Array.isArray(e.files) ? ['files'] : Object.entries(e.files)
    .filter(([path, digest]) => !plainPath(path) || !OWNED_ROOTS.some(r => path.startsWith(r)) || !/^[0-9a-f]{64}$/.test(digest)).map(([path]) => path)
  if (bad.length) throw new Error(`${LOCK} installed: ${e.kind} ${e.from} records ${bad.join(', ')} — an inventoried file must be a sha256 under ${OWNED_ROOTS.join(', ')}`)
}

// A skill is one unit, so a skill directory this run empties must hold nothing else
// either: the recorded skill destinations that hold a file of `deletes`.
function emptiedSkills(records, deletes) {
  const gone = [...deletes]
  return [...new Set(records.filter(e => e.kind === 'skill').flatMap(e => KNOWN_AGENTS.flatMap(a => destsFor(e, a))))]
    .filter(d => gone.some(f => f.startsWith(d + '/')))
}

// Filesystem targets that add() created for (entry, agent) — mirror of the emitters.
function destsFor(entry, agent) {
  const name = basename(entry.from)
  switch (entry.kind) {
    case 'skill': return SKILL_DIR[agent] ? [join(SKILL_DIR[agent], name)] : []
    case 'kit':   return [join(KIT_DIR, name)]
    case 'rule':
      if (agent === 'claude') return [entry.to]
      if (agent === 'codex') return [join('.agents/rules', name)]
      if (agent === 'cursor') return [isFileFrom(entry.from) ? join('.cursor/rules', name.replace(/\.md$/, '.mdc')) : join('.cursor/rules', name)]
      return []
    case 'agent':
      if (agent === 'claude') return [entry.to]
      return []
    default: return []
  }
}

// Every kit directory this registry can emit — the whitelist the legacy purge below
// deletes by name, so a directory a repo put under the old kit root by hand survives.
const kitNames = () => new Set([...registry.shared, ...Object.values(registry.profiles).flat()]
  .filter(e => e.kind === 'kit').map(e => basename(e.from)))

// The kit moved from .claude/kit/ to one agent-neutral .dev/kit/. An install that
// predates the move leaves the old tree on disk, and that tree is the failure mode
// this change exists to kill: a justfile still pointing at it never sees an `update`
// again. So add/update/remove purge it — BY NAME, one registry-known directory at a
// time, never `rm -rf` on the root.
// What the purges below would delete: the retired targets' trees, the registry-known
// legacy kit directories and the retired skills' directories.
function legacyTrees(agents) {
  const known = kitNames()
  const kit = existsSync(LEGACY_KIT_DIR) ? readdirSync(LEGACY_KIT_DIR).filter(n => known.has(n)).map(n => join(LEGACY_KIT_DIR, n)) : []
  assertRetiredSkills()
  const skills = agents.flatMap(a => (registry.retired?.skills || []).map(n => `${SKILL_DIR[a]}/${n}`))
  return [...RETIRED_DIRS, ...kit, ...skills]
}
function purgeLegacyKit() {
  if (!existsSync(LEGACY_KIT_DIR)) return
  const known = kitNames()
  const gone = []
  for (const name of readdirSync(LEGACY_KIT_DIR)) {
    if (!known.has(name)) continue
    rmSync(join(LEGACY_KIT_DIR, name), { recursive: true, force: true })
    gone.push(name)
  }
  if (!gone.length) return
  // Only when nothing of the repo's own is left — an unknown directory keeps it alive.
  const rest = readdirSync(LEGACY_KIT_DIR)
  if (!rest.length) rmSync(LEGACY_KIT_DIR, { recursive: true, force: true })
  console.log(`  ✗ ${LEGACY_KIT_DIR}/{${gone.join(',')}}  (moved to ${KIT_DIR}/ — update the paths in your justfile, lefthook.yml and settings.json)`)
  if (rest.length) console.log(`  • ${LEGACY_KIT_DIR}/ kept: ${rest.join(', ')} — not ours.`)
}

// Only retired OpenCode and Antigravity outputs are cleaned here.
function purgeRetired() {
  for (const dir of RETIRED_DIRS) {
    if (!existsSync(dir)) continue
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ✗ ${dir}  (retired agent target — run git status before committing)`)
  }
  // Codex-owned and manually bridged AGENTS.md blocks are never retired cleanup.
}

function remove(profilesArg) {
  const lock = readLock({ known: false })
  if (!lock) { console.error(`No ${LOCK} — nothing to remove.`); process.exit(1) }
  // remove deletes what was installed, read from the lock — never from a registry:
  // the one bundled with this CLI is not the one the source installed from, and may
  // map the same profile elsewhere. A lock without the inventory cannot say, so it
  // is refused rather than guessed at.
  if (!Array.isArray(lock.installed))
    throw new Error(`${LOCK} has no "installed" inventory; run \`update\` once to record it before removing profiles`)
  if (!recordsHashes(lock))
    throw new Error(`${LOCK} records no file hashes; run \`update\` once to adopt the install before removing profiles`)
  const { kept, dropped } = agentsFromLock(lock)
  if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}`)
  const agents = kept.length ? kept : ['claude']
  if (agents.includes('codex') && !lock.codex) throw new Error('Codex ownership inventory missing; update to adopt files before removing profiles')
  const full = profilesArg.length === 1 && profilesArg[0] === 'all'
  // A locked profile name is taken as is; anything else unpacks as an alias the
  // installing sources defined (recorded in the lock), else as a bundled one.
  const aliases = lock.aliases || registry.aliases || {}
  const targets = full ? lock.profiles.slice() : [...new Set(profilesArg.flatMap(n => lock.profiles.includes(n) ? [n] : unpackNames([n], false, aliases)))]
  const notInLock = targets.filter(p => !lock.profiles.includes(p))
  if (notInLock.length) console.log(`Not installed, skipping: ${notInLock.join(', ')}`)
  const toRemove = targets.filter(p => lock.profiles.includes(p))
  if (!toRemove.length) { console.error('Nothing to remove — none of those profiles are installed.'); process.exit(1) }
  const remaining = lock.profiles.filter(p => !toRemove.includes(p))
  const fullUninstall = full || remaining.length === 0
  const levels = { ...(lock.levels || {}) }
  for (const p of toRemove) delete levels[p]
  const modules = normalizeModules(remaining, Object.fromEntries(Object.entries(lock.modules || {})
    .map(([d, ps]) => [d, ps.filter(p => remaining.includes(p))])), false, false)
  const isKept = i => i.profile === null ? !fullUninstall : remaining.includes(i.profile)
  const keptInstalled = lock.installed.filter(isKept).map(i => ({ ...i, files: { ...i.files } }))
  // Codex rules shared with a remaining profile are rescoped to it, and rewritten.
  const writes = new Map(), codexDropped = []
  let codex
  if (lock.codex) {
    const files = {}
    for (const [path, asset] of Object.entries(lock.codex.files)) {
      const owners = asset.profiles.filter(p => remaining.includes(p))
      if (fullUninstall || (asset.profiles.length && !owners.length)) continue
      safePath(path)
      if (!existsSync(path)) throw new Error(`Missing Codex asset: ${path}; update before removing profiles`)
      if (!lstatSync(path).isFile()) throw new Error(`Not a regular file: ${path}; update --force before removing profiles`)
      const content = readFileSync(path)
      // Refused even under --force: a retained rule is rescoped from its installed text,
      // and an edited copy has none left to rescope. `update --force` restores it first.
      if (hash(content) !== asset.hash) throw new Error(`Modified owned file: ${path}; reconcile before removing profiles`)
      files[path] = { ...asset, profiles: owners, content }
    }
    for (const rule of lock.codex.rules)
      if (isLanguageDead(rule.rawGlobs, remaining.filter(p => LANG_EXT[p]))) delete files[rule.path]
    const rules = lock.codex.rules.filter(r => files[r.path]).map(r => {
      const owners = files[r.path].profiles
      const prefixes = owners.some(p => !prefixesFor(p, modules).length) ? [] : [...new Set(owners.flatMap(p => prefixesFor(p, modules)))]
      const globs = scopeGlobs(r.rawGlobs, prefixes)
      if (JSON.stringify(globs) !== JSON.stringify(r.globs)) {
        const { fm, body } = splitFm(files[r.path].content.toString())
        files[r.path].content = Buffer.from(`---\n${dumpFm({ ...fm, paths: globs })}\n---\n${body}`)
        writes.set(r.path, files[r.path].content)
      }
      return { ...r, profiles: owners, globs }
    })
    codexDropped.push(...Object.keys(lock.codex.files).filter(path => !files[path]))
    codex = prepareCodex(files, rules, fullUninstall ? {} : modules, lock.codex)
  }
  // The kept records follow: a rewritten file gets its new hash, a dropped one goes.
  for (const record of keptInstalled) for (const path of Object.keys(record.files)) {
    if (codexDropped.includes(path)) delete record.files[path]
    else if (writes.has(path)) record.files[path] = hash(writes.get(path))
  }
  // Delete exactly the files the removed records hold that no kept record still does.
  const keep = new Set(keptInstalled.flatMap(i => Object.keys(i.files)))
  const plan = { writes, deletes: [...new Set([...lock.installed.filter(i => !isKept(i)).flatMap(i => Object.keys(i.files)), ...codexDropped])].filter(path => !keep.has(path)) }
  plan.corrupt = settleCorruption(checkTree({ ...plan, owned: ownedFiles(lock), dirs: emptiedSkills(lock.installed, plan.deletes) }))
  safePath(LOCK)

  console.log(`Removing [${toRemove.join(', ')}]${fullUninstall ? ' + shared (full uninstall)' : ''} for [${agents.join(', ')}]\n`)
  applyTree(plan, path => console.log(`  ✗ ${path}`))
  if (codex) applyCodex(codex)
  if (fullUninstall) {
    if (existsSync(LOCK)) { rmSync(LOCK); console.log(`  ✗ ${LOCK}`) }
    console.log('\nFully uninstalled.')
  } else {
    // A removed profile leaves its module bindings behind too, or the next
    // `update` would anchor globs to a profile that is no longer installed.
    // An override goes with the entries it was staged for.
    const under = (path, from) => path === from || path.startsWith(from + '/')
    const overrides = (lock.overrides || []).filter(o => keptInstalled.some(i => under(o.path, i.from)))
    writeLock(lock.sources, remaining, agents, modules, levels, codex?.inventory, keptInstalled, lock.aliases, overrides)
    console.log(`\nUpdated ${LOCK} → [${remaining.join(', ')}] @ ${sourcesLabel(lock.sources)}.`)
  }
  if (lock.installed.some(i => !isKept(i) && i.kind === 'kit'))
    console.log('\n• Kit removed: also delete the matching `just <tech>-lint/-check` recipes and lefthook triggers you wired — the installer never owned those.')
  console.log('• Review the deletions with `git status` / `git diff` before committing.')
}

// -------------------------------------------------------------------- install
// ADR-0010: a tree the installer cannot explain is refused, never reconciled. The way
// out is the user's fix, or --force, which overwrites exactly the listed paths.
// Returns what applyTree overwrites.
function settleCorruption(corrupt, force = forceFlag) {
  if (!corrupt.size) return corrupt
  if (force) {
    console.log(`--force: overwriting ${corrupt.size} path(s) claude-rules did not install as they are:`)
    for (const [path, why] of corrupt) console.log(`  ! ${path} — ${why}`)
    console.log()
    return corrupt
  }
  const lines = [...corrupt].map(([path, why]) => `  ✗ ${path} — ${why}`)
  throw new Error(`${corrupt.size} path(s) are not what claude-rules installed; nothing was changed:\n${lines.join('\n')}\n`
    + 'Move the change out of the installed path, or re-run with --force to overwrite the listed paths.')
}
// `known: false` skips the profile-name check, for the commands that fetch nothing:
// the bundled registry may not know a profile the installing source defined.
function normalizeModules(profiles, modules = {}, validateRoot = true, known = true) {
  const out = {}
  for (const [raw, names] of Object.entries(modules)) {
    const dir = modulePath(raw)
    const expanded = known ? unpackNames(names, true) : names
    if (known && expanded.some(p => !registry.profiles[p])) throw new Error(`Module ${dir} references an unknown profile`)
    out[dir] = [...new Set([...(out[dir] || []), ...expanded])]
  }
  const bound = new Set(Object.entries(out).filter(([d]) => d !== '.').flatMap(([, ps]) => ps))
  if (validateRoot && out['.']?.some(p => bound.has(p)))
    throw new Error('Conflicting root membership: a profile cannot be assigned to both . and a module')
  out['.'] = profiles.filter(p => !bound.has(p))
  return { '.': out['.'], ...Object.fromEntries(Object.entries(out).filter(([d, ps]) => d !== '.' && ps.length)) }
}
// Strict by default (add/update, under the fetched registry); `{ known: false }` for
// the offline commands, which must still read a lock the bundled registry cannot explain.
// Those keep the lock's profile names as written: retiring or unpacking them through
// the bundled registry would rename what the installing source installed, and orphan
// its inventory records. Migration happens on add/update, under the source's registry.
function readLock({ known = true } = {}) {
  if (!existsSync(LOCK)) return null
  safePath(LOCK)
  const raw = JSON.parse(readFileSync(LOCK, 'utf8'))
  const lock = known ? dropRetiredProfiles(raw) : raw
  const unpack = names => known ? unpackNames(names, true) : names
  lock.sources = lockSources(lock)
  if (lock.aliases !== undefined && !isAliasMap(lock.aliases))
    throw new Error(`${LOCK}: "aliases" must map names to lists of profiles`)
  if (lock.installed !== undefined) {
    if (!Array.isArray(lock.installed)) throw new Error(`${LOCK}: "installed" must be a list`)
    for (const e of lock.installed) { assertEntry(e, `${LOCK} installed`); assertFiles(e) }
  }
  if (lock.overrides !== undefined) assertOverrides(lock.overrides, LOCK)
  // Codex's inventory feeds the same ownership plan, whichever targets this run selects.
  if (lock.codex !== undefined) checkCodexInventory(lock.codex, false)
  delete lock.repo
  delete lock.ref
  lock.profiles = unpack(lock.profiles)
  lock.modules = normalizeModules(lock.profiles, lock.modules, true, known)
  if (lock.levels) {
    const levels = {}
    for (const [name, level] of Object.entries(lock.levels))
      for (const p of unpack([name])) levels[p] = maxLevel(levels[p] || 'rules', level)
    lock.levels = levels
  }
  return lock
}
// A profile removed from the library must not make an old lock unreadable: drop it
// from profiles, modules and levels, say so, and let the next write persist that.
function dropRetiredProfiles(lock) {
  const retired = registry.retired?.profiles || {}
  const gone = (lock.profiles || []).filter(p => retired[p])
  if (!gone.length) return lock
  if (!dropRetiredProfiles.told) for (const p of gone) console.log(`Dropped retired profile "${p}" from the lock: ${retired[p]}.`)
  const keep = ps => ps.filter(p => !retired[p])
  lock.profiles = keep(lock.profiles)
  if (lock.modules) lock.modules = Object.fromEntries(Object.entries(lock.modules).map(([d, ps]) => [d, keep(ps)]))
  if (lock.levels) lock.levels = Object.fromEntries(Object.entries(lock.levels).filter(([p]) => !retired[p]))
  if (!dropRetiredProfiles.told) console.log('')
  dropRetiredProfiles.told = true
  return lock
}
// Skill directories of retired skills: library-owned, so no update would ever reach
// them again. Codex-owned files under .agents/skills are pruned by its inventory.
// A retired skill name is a fetched value too: one plain directory name, or a
// `../../src` would make the purge below delete a project directory.
function assertRetiredSkills() {
  const names = registry.retired?.skills || []
  if (!Array.isArray(names)) throw new Error('registry: retired.skills must be a list of skill names')
  for (const name of names)
    if (typeof name !== 'string' || !SOURCE_NAME.test(name) || name === '.' || name === '..')
      throw new Error(`registry: retired skill ${JSON.stringify(name)} must be a plain skill directory name`)
}
function purgeRetiredSkills(agents, codexOwned) {
  for (const agent of agents) {
    if (codexOwned && SKILL_DIR[agent] === SKILL_DIR.codex) continue
    for (const name of registry.retired?.skills || []) {
      const dir = `${SKILL_DIR[agent]}/${name}`
      if (!existsSync(dir)) continue
      safePath(dir)
      rmSync(dir, { recursive: true, force: true })
      console.log(`  ✗ ${dir}  (retired skill — run git status before committing)`)
    }
  }
}
// `installed` is the inventory: one { source, kind, from, to, profile } per entry
// emitted (profile null for the shared ones). remove deletes from it. `aliases` are
// the merged registry's, so an offline remove unpacks one an overlay defined.
// `overrides` are the paths a later layer replaced, with the base each replaced.
function writeLock(sources, profiles, agents, modules, levels, codex, installed, aliases, overrides) {
  const lock = { sources, profiles, agents, modules: normalizeModules(profiles, modules, false, false) }
  if (levels && Object.keys(levels).length) lock.levels = levels
  if (aliases && Object.keys(aliases).length) lock.aliases = aliases
  lock.installed = installed
  if (overrides?.length) lock.overrides = overrides
  if (codex) lock.codex = codex
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n')
}

function migrateLegacyLock(lock) {
  if (!lock) return { profiles: [], levels: {}, migrated: false }
  if (lock.levels) return { profiles: lock.profiles.slice(), levels: { ...lock.levels }, migrated: false }
  const profiles = lock.profiles.includes('agent') ? lock.profiles.slice() : [...lock.profiles, 'agent']
  if (!lock.profiles.includes('agent'))
    console.log('agent is now a profile (was shared). Locked at --level gates to match the previous install; `remove agent` drops it.\n')
  const levels = Object.fromEntries(profiles.map(p => [p, 'gates']))
  return { profiles, levels, migrated: true }
}

const FINAL_MSG = {
  claude: 'Claude: .claude/rules/ auto-load (language rules path-scoped via `paths:`); .claude/agents/ + .claude/skills/ auto-discovered.',
  codex: 'Codex: root/module AGENTS.md guide explicit reads of .agents/rules; skills in .agents/skills. Routing is advisory, not native glob loading.',
  cursor: 'Cursor: .cursor/rules/*.mdc activate via globs/alwaysApply; skills in .agents/skills/. No file-based subagents.',
}

// `fetched` are the run's layers, already on disk (withSources): the sources, then the
// project layer, which the lock never records.
async function install(profiles, fetched, agents, modules, levels) {
  const sources = fetched.filter(l => !l.project).map(({ name, url, ref, rev }) => ({ name, url, ref, ...(rev ? { rev } : {}) }))
  modules = normalizeModules(profiles, modules, false)
  safePath(LOCK)
  for (const [dir, ps] of Object.entries(modules)) {
    safePath(dir)
    if (ps.some(p => !profiles.includes(p))) throw new Error(`Module ${dir} references an uninstalled profile`)
    if (dir !== '.' && ps.some(p => ROOT_FORBID.has(p))) throw new Error(`Module ${dir}: agent/product must stay at root`)
  }
  const unknown = profiles.filter(p => !registry.profiles[p])
  if (unknown.length) {
    const aliasNames = Object.keys(registry.aliases || {})
    console.error(`Unknown profile(s): ${unknown.join(', ')}. Available: ${Object.keys(registry.profiles).join(', ')}${aliasNames.length ? ` (aliases: ${aliasNames.join(', ')})` : ''}`)
    process.exit(1)
  }
  // Carry the profile each entry came from: it is what maps an entry to the
  // module(s) that asked for it, and therefore to its glob prefixes.
  let owned = [
    ...registry.shared.map(e => ({ e, profile: null })),
    ...profiles.flatMap(p => entriesAt(p, levels[p] || 'rules').map(e => ({ e, profile: p }))),
  ]
  const ownersFor = entry => owned.filter(({ e }) => e.kind === entry.kind && e.from === entry.from).map(({ profile }) => profile).filter(Boolean)
  const prefixesOf = owners => owners.some(p => !prefixesFor(p, modules).length) ? [] : [...new Set(owners.flatMap(p => prefixesFor(p, modules)))]
  const scopes = Object.entries(modules || {}).map(([d, ps]) => `${d} → ${ps.join(', ')}`)
  const lv = profiles.map(p => `${p}@${levels[p] || 'rules'}`).join(', ')
  console.log(`Installing [${lv}] for [${agents.join(', ')}] from ${sourcesLabel(sources)}${localFlag ? ` (core read from ${localFlag})` : ''}`)
  if (scopes.length) console.log(`Roots: ${scopes.join(' · ')}`)
  console.log()
  const langProfiles = profiles.filter(p => LANG_EXT[p])
  const ctx = { kit: new Set(), skills: new Set(), scope: { prefixes: [], langProfiles }, out: new Map(), modes: new Map(), byEntry: new Map(), key: null }
  const notes = []
  const staged = []
  let tree = null
  let installed = []
  let codex, codexInput
  try {
    // Stage every entry before changing any destination.
    for (const { e } of owned) assertEntry(e, 'registry')
    assertRetiredSkills()
    // Two entries must not share or nest destinations: each installed path belongs to
    // one entry, so that entry's record alone says who wrote it.
    // And one entry's files are recorded under its `kind:from`, so a source path that two
    // entries install to two places is refused: neither record could say which copy it owns.
    const destsOf = new Map()
    for (const { e } of owned) {
      const key = entryKey(e), dests = agents.flatMap(a => destsFor(e, a)).join(', ')
      if (destsOf.has(key) && destsOf.get(key) !== dests)
        throw new Error(`registry: ${key} installs to ${destsOf.get(key)} and to ${dests}: one source path installs once`)
      destsOf.set(key, dests)
    }
    const destOwner = new Map()
    for (const { e } of owned) for (const a of agents) for (const d of destsFor(e, a)) {
      const key = entryKey(e)
      if (destOwner.has(d) && destOwner.get(d) !== key) throw new Error(`registry: ${destOwner.get(d)} and ${key} both install to ${d}`)
      destOwner.set(d, key)
    }
    for (const d of destOwner.keys()) {
      const inner = [...destOwner.keys()].find(o => o.startsWith(d + '/'))
      if (inner) throw new Error(`registry: ${destOwner.get(inner)} installs to ${inner}, inside ${d} (${destOwner.get(d)})`)
    }
    const staging = stageTree(fetched, [...new Map(owned.map(({ e }) => [e.from, e])).values()])
    tree = staging.tree
    // An entry excluded whole is not installed; a file excluded inside one is not
    // emitted. Their copies are then owned and no longer produced: the apply deletes them.
    for (const [path, by] of staging.excluded) console.log(`  − ${path}  (excluded by ${by})`)
    for (const o of staging.overrides) console.log(`  ↻ ${o.path}  (${o.by} over ${o.over})`)
    owned = owned.filter(({ e }) => existsSync(join(tree, e.from)))
    installed = owned.map(({ e, profile }) => ({ source: declaredBy.get(e) || CORE, kind: e.kind, from: e.from, to: e.to, profile }))
    const stagedKeys = new Set()
    for (const item of owned) {
      const key = JSON.stringify(item.e)
      if (stagedKeys.has(key)) continue
      stagedKeys.add(key)
      staged.push({ ...item, s: makeStaged(tree, item.e) })
    }
    for (const { s } of staged) for (const f of stagedFiles(s)) readFileSync(f.abs)
    // Emit: every file of every entry and target goes into the plan; nothing is written.
    for (const { e: entry, s } of staged) {
      ctx.scope = { prefixes: prefixesOf(ownersFor(entry)), langProfiles }
      ctx.key = entryKey(entry)
      for (const agent of agents) {
        // Shared skills are emitted once, by the Codex adapter.
        if (agents.includes('codex') && agent === 'cursor' && entry.kind === 'skill') continue
        const note = EMITTERS[agent][entry.kind](s, entry, agent, ctx)
        if (note) notes.push(note)
      }
    }
    if (agents.includes('codex')) {
      const files = {}, rules = new Map()
      for (const { e, s } of staged) {
        if (!['rule', 'skill'].includes(e.kind)) continue
        for (const f of stagedFiles(s)) {
          if (e.kind === 'rule' && !f.rel.endsWith('.md')) continue
          let content = readFileSync(f.abs)
          const fm = e.kind === 'rule' ? splitFm(content.toString()).fm : {}
          if (e.kind === 'rule' && isLanguageDead(fm.paths, langProfiles)) continue
          const owners = ownersFor(e)
          const prefixes = prefixesOf(owners)
          if (e.kind === 'rule') content = Buffer.from(toScopedRuleText(content.toString(), prefixes) || content)
          const path = join('.agents', e.kind === 'rule' ? 'rules' : 'skills', ...(s.isFile ? [] : [basename(e.from)]), f.rel)
          files[path] = { content, profiles: owners, kind: e.kind }
          put({ ...ctx, key: entryKey(e) }, path, content, e.kind === 'skill' ? f.abs : null)
          if (e.kind === 'rule') rules.set(path, { path, profiles: owners, title: fm.title || f.rel, rawGlobs: fm.paths || [], globs: scopeGlobs(fm.paths || [], prefixes) })
        }
      }
      codexInput = [files, [...rules.values()]]
    }
    // The check before writing (ADR-0010): every path this run writes or deletes must be
    // absent, or owned and unchanged. A skill is one unit, so its directory holds nothing
    // else; a rule directory keeps unknown files alongside ours (docs/agent-sharing.md).
    // Read as written: its profiles may be ones no source defines any more (remove --source).
    const previous = readLock({ known: false })
    // An override no longer receives what changed under it: say so, and under
    // `update --strict` stop before anything is written.
    const moved = changedUpstream(previous?.overrides, staging.overrides, staging.supplies)
    for (const o of moved) console.log(`⚠ ${o.path} ${o.change} ${o.over} (overridden by ${o.by})`)
    if (moved.length && strictFlag && cmd === 'update')
      throw new Error(`--strict: ${moved.length} overridden path(s) changed upstream; nothing was changed. Review each change, then run \`update\` without --strict to record the new base.`)
    const recorded = ownedFiles(previous)
    const plan = { writes: ctx.out, modes: ctx.modes, deletes: [...recorded.keys()].filter(path => !ctx.out.has(path)) }
    const adopted = adoption(previous, [...new Set(staged.flatMap(({ e }) => agents.flatMap(a => destsFor(e, a))))], agents)
    const corrupt = checkTree({
      ...plan,
      owned: recorded,
      // A skill is one unit: its directory holds nothing else. An adopted destination
      // is overwritten whole, so whatever this run does not write in it goes.
      dirs: adopted.length ? adopted
        : [...new Set([...staged.filter(({ e }) => e.kind === 'skill').flatMap(({ e }) => agents.flatMap(a => destsFor(e, a))),
          ...emptiedSkills(previous?.installed || [], plan.deletes)])],
    })
    // The agents root also holds the repo's own agents, and an unhashed lock cannot
    // tell them from one of ours dropped upstream: adoption never decides that alone,
    // only an explicit --force does.
    const ambiguous = [...corrupt.keys()].some(path => path.startsWith(`${ENTRY_ROOT.agent}/`))
    plan.corrupt = settleCorruption(corrupt, forceFlag || (adopted.length > 0 && !ambiguous))
    if (codexInput) codex = prepareCodex(...codexInput, modules, previous?.codex)
    // Apply: what the previous install wrote and this one no longer produces goes first
    // (an entry dropped upstream, a destination moved), then every write.
    applyTree(plan, path => console.log(`  ✗ ${path}  (no longer installed)`))
    if (codex) applyCodex(codex)
    // Retired targets and the legacy kit root are cleaned up once, by the adoption that
    // listed them; a hashed install deletes only what it recorded.
    if (adopted.length) { purgeRetired(); purgeRetiredSkills(agents, Boolean(codex)); purgeLegacyKit() }
    for (const record of installed)
      record.files = Object.fromEntries((ctx.byEntry.get(entryKey(record)) || []).map(path => [path, hash(ctx.out.get(path))]))
    writeLock(sources, profiles, agents, modules, levels, codex?.inventory, installed, registry.aliases, staging.overrides)
  } finally {
    if (tree) rmSync(tree, { recursive: true, force: true })
  }
  console.log(`\nPinned in ${LOCK} (${sourcesLabel(sources)}, agents: ${agents.join(', ')}).`)
  if (notes.length) {
    console.log(`\nOne-time wiring (the installer never touches your build config):`)
    console.log([...new Set(notes)].join('\n'))
  }
  console.log('\nNext:')
  for (const a of agents) console.log(`  • ${FINAL_MSG[a]}`)
}

// ----------------------------------------------------------------------- init
const GLOB = {
  rust: '**/*.rs',
  ts: '**/*.{ts,tsx}',
  'ts-web': '**/*.{ts,tsx}',
  'ts-node': '**/*.{ts,tsx}',
  'ts-tauri': '**/*.{ts,tsx}',
  go: '**/*.go',
  python: '**/*.py',
}
// The git floor — the only layer of the gate portable across every
// agent. It ships with the generated lefthook.yml rather than waiting for a manual
// merge of common/lefthook.snippet.yml, because a floor nobody wired is not a floor.
// `only: ref` makes it a no-op off the trunk; a solo repo deletes the command.
// The message keeps ": " out on purpose — `run:` is a plain YAML scalar, and a
// colon-space inside one is a parse error ("mapping values are not allowed here").
const TRUNK_GUARD = `    no-commit-on-trunk:\n`
  + `      only:\n        - ref: main\n        - ref: master\n`
  + `      run: node -e "console.error('lefthook — this repo does not commit on the trunk. Branch, commit there, open a PR. (Solo repo that really does commit on main? Delete the no-commit-on-trunk command.)'); process.exit(1)"`
function genLefthook(techs) {
  const cmds = suffix => techs.map(t => `    ${t}:\n      glob: "${GLOB[t]}"\n      run: just ${t}-${suffix}`).join('\n')
  const preCommit = [TRUNK_GUARD, ...(techs.length ? [cmds('lint')] : [])].join('\n')
  return `# Generated by \`claude-rules init\` — thin triggers → justfile recipes.\n`
    + `# Commands and their paths live in the justfile (\`just <tech>-lint\`/\`-check\`).\n`
    + `# The harness layer (per-tool hooks) is separate and manual: kit/common/hooks/README.md.\n\n`
    + `pre-commit:\n  parallel: true\n  commands:\n${preCommit}\n\n`
    + (techs.length ? `pre-push:\n  parallel: true\n  commands:\n${cmds('check')}\n` : '')
}
// The `*_dir` variables, derived from the lock's `modules`. `just` fails at parse
// time on an undefined variable, so all three are always emitted — an unclaimed
// tech simply points at the repo root, exactly as the snippet ships it.
const JUST_START = '# claude-rules:start (managed — derived from .claude-rules.lock)'
const JUST_END = '# claude-rules:end'
const DIR_VAR = {
  rust: 'rust_dir',
  ts: 'ts_dir',
  'ts-web': 'ts_web_dir',
  'ts-node': 'ts_node_dir',
  'ts-tauri': 'ts_tauri_dir',
  go: 'go_dir',
  python: 'python_dir',
}
function genDirsBlock(modules, only = null) {
  const notes = []
  const lines = Object.entries(DIR_VAR).filter(([p]) => !only || only.includes(p)).map(([profile, name]) => {
    const claims = Object.entries(modules || {}).filter(([, ps]) => ps.includes(profile)).map(([d]) => d)
    // `modules` allows a language in several places; a `*_dir` is one directory.
    // Two claimants means the recipe has to cover both, so it runs from the root.
    if (claims.length > 1) notes.push(`${name}: ${claims.join(', ')} both hold ${profile} — set to "." so the recipe covers both`)
    return `${name.padEnd(10)} := "${claims.length === 1 ? claims[0] : '.'}"`
  })
  return { block: [JUST_START, ...lines, JUST_END].join('\n'), notes }
}
// A variable belongs in the block when its language is LOCKED (so the library that
// reads it is imported) — or when the file still mentions it outside the block. That
// second arm is not tidiness: a justfile mid-migration keeps inline recipes for a tech
// this install does not know about, and dropping the variable under them is a parse
// error. Same rule on a file init just wrote and on one it found, so re-running init
// never widens or narrows what the previous run produced.
function writeManagedDirs(file, modules, techs) {
  // Nothing declared, nothing derived: the snippet's defaults and their examples
  // are more useful than three lines of `"."`. Same principle as the glob
  // rewriting — the installer only touches what it was asked to.
  if (!modules || !Object.keys(modules).length) return
  const content = readFileSync(file, 'utf8')
  const re = new RegExp(`${reEsc(JUST_START)}[\\s\\S]*?${reEsc(JUST_END)}`)
  if (!re.test(content)) {
    console.log(`• ${file}: no managed block — wrap your *_dir variables in "${JUST_START}" / "${JUST_END}" for init to keep them in sync with the lock.`)
    return
  }
  const outside = content.replace(re, '')
  const only = Object.entries(DIR_VAR).filter(([p, v]) => techs.includes(p) || outside.includes(v)).map(([p]) => p)
  const { block, notes } = genDirsBlock(modules, only)
  const next = content.replace(re, block)
  if (next === content) return                  // nothing to say: the block already agrees
  writeFileSync(file, next)
  console.log(`✓ ${file}: *_dir block derived from the lock's modules.`)
  for (const n of notes) console.log(`  • ${n}`)
}

// The gates are a just LIBRARY under .dev/kit/, and the root justfile IMPORTS them.
// That is the whole point: a snippet merged by hand could never be updated again, so
// every fix stayed upstream and every installed repo drifted. What the repo writes is
// the COMPOSITION — where each technology lives, what `check` runs, what it overrides —
// and `update` refreshes the recipes underneath it.
//
// `import` needs just >= 1.18; the two `allow-duplicate-*` settings (what lets this
// file override the library) need >= 1.27.
const JUST_MIN = '1.27'
// Derived from what is ON DISK, not from a registry field: a profile whose kit ships a
// `.just` gets imported, and the CLI stays dumb. Written with forward slashes — `just`
// takes them on every platform, and a backslash would be an escape in the justfile.
function kitImports() {
  if (!existsSync(KIT_DIR)) return []
  const found = []
  for (const d of readdirSync(KIT_DIR)) {
    const sub = join(KIT_DIR, d)
    if (!statSync(sub).isDirectory()) continue
    for (const f of readdirSync(sub)) if (f.endsWith('.just')) found.push(`${KIT_DIR}/${d}/${f}`)
  }
  // common first — it defines `base`, which the language libraries read. Then
  // alphabetical, so re-running init on the same install yields the same file.
  const rank = p => (p.includes('/common/') ? 0 : 1)
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
const MUTATOR = {
  rust: 'rust-mutate',
  ts: 'ts-mutate',
  'ts-web': 'ts-web-mutate',
  'ts-node': 'ts-node-mutate',
  'ts-tauri': 'ts-tauri-mutate',
  go: 'go-cover',
  python: 'python-mutate',
}
// Which of those take the range start as an argument. Only cargo-mutants does:
// Stryker (`--incremental`) and mutmut keep their own caches, and `go-cover` measures
// the whole tree. Passing `mutate-from` to one of the others is an unknown argument,
// not a harmless no-op — which is why this is a set and not a `.map`.
const RANGE_MUTATORS = new Set(['rust-mutate'])

/** The `mutate-diff` recipe BODY: feed the marker in, advance it on the way out.
 *
 *  It has to be a body, not `mutate-diff: rust-mutate`. A dependency list runs each
 *  mutator with its DEFAULT range — the whole branch — and never calls `mutate-mark`,
 *  so `.work/<slug>/.latest_mutate` is never written and every run re-mutates what the
 *  previous ones already cleared. That is the exact cost `diff-since.mjs` exists to
 *  remove, and `code-review` avoids only because it is one self-contained recipe that
 *  marks at its end. The shape below is the one kit/common/gate.just documents.
 *
 *  `just` stops a recipe at the first failing line, so `mutate-mark` runs LAST and only
 *  on success: a surviving mutant leaves the marker where it was, and the next run
 *  re-mutates that block together with its fix. */
const mutateBody = (list) => [
  'mutate-diff:',
  ...list.map(m => RANGE_MUTATORS.has(m) ? `    just ${m} "$(just mutate-from)"` : `    just ${m}`),
  '    just mutate-mark',
]
function genJustfile(techs, modules, ratchetTechs = []) {
  const imports = kitImports()
  const deps = techs.map(checkDep).join(' ')
  const mutators = techs.map(t => MUTATOR[t]).filter(Boolean)
  const liveMutators = ratchetTechs.map(t => MUTATOR[t]).filter(Boolean)
  const out = [
    '# The gate, composed. Written once by `claude-rules init` — yours from here on.',
    '#',
    `# The recipes are a LIBRARY under ${KIT_DIR}/, imported below, and \`claude-rules update\``,
    '# refreshes it — so a fix upstream reaches this repo. THIS file holds only what is',
    '# true of this repo: where each technology lives, what `check` runs, what it',
    '# overrides, and whatever else you add.',
    '#',
    `# Needs just >= ${JUST_MIN} (install: cargo/brew/scoop install just).`,
    '',
    '# A recipe or variable defined here wins over the imported one. That is what makes',
    '# the library adaptable without forking it, and just needs both settings to allow it.',
    'set allow-duplicate-recipes := true',
    'set allow-duplicate-variables := true',
    '',
    ...(imports.length ? imports.map(p => `import '${p}'`) : [`# (no kit installed yet — \`claude-rules add <profile...>\`, then re-run init)`]),
    '',
    '# Where each technology lives, derived from the lock\'s `modules` — declare them with',
    '# `add <profile...> --module <dir>` (e.g. api/, apps/web, services/ingest) and this',
    '# block follows. Edit it by hand if you prefer, but the next `init` rewrites it;',
    '# nothing outside the markers is ever touched.',
    genDirsBlock(modules, techs).block,
    '',
    '# The trunk a feature is measured against. The library defaults to origin/main.',
    '# base := "origin/trunk"',
    '',
    '# THE recipe — the one an agent closes its loop on before handing back, in seconds.',
    '# T3 review runs per coherent block; T4 mutation gates the PR after calibration.',
    '# Neither belongs in this per-iteration recipe. Opt-in gates to add as you enable',
    '# them: adr-check docs-check rules-check dup-check'
      + (existsSync(join(KIT_DIR, 'godot')) ? ' — and godot-check, once godot_dir/godot_bin/godot_export_preset are set' : ''),
    deps ? `check: ${deps}` : '# check: adr-check docs-check    # no language locked — list the gates this repo has',
  ]
  // Only when there is a mutation recipe to name. A hint pointing at a recipe no import
  // provides (`rust-mutate` in a repo with no Rust) is worse than no hint at all.
  //
  // The marker recipes (`mutate-from`/`mutate-mark`) live in kit/common, so a repo that
  // installed a language without it keeps the dependency form — which is also why
  // `rust-mutate` still defaults its range to `base`.
  const incremental = existsSync(join(KIT_DIR, 'common'))
  const shape = (list) => incremental ? mutateBody(list) : [`mutate-diff: ${list.join(' ')}`]
  const marker = incremental
    ? ['# The range comes from `mutate-from` and is advanced by `mutate-mark` ON SUCCESS',
       '# only, so a branch built by successive blocks re-mutates only what is new.']
    : []
  if (liveMutators.length) out.push('',
    '# Tier 4 — do the tests ASSERT, or do they merely execute? Coverage cannot answer',
    '# that; mutation can. Minutes, not seconds: NEVER a git hook, never part of `check`.',
    '# This recipe is live because a locked tech is at --level ratchet.',
    ...marker,
    ...shape(liveMutators))
  else if (mutators.length) out.push('',
    '# Tier 4 — do the tests ASSERT, or do they merely execute? Coverage cannot answer',
    '# that; mutation can. Minutes, not seconds: NEVER a git hook, never part of `check`.',
    '# PR gate after calibration; local runs are optional. Uncomment once the tool',
    '# is installed, wire its CI job and ratchet the measured baseline to blocking.',
    '# Declare absent/non-blocking checks. Gitignore pr.diff and coverage.out.',
    ...marker,
    ...shape(mutators).map(l => `# ${l}`))
  return out.join('\n') + '\n'
}

// Reported, never rewritten: a justfile that predates the library holds the recipes
// inline, and only the human can tell which of them drifted on purpose. The proof that
// a migration lost nothing is deterministic, so it is what gets printed.
function reportImportDrift(file) {
  const text = readFileSync(file, 'utf8')
  const imports = kitImports()
  const missing = imports.filter(p => !text.includes(p))
  if (!imports.length || !missing.length) {
    if (imports.length) console.log(`  ✓ imports the kit library (${imports.length} file(s))`)
    return
  }
  console.log(`  • ${missing.length} kit librar${missing.length > 1 ? 'ies are' : 'y is'} not imported — add at the top of ${file}:`)
  if (!/allow-duplicate-recipes/.test(text)) console.log('      set allow-duplicate-recipes := true')
  if (!/allow-duplicate-variables/.test(text)) console.log('      set allow-duplicate-variables := true')
  for (const p of missing) console.log(`      import '${p}'`)
  console.log(`    Then delete the recipes the library now provides, keeping any you changed on purpose.`)
  console.log(`    \`just --summary\` and \`just --evaluate\` flatten imports, so a before/after diff of both`)
  console.log(`    is the proof the migration lost nothing (${KIT_DIR}/common/README.md).`)
}

// `check` is THE recipe — the one an agent closes its loop on. The generated file has to
// ship some version of it and ships the Rust one, so a python-only repo got a gate
// that runs cargo and never runs `python-check`: the locked tech was not in the gate
// at all. The lock knows which techs exist, so derive the line from it on creation.
// An existing justfile is the repo's own file and is never rewritten — there the
// drift is only reported, because the deps a repo added (adr-check, docs-check…)
// are exactly what a rewrite would silently drop.
const CHECK_RE = /^check:[ \t]*(.*)$/m
const checkDep = t => `${t}-check`
const isTechDep = d => Object.keys(GLOB).some(t => checkDep(t) === d)
function reportCheckDrift(file, techs) {
  const m = readFileSync(file, 'utf8').match(CHECK_RE)
  const want = techs.map(checkDep)
  if (!m) {
    if (want.length) console.log(`  • no \`check\` recipe in ${file} — the agent closes its loop on \`just check\`; add \`check: ${want.join(' ')}\`.`)
    return
  }
  const deps = m[1].split(/\s+/).filter(Boolean)
  const missing = want.filter(d => !deps.includes(d))
  const stale = deps.filter(d => isTechDep(d) && !want.includes(d))
  if (missing.length) console.log(`  • \`check\` does not run ${missing.join(', ')} — the lock has [${techs.join(', ')}], so that tech's gate never runs.`)
  if (stale.length) console.log(`  • \`check\` runs ${stale.join(', ')}, which no locked profile provides — it fails on a toolchain this repo does not have.`)
}

// A CLAUDE.md the installer writes ONCE and never touches again. The conventions
// already live in .claude/rules/ and load on their own — what belongs here is the
// part only this repo knows: what each module is, and where its documents are.
// Claude reads CLAUDE.md and never AGENTS.md — not as a fallback, not in addition
// (code.claude.com/docs/en/memory, "AGENTS.md"; re-verified 2026-08). So without this
// file a Claude-first repo starts every session with no map at all. Do not bridge
// that with an `@AGENTS.md` import: Cursor already has `.cursor/rules/`, and a
// leftover Codex block in AGENTS.md would pay for the same conventions twice.
function genClaudeMd(lock) {
  const name = basename(process.cwd())
  const mods = Object.entries(lock.modules || {})
  const out = [`# ${name}`, '',
    '<!-- Written once by `claude-rules init` — yours from here, the installer never',
    '     rewrites it. Conventions live in .claude/rules/ and auto-load (language',
    '     rules only when you touch matching files). Keep this file short: it is in',
    '     context for every session. -->', '', '## Modules', '']
  if (mods.length) {
    out.push('| Path | Profiles | Gate |', '|---|---|---|')
    for (const [dir, ps] of mods) {
      const tech = ps.find(p => DIR_VAR[p])
      out.push(`| \`${dir}\` | ${ps.join(', ')} | ${tech ? `\`just ${tech}-check\`` : '—'} |`)
    }
  } else {
    out.push('<!-- One line per module: what it is, and what it is for. Declare them to the',
      '     installer too (`add <profile...> --root <dir>`) so its rules stop loading',
      '     everywhere your language happens to appear. -->')
  }
  const autonomy = (lock.profiles || []).includes('agent')
    ? ' (`.claude/rules/agent/autonomy.md`).'
    : '.'
  out.push('', '## The gate', '',
    'Run `just check` and read the exit code before handing back — a green gate is',
    `the authority, never your own say-so${autonomy}`, '')
  const docs = ['docs/PRD.md', 'docs/ARCHITECTURE.md', 'docs/PLAN.md', 'docs/adr'].filter(existsSync)
  if (docs.length) out.push('## Documents', '', ...docs.map(d => `- \`${d}\``), '')
  return out.join('\n')
}

function initRepo() {
  const lock = readLock({ known: false })
  if (!lock) { console.error(`No ${LOCK} — run "add <profile...>" first.`); process.exit(1) }
  const levels = lock.levels || Object.fromEntries((lock.profiles || []).map(p => [p, 'gates']))
  const techs = lock.profiles.filter(p => GLOB[p] && levelRank(levels[p] || 'rules') >= levelRank('gates'))
  const ratchetTechs = lock.profiles.filter(p => MUTATOR[p] && (levels[p] || 'rules') === 'ratchet')
  const kitBase = KIT_DIR
  const justfile = ['justfile', 'Justfile'].find(existsSync)
  if (justfile) {
    console.log(`• ${justfile} exists — left untouched (the installer only owns the block below).`)
    reportImportDrift(justfile)
    reportCheckDrift(justfile, techs)
  } else if (existsSync(kitBase)) {
    writeFileSync('justfile', genJustfile(techs, lock.modules, ratchetTechs))
    const n = kitImports().length
    console.log(`✓ created justfile — imports ${n} kit librar${n === 1 ? 'y' : 'ies'}${techs.length ? `, \`check\` runs: ${techs.map(checkDep).join(' ')}` : ''}.`)
    for (const note of genDirsBlock(lock.modules, techs).notes) console.log(`  • ${note}`)
  } else console.log(`• no ${kitBase}/ — run "add <profile...>" first.`)
  const target = justfile || (existsSync('justfile') ? 'justfile' : null)
  if (target) writeManagedDirs(target, lock.modules, techs)

  // Written once, then left alone — same contract as the justfile above.
  if (lock.agents && lock.agents.includes('claude')) {
    if (existsSync('CLAUDE.md') || existsSync(join('.claude', 'CLAUDE.md')))
      console.log('• CLAUDE.md exists — left untouched (the installer never rewrites it).')
    else { writeFileSync('CLAUDE.md', genClaudeMd(lock)); console.log('✓ created CLAUDE.md — fill in what only you know; Claude reads it, never AGENTS.md.') }
  }

  // Written even with no language locked: the trunk guard is the git floor, and it
  // holds in a repo whose only asset is documents.
  if (existsSync('lefthook.yml') || existsSync('lefthook.yaml'))
    console.log(`• lefthook.yml exists — merge ${kitBase}/<tech>/lefthook.snippet.yml (thin triggers) and ${kitBase}/common/lefthook.snippet.yml (trunk guard + review-guard) into it.`)
  else { writeFileSync('lefthook.yml', genLefthook(techs)); console.log(`✓ created lefthook.yml (no-commit-on-trunk${techs.length ? ` + triggers for: ${techs.join(', ')}` : ''}).`) }

  if (!existsSync('.git')) console.log('• not a git repo — run `lefthook install` after `git init`.')
  else { const r = spawnSync('lefthook', ['install'], { stdio: 'inherit' }); if (r.error) console.log('• lefthook not found — install it, then run: lefthook install') }

  console.log(`\nStill manual (repo-specific): move rustfmt.toml+deny.toml→<rust_dir>, mutants.toml→<rust_dir>/.cargo/, golangci.base.yml→.golangci.yml, merge pyproject.snippet.toml→<python_dir>/pyproject.toml, mutation-ci.yaml→.gitea/workflows/; adapt eslint globalIgnores; enable \`adr-check\`/\`docs-check\`/\`rules-check\`/\`dup-check\` in the justfile \`check\` recipe (the locked techs are already wired) and uncomment \`mutate-diff\` once the mutation tools are installed. The gate SCRIPTS need no move any more — the recipes call them in ${KIT_DIR}/common/ directly, so an update refreshes gate and implementation together; \`just code-review\` still needs \`reviewer\` set to the chosen review agent, \`.work/\` gitignored, and its pre-push trigger merged from common/lefthook.snippet.yml. Harness layer (optional, one snippet per tool): merge common/hooks/settings.snippet.json into .claude/settings.json — or the cursor snippet next to it — see common/hooks/README.md for what it does and does not guarantee.`)
}

// --------------------------------------------------------------------- doctor
// Audits an install against the repo it lives in. Offline and deterministic —
// no network, no LLM, no staging: everything it needs is the lock, the registry
// and the files on disk. Wireable into `just check`.
//
// Like the other gates (adr-check, docs-check): it FAILS on facts (the install
// contradicts the lock) and WARNS on judgments (a rule that can never trigger,
// a context budget). `--strict` promotes the warnings.

// Minimal glob → RegExp. Covers the syntax the shipped `paths:` actually use:
// `**/`, `**`, `*`, `?`, `{a,b}`. Not a general globber — a rule using anything
// else is reported as unmatched rather than silently mis-evaluated.
const GLOB_UNSUPPORTED = /[[\]!()+@]/
function globToRe(glob) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re = '', i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3 } else { re += '.*'; i += 2 }
    } else if (c === '*') { re += '[^/]*'; i += 1 }
    else if (c === '?') { re += '[^/]'; i += 1 }
    else if (c === '{' && glob.includes('}', i)) {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map(esc).join('|') + ')'
      i = end + 1
    } else { re += esc(c); i += 1 }
  }
  return new RegExp(`^${re}$`)
}

// The repo's own files. The installer's own output is excluded on purpose:
// `.dev/kit/portal-http/openapi-ts.config.ts` must not make a `**/*.ts`
// rule look alive in a repo that has no TypeScript.
const SCAN_SKIP = new Set(['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', 'coverage', '.next',
  '.claude', '.agents', '.cursor', '.dev'])
function repoFiles() {
  const git = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  const fromGit = !git.error && git.status === 0 ? git.stdout.split('\n').filter(Boolean) : null
  if (fromGit) return fromGit.filter(f => !SCAN_SKIP.has(f.split('/')[0]))
  const out = []
  const rec = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      if (SCAN_SKIP.has(name)) continue
      const abs = join(dir, name), rel = prefix ? `${prefix}/${name}` : name
      let st; try { st = statSync(abs) } catch { continue }        // broken symlink
      if (st.isDirectory()) rec(abs, rel); else out.push(rel)
    }
  }
  rec('.', '')
  return out
}

// Emitted rules, read back from one target's tree. Each target names its own root
// and its own glob key — the transform renames `paths:` to `globs:` on the way out,
// so measuring Cursor means reading the Cursor key, not guessing.
const RULE_TREE = {
  claude: { root: '.claude/rules', key: 'paths', complete: true },
  cursor: { root: '.cursor/rules', key: 'globs', complete: true },
  codex: { root: '.agents/rules', key: 'paths', complete: true },
}
// `agent` null = "whatever is installed", Claude first. Naming a target is how
// `budget --agent cursor` becomes measurable at all: without it the Claude tree
// always won and the Cursor floor was unobservable.
function installedRules(agent = null) {
  for (const a of agent ? [agent] : KNOWN_AGENTS) {
    const { root, key, complete } = RULE_TREE[a] || {}
    if (!root || !existsSync(root)) continue
    const files = walk(root).filter(f => /\.mdc?$/.test(f.rel))
    return {
      agent: a,
      root,
      complete,
      rules: files.map(f => {
        const { fm } = splitFm(readFileSync(f.abs, 'utf8'))
        return { rel: f.rel, path: join(root, f.rel), size: statSync(f.abs).size, title: fm.title || fm.description || f.rel, globs: Array.isArray(fm[key]) ? fm[key] : [] }
      }),
    }
  }
  return { agent: null, root: null, complete: false, rules: [] }
}

// Every skill's description is read at session start so the agent can decide
// whether to open it — a roster is a standing cost, not a free option.
function skillDescriptions(agent = 'claude') {
  const root = SKILL_DIR[agent]
  if (!existsSync(root)) return []
  return readdirSync(root)
    .map(n => ({ name: n, file: join(root, n, 'SKILL.md') })).filter(s => existsSync(s.file))
    .map(s => ({ name: s.name, size: (splitFm(readFileSync(s.file, 'utf8')).fm.description || '').length }))
}

const kb = n => `${(n / 1024).toFixed(1)} KB`
const tok = n => `~${Math.round(n / 4 / 100) / 10}k tokens`      // bytes→tokens, the usual ~4:1
const sum = xs => xs.reduce((n, x) => n + x, 0)

// --------------------------------------------------------------------- budget
// "What does opening this file cost me?" — the question every context decision
// turns on, and the one nobody could answer without reading the tree by hand.
// Same inputs as doctor: the emitted rules and their globs, nothing else.
// `--agent` picks which target is measured; the two floors differ (Cursor puts
// unscoped rules on `alwaysApply: true`), so a routing change has to be checked
// on both or it is only half verified.
function budget(target, agent = null) {
  if (agent === 'codex' || (!agent && installedRules().agent === 'codex')) return codexBudget(readLock({ known: false }), target, globToRe)
  const { root, complete, rules, agent: measured } = installedRules(agent)
  if (!root) {
    console.error(agent
      ? `No emitted rule tree for ${agent} (${RULE_TREE[agent].root} is absent) — run "add <profile...> --agent ${agent}" first.`
      : 'No emitted rule tree found — run "add <profile...>" first.')
    process.exit(1)
  }
  const path = target ? target.replace(/^\.\//, '').replace(`${process.cwd()}/`, '') : null
  if (path && !existsSync(path)) console.log(`(${path} does not exist here — showing what WOULD load for that path)\n`)

  const always = rules.filter(r => !r.globs.length).sort((a, b) => b.size - a.size)
  const hit = path
    ? rules.filter(r => r.globs.some(g => globToRe(g).test(path))).sort((a, b) => b.size - a.size)
    : []
  const skills = skillDescriptions(measured)
  const rows = []
  const push = (label, size, detail = '') => rows.push([label, size, detail])

  console.log(`${path ? `Context for ${path}` : 'Session floor — what loads before any file is read'}  ·  ${measured}\n`)
  if (!complete) console.log(`  (measured from ${root}, which holds only path-scoped rules — the always-on ones are inlined elsewhere)\n`)
  push(`always-on rules (${always.length})`, sum(always.map(r => r.size)))
  for (const r of always) push(`    ${r.rel}`, r.size)
  push(`skills, descriptions (${skills.length})`, sum(skills.map(s => s.size)))
  if (path) {
    push(`path-scoped rules (${hit.length})`, sum(hit.map(r => r.size)))
    for (const r of hit) push(`    ${r.rel}`, r.size, r.globs.find(g => globToRe(g).test(path)))
  }
  const total = sum(always.map(r => r.size)) + sum(skills.map(s => s.size)) + sum(hit.map(r => r.size))

  const w = Math.max(...rows.map(([l]) => l.length))
  for (const [label, size, detail] of rows)
    console.log(`  ${label.padEnd(w)}  ${kb(size).padStart(9)}  ${label.startsWith('    ') ? (detail ? `  ${detail}` : '') : `(${tok(size)})`}`.trimEnd())
  console.log(`  ${'total'.padEnd(w)}  ${kb(total).padStart(9)}  (${tok(total)})`)
  if (path && !hit.length) console.log('\n  • no path-scoped rule matches — either nothing covers this file, or a glob is anchored to the wrong module.')
}

// ------------------------------------------------------------- gate-layer audit
// Two layers, two questions. The git floor: is lefthook a file git actually calls?
// The harness layer: does each wired guard point at a script that exists? Both are
// answered from files alone — no subprocess, so doctor stays offline and orderable.

/** Where git looks for hooks, or null when we cannot tell (worktree, submodule, no repo). */
function gitHooksDir() {
  if (!existsSync('.git') || !statSync('.git').isDirectory()) return null
  const cfg = existsSync(join('.git', 'config')) ? readFileSync(join('.git', 'config'), 'utf8') : ''
  const m = cfg.match(/^\s*hooksPath\s*=\s*(.+)$/m)
  return m ? m[1].trim() : join('.git', 'hooks')
}

// Every string in a JSON tree, keys included. `_`-prefixed keys are skipped: the
// shipped snippets carry their wiring notes in `_comment`, and prose that NAMES
// a guard is not prose that WIRES one.
const jsonStrings = v => typeof v === 'string' ? [v]
  : Array.isArray(v) ? v.flatMap(jsonStrings)
  : v && typeof v === 'object'
    ? Object.entries(v).filter(([k]) => !k.startsWith('_')).flatMap(([k, x]) => [k, ...jsonStrings(x)])
    : []

// Per host: where its config lives, how to tell the guards are wired, and which
// snippet to name when they are not. Both remaining targets EXECUTE a guard, so a
// path that is not there is a fact worth failing on.
const HARNESS = {
  claude: { files: ['.claude/settings.json', '.claude/settings.local.json'], snippet: 'settings.snippet.json',     wired: s => /-guard\.mjs/.test(s), runs: true },
  cursor: { files: ['.cursor/hooks.json'],                                   snippet: 'cursor-hooks.snippet.json', wired: s => /-guard\.mjs/.test(s), runs: true },
}

// A justfile that redefines what the library already provides is the drift the import
// exists to kill: the copy is frozen at install time, so every fix upstream stops here.
// A WARNING, not a failure — an install that predates the library is in exactly this
// state, and the migration is a judgement call the installer must not make for you.
// The recipe names are read out of the library files, so this stays true as they change.
function auditJustfile(warn) {
  const justfile = ['justfile', 'Justfile'].find(existsSync)
  const libs = kitImports()
  if (!justfile || !libs.length) return
  const text = readFileSync(justfile, 'utf8')
  const own = new Set([...text.matchAll(/^([a-z][a-z0-9-]*)\s*:(?![=])/gm)].map(m => m[1]))
  for (const lib of libs) {
    if (text.includes(lib)) continue
    const recipes = [...readFileSync(lib, 'utf8').matchAll(/^([a-z][a-z0-9-]*)\s*:(?![=])/gm)].map(m => m[1])
    const shadowed = recipes.filter(r => own.has(r))
    warn.push(`${justfile} does not import ${lib}`
      + (shadowed.length ? ` and redefines ${shadowed.length} of its recipes (${shadowed.slice(0, 4).join(', ')}${shadowed.length > 4 ? '…' : ''}) — those copies are frozen at install time and \`update\` cannot reach them` : ' — the gates it ships are unreachable')
      + `. Migration + the equivalence proof: ${KIT_DIR}/common/README.md`)
  }
}

function auditGateLayer(agents, bad, warn) {
  auditJustfile(warn)
  // --- the floor
  const lefthook = ['lefthook.yml', 'lefthook.yaml'].find(existsSync)
  const hooksDir = gitHooksDir()
  if (!lefthook) {
    console.log('  • no lefthook.yml — the git floor (no-commit-on-trunk, review-guard) is not wired here; merge kit/common/lefthook.snippet.yml.')
  } else {
    const pre = hooksDir ? join(hooksDir, 'pre-commit') : null
    const called = pre && existsSync(pre) && /lefthook/.test(readFileSync(pre, 'utf8'))
    if (hooksDir && !called) bad.push(`${lefthook} is on disk but git is not calling it (${hooksDir}/pre-commit does not mention lefthook) — every hook in it is inert. Run \`lefthook install\`.`)
    else console.log(`  ✓ ${lefthook}${called ? ' (git calls it)' : ''}`)
    const text = readFileSync(lefthook, 'utf8')
    if (!/no-commit-on-trunk/.test(text))
      console.log('  • no `no-commit-on-trunk` command — legitimate in a solo repo that commits on main, otherwise merge it from kit/common/lefthook.snippet.yml.')
    if (!/review-guard/.test(text))
      console.log('  • no `review-guard` trigger — a CRITICAL review cannot block a push (opt-in: needs an agent CLI).')
  }

  // --- the harness layer. One kit dir for every agent, but the WIRING is per host:
  // the same guards are referenced from .claude/settings.json or .cursor/hooks.json,
  // and each has to be checked where that host reads it.
  for (const agent of agents) {
    const shipped = existsSync(join(KIT_DIR, 'common', 'hooks'))
    const host = HARNESS[agent]
    if (!host) continue
    const present = host.files.filter(existsSync)
    const texts = []
    for (const f of present) {
      const json = (() => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } })()
      if (!json) { warn.push(`${f} is not valid JSON — ${agent} ignores it, so anything wired there (hooks, permissions) is not in force`); continue }
      texts.push({ file: f, strings: jsonStrings(json) })
    }
    const wired = texts.filter(t => t.strings.some(host.wired))
    if (!wired.length) {
      if (shipped) console.log(`  • ${agent}: harness guards installed (${KIT_DIR}/common/hooks/) but nothing wires them — merge ${host.snippet} (opt-in).`)
      continue
    }
    // A path typo makes the hook silently never fire, which is indistinguishable
    // from having no hook — so the reference itself is what gets checked. Only a
    // path (it carries a separator) is checked: a bare name is prose, not a command.
    let missing = 0
    if (host.runs) {
      for (const t of wired) {
        for (const s of t.strings) {
          for (const m of s.matchAll(/[\w.-]+(?:\/[\w.-]+)+-guard\.mjs/g)) {
            if (existsSync(m[0])) continue
            missing++
            bad.push(`${t.file} wires ${m[0]}, which is not on disk — the hook fires and finds nothing (run \`update\`, or fix the path)`)
          }
        }
      }
    }
    if (!missing) console.log(`  ✓ ${agent}: guards wired in ${wired.map(t => t.file).join(', ')}`)
  }
}

function doctor() {
  const lock = readLock({ known: false })
  if (!lock) { console.error(`No ${LOCK} — nothing to audit. Run "add <profile...>" first.`); process.exit(1) }
  const { kept, dropped } = agentsFromLock(lock)
  const agents = kept.length ? kept : ['claude']
  const bad = [], warn = []
  console.log(`claude-rules doctor — ${process.cwd()}\n`)

  // ---- 1. the lock itself
  console.log('Install')
  // A hashed inventory says what was installed, from whichever sources: no registry is
  // needed to audit it. A lock without one falls back to the bundled registry.
  const inventory = recordsHashes(lock) ? lock.installed : null
  const unknownP = inventory ? [] : lock.profiles.filter(p => !registry.profiles[p])
  for (const p of unknownP) bad.push(`lock references profile "${p}", unknown to the registry bundled with this CLI — its files cannot be audited here (run doctor from the CLI at the locked ref)`)
  for (const a of dropped) bad.push(`lock still lists retired agent "${a}" — run \`update\` to drop it`)
  console.log(`  ✓ lock: [${lock.profiles.join(', ')}] for [${(lock.agents || ['claude']).join(', ')}] @ ${sourcesLabel(lock.sources)}`)
  // A module path that does not exist anchors every one of its globs to nothing —
  // the rules are emitted, look installed, and can never match a file.
  for (const [dir, ps] of Object.entries(lock.modules || {})) {
    if (!existsSync(dir)) bad.push(`module "${dir}" does not exist — [${ps.join(', ')}] are anchored to a path that is not there`)
    else console.log(`  ✓ module ${dir}: ${ps.join(', ')}`)
    for (const p of ps.filter(p => !lock.profiles.includes(p))) bad.push(`module "${dir}" claims "${p}", which is not in the lock's profiles`)
    for (const p of ps.filter(p => dir !== '.' && ROOT_FORBID.has(p))) bad.push(`module "${dir}" claims "${p}", whose rules anchor to one shared repo-root docs tree — remove it from that module's list in ${LOCK} (run \`update\` after); ${p} stays repo-wide regardless of --root`)
  }

  // ---- 2. what the lock promises vs what is on disk
  const expected = new Map()
  const lockedEntries = inventory
    ? inventory.map(e => [e.profile ?? '(shared)', [e]])
    : [['(shared)', registry.shared], ...lock.profiles.map(p => [p, entriesAt(p, (lock.levels || {})[p] || 'gates')])]
  // From the inventory, a destination is promised only when a recorded file sits in it.
  const promised = (e, d) => !inventory || Object.keys(e.files).some(f => f === d || f.startsWith(d + '/'))
  for (const [profile, entries] of lockedEntries)
    for (const e of entries) for (const a of agents)
      for (const d of destsFor(e, a).filter(d => promised(e, d))) if (a !== 'codex' || e.kind !== 'rule') expected.set(d, { profile, agent: a })

  for (const [dest, meta] of expected)
    if (!existsSync(dest)) bad.push(`${dest} — promised by "${meta.profile}" for ${meta.agent}, missing on disk (run \`update\`)`)
  // Every inventoried file, as it was written. Codex's own assets are audited below.
  for (const e of inventory || []) for (const [path, digest] of Object.entries(e.files)) {
    if (lock.codex?.files?.[path]) continue
    safePath(path)
    if (!existsSync(path)) bad.push(`${path} — installed by "${e.profile ?? '(shared)'}", missing on disk (run \`update\`)`)
    else if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== digest)
      bad.push(`${path} — edited since it was installed: move the change to .dev/overrides/, or \`update --force\` to restore it`)
  }

  for (const dir of RETIRED_DIRS)
    if (existsSync(dir)) bad.push(`${dir} — leftover from a retired agent target (OpenCode / Antigravity). Delete it: \`update\` purges it only when it adopts a lock without file hashes.`)
  if (agents.includes('codex')) {
    for (const rule of lock.codex?.rules || []) {
      const owners = rule.profiles.filter(p => lock.profiles.includes(p))
      const prefixes = owners.some(p => !prefixesFor(p, lock.modules).length) ? [] : [...new Set(owners.flatMap(p => prefixesFor(p, lock.modules)))]
      if (owners.length !== rule.profiles.length || JSON.stringify(scopeGlobs(rule.rawGlobs, prefixes)) !== JSON.stringify(rule.globs))
        bad.push(`${rule.path} — stale Codex membership/scope; run update`)
    }
    auditCodex(lock, bad, warn)
  }
  else if (existsSync('AGENTS.md') && readFileSync('AGENTS.md', 'utf8').includes(AGENTS_START))
    warn.push('AGENTS.md has a managed block outside the selected targets; preserved. Select codex to adopt it explicitly.')

  const known = new Set()
  for (const entries of [registry.shared, ...Object.values(registry.profiles)])
    for (const e of entries) for (const a of KNOWN_AGENTS) for (const d of destsFor(e, a)) if (a !== 'codex' || e.kind === 'kit') known.add(d)
  // A directory around an inventoried destination (`.claude/agents` around an overlay's
  // single agent file) is explained by it.
  const holds = d => [...expected.keys()].some(x => x.startsWith(d + '/'))
  for (const d of known)
    if (existsSync(d) && !expected.has(d) && !holds(d)) bad.push(`${d} — on disk but nothing in the lock explains it; agents load it silently. Delete it, or \`add\` the profile (or \`--agent\`) that owns it.`)

  // ---- 3. rules that can never fire here
  const files = repoFiles()
  const { root, complete, rules } = installedRules()
  const dead = []
  if (root) {
    for (const r of rules) {
      if (!r.globs.length) continue
      if (r.globs.some(g => GLOB_UNSUPPORTED.test(g))) continue          // not ours to judge
      if (!r.globs.some(g => { const re = globToRe(g); return files.some(f => re.test(f)) })) dead.push(r)
    }
  }
  console.log(`\nCoverage — ${files.length} repo files scanned against ${rules.filter(r => r.globs.length).length} path-scoped rules`)
  if (!root) console.log('  • no emitted rule tree found — nothing to check')
  else if (!dead.length) console.log('  ✓ every path-scoped rule matches at least one file')
  else {
    for (const r of dead) console.log(`  ! ${r.rel}  —  ${r.globs.join(', ')}`)
    warn.push(`${dead.length} rule(s) match no file here and can never load: ${dead.map(r => r.rel).join(', ')} — drop the profile that ships them, or the repo does not (yet) hold what they cover`)
  }

  // ---- 4. what every session pays before reading a line of code
  console.log('\nContext budget (always-on)')
  if (agents.includes('claude')) {
    const claude = installedRules('claude')
    if (!claude.root) console.log('  • claude is locked but .claude/rules/ is absent — cannot measure')
    else {
      const on = claude.rules.filter(r => !r.globs.length).sort((a, b) => b.size - a.size)
      const total = on.reduce((n, r) => n + r.size, 0)
      console.log(`  rules       ${String(on.length).padStart(3)} files  ${kb(total).padStart(9)}  (${tok(total)})`)
      for (const r of on.slice(0, 3)) console.log(`                ${r.rel} — ${kb(r.size)}${total ? ` (${Math.round(r.size / total * 100)}%)` : ''}`)
    }
    const skills = skillDescriptions()
    if (skills.length) {
      const total = sum(skills.map(s => s.size))
      console.log(`  skills      ${String(skills.length).padStart(3)} found  ${kb(total).padStart(9)}  (${tok(total)}, descriptions only)`)
    }
    if (!existsSync('CLAUDE.md') && !existsSync(join('.claude', 'CLAUDE.md')))
      warn.push('claude is locked but the repo has no CLAUDE.md — Claude reads CLAUDE.md, never AGENTS.md (no fallback), so it starts every session with no project map. Run `init` for a skeleton.')
  }

  // ---- 5. the gate layer: wired, or wired to nothing?
  // The same split as the rest of doctor, with one addition. A FACT fails: a hook
  // that points at a script which is not on disk can never run, and a lefthook.yml
  // git was never told about is inert — both look installed and guard nothing. An
  // OPT-IN absence is only a NOTICE: the harness layer and the trunk guard are
  // things a repo may legitimately decline, and a gate nobody chose is not drift.
  console.log('\nGate layer')
  auditGateLayer(agents, bad, warn)

  // ---- verdict
  const fail = bad.length + (strictFlag ? warn.length : 0)
  if (bad.length) { console.log('\nProblems'); for (const b of bad) console.log(`  ✗ ${b}`) }
  if (warn.length) { console.log('\nWarnings'); for (const w of warn) console.log(`  ! ${w}`) }
  if (!bad.length && !warn.length) console.log('\n✓ nothing to report.')
  else console.log(`\n${bad.length} problem(s), ${warn.length} warning(s)${strictFlag ? ' (--strict: warnings fail)' : ''}.`)
  if (fail) process.exit(1)
}

// `add` EXTENDS the install; it never redefines it. Writing only the new
// profiles would leave the previous ones on disk but out of the lock —
// invisible to `update`, and orphaned by `remove all`, which then deletes
// the lock and leaves no way to find them.
// `agentsRaw`/`levelName`/`rootDirRaw` are null for "use the flag/lock default";
// the interactive prompt below passes explicit answers instead of CLI flags.
async function runAdd(fetched, { requestedRaw, agentsRaw, levelName, rootDirRaw }) {
  const requested = unpackNames(requestedRaw)
  const lock = readLock()
  const migrated = migrateLegacyLock(lock)
  const profiles = [...new Set([...migrated.profiles, ...requested])]
  // Same rule for agents: no explicit choice on an existing install keeps its
  // set (never silently widen to both); an explicit choice adds a target.
  // Retired names in an old lock are dropped, not re-emitted.
  const { kept: locked, dropped } = agentsFromLock(lock)
  if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}\n`)
  const agents = [...new Set([...locked, ...parseAgents(agentsRaw ?? locked.join(','))])]
  const levels = { ...migrated.levels }
  for (const p of profiles) {
    if (requested.includes(p) && levelName) levels[p] = maxLevel(levels[p] || 'rules', levelName)
    else if (!levels[p]) levels[p] = 'rules'
  }
  // --root (alias --module) anchors the profiles named in THIS invocation.
  // Like the rest of `add` it extends: a profile keeps the roots it already
  // had, and re-running with a second path adds it rather than moving it.
  const modules = { ...(lock && lock.modules ? lock.modules : {}) }
  if (rootDirRaw) {
    const dir = modulePath(rootDirRaw)
    const forbidden = dir === '.' ? [] : requested.filter(p => ROOT_FORBID.has(p))
    if (forbidden.length) console.log(`  ! ${forbidden.join(', ')} stay repo-wide — their rules anchor to one shared docs tree, not a module. --root ${dir} was not applied to them.\n`)
    const scopable = requested.filter(p => dir === '.' || !ROOT_FORBID.has(p))
    if (dir === '.' && scopable.some(p => prefixesFor(p, modules).length))
      throw new Error('Conflicting root membership: remove existing module bindings before assigning to .')
    modules[dir] = [...new Set([...(modules[dir] || []), ...scopable])]
    if (!modules[dir].length) delete modules[dir]
  }
  const unscoped = requested.filter(p => ROOT_HINT.has(p) && !Object.entries(modules).some(([d, ps]) => d !== '.' && ps.includes(p)))
  if (unscoped.length) console.log(`  ! ${unscoped.join(', ')} glob language files repo-wide. Pass --root <dir> to scope them.\n`)
  if (lock) console.log(`Already locked: [${lock.profiles.join(', ')}] for [${locked.join(', ')}] — add extends that, and re-emits all of it.\n`)
  await install(profiles, fetched, agents, modules, levels)
}

// `update`: re-install the lock as it stands, under the run's merged registry.
async function reinstall(lock, fetched) {
  const { kept, dropped } = agentsFromLock(lock)
  if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}\n`)
  const migrated = migrateLegacyLock(lock)
  await install(migrated.profiles, fetched, [...new Set([...kept, ...parseAgents(kept.join(',') || 'claude')])], lock.modules, migrated.levels)
}
// -------------------------------------------------------------- interactive add
// A bare `add` in a real terminal, with no flag at all — the "I don't know the
// flags yet" path. Any flag alongside a missing profile list is a mistake, not
// an invitation to prompt, so that case still falls through to the usage error.
// Built on node:readline/promises — no new dependency, matching "the CLI stays
// dumb": one line of validated input at a time, not an arrow-key menu.
async function promptAdd() {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const names = Object.keys(registry.profiles)
    console.log('Available profiles:')
    for (const [i, n] of names.entries()) {
      const entries = registry.profiles[n]
      const hint = entries.find(e => e._note)?._note || entries.map(e => e.from).join(', ')
      console.log(`  ${String(i + 1).padStart(2)}. ${n.padEnd(14)} ${hint}`.slice(0, 140))
    }
    if (registry.aliases && Object.keys(registry.aliases).length) {
      console.log('\nAliases (unpack into several profiles):')
      for (const [n, ps] of Object.entries(registry.aliases)) console.log(`      ${n.padEnd(14)} → ${ps.join(' ')}`)
    }

    let requested = []
    while (!requested.length) {
      const raw = (await rl.question('\nProfiles to add — comma-separated numbers or names: ')).trim()
      if (!raw) continue
      const tokens = raw.split(',').map(s => s.trim()).filter(Boolean)
      const resolved = tokens.map(t => (/^\d+$/.test(t) ? names[Number(t) - 1] : t))
      const valid = resolved.map(n => n && (registry.profiles[n] || (registry.aliases || {})[n]) ? n : null)
      const bad = tokens.filter((_, i) => !valid[i])
      if (bad.length) { console.log(`  Unknown: ${bad.join(', ')} — try again.`); continue }
      requested = valid
    }

    const currentAgents = agentsFromLock(readLock()).kept
    const suggested = currentAgents.length ? currentAgents : DEFAULT_AGENTS
    const agentAns = (await rl.question(`Agents — claude, codex, cursor (comma-separated) [${suggested.join(',')}]: `)).trim().toLowerCase()
    const agentsRaw = !agentAns ? suggested.join(',') : agentAns

    const rootDirRaw = (await rl.question('Root directory to scope these profiles to (blank = repo-wide): ')).trim() || null

    const levelAns = (await rl.question(`Level — ${LEVELS.join('/')} [rules]: `)).trim().toLowerCase()
    const levelName = LEVELS.includes(levelAns) ? levelAns : null
    if (levelAns && !levelName) console.log(`  Unknown level "${levelAns}" — defaulting to rules.`)

    return { requestedRaw: requested, agentsRaw, rootDirRaw, levelName }
  } finally {
    rl.close()
  }
}

// ----------------------------------------------------------------------- main
async function main() {
  switch (cmd) {
    case 'add': {
      const bare = !agentFlag && !scopeFlag && !levelFlag && !refFlags.length && !sourceFlag
      if (!positional.length && bare && process.stdin.isTTY) {
        await withSources(async fetched => runAdd(fetched, await promptAdd()))
        break
      }
      // `add --source` alone re-installs what is locked, with the new layer on top.
      if (!positional.length && !(sourceFlag && existsSync(LOCK))) { console.error('Usage: add <profile...> [--agent claude,codex,cursor] [--root <dir>] [--level rules|gates|ratchet] [--ref <ref>|<source>=<ref>] [--source <name>=<url>#<ref>]'); process.exit(1) }
      const options = { requestedRaw: positional, agentsRaw: null, levelName: parseLevel(), rootDirRaw: scopeFlag }
      await withSources(fetched => runAdd(fetched, options), sourceFlag ? { add: parseSourceFlag(sourceFlag) } : undefined)
      break
    }
    case 'update': {
      if (!existsSync(LOCK)) { console.error(`No ${LOCK} found — run "add <profile...>" first.`); process.exit(1) }
      await withSources(fetched => reinstall(readLock(), fetched))
      break
    }
    case 'remove': {
      if (sourceFlag) {
        if (!existsSync(LOCK)) { console.error(`No ${LOCK} — nothing to remove.`); process.exit(1) }
        await withSources(fetched => reinstall(dropUndefined(readLock({ known: false }), registry), fetched), { drop: sourceFlag })
        break
      }
      if (!positional.length) { console.error('Usage: remove <profile...>   (or "remove all" to fully uninstall)'); process.exit(1) }
      remove(positional)
      break
    }
    case 'init': initRepo(); break
    case 'doctor': doctor(); break
    case 'budget': {
      const list = agentFlag ? parseAgents() : []
      if (list.length > 1) { console.error(`budget measures one target at a time — pass a single --agent (${KNOWN_AGENTS.join('|')}).`); process.exit(1) }
      budget(positional[0], list[0] || null)
      break
    }
    case 'list': {
      const lock = readLock({ known: false })
      console.log('Available profiles:')
      for (const [name, entries] of Object.entries(registry.profiles)) console.log(`  ${name}  (${entries.map(e => e.from).join(', ')})`)
      if (registry.aliases) {
        console.log('\nAliases (unpack on add/remove):')
        for (const [name, ps] of Object.entries(registry.aliases)) console.log(`  ${name}  → ${ps.join(' ')}`)
      }
      console.log(`\nAgents: ${KNOWN_AGENTS.join(', ')} (new installs: claude,codex; select with --agent)`)
      console.log(`Levels: ${LEVELS.join(' | ')} (default on add: rules; never ratchet)`)
      console.log(lock ? `\nInstalled: [${lock.profiles.join(', ')}] for [${(lock.agents || ['claude']).join(', ')}] @ ${sourcesLabel(lock.sources)}${lock.levels ? `\nLevels:    ${Object.entries(lock.levels).map(([p, l]) => `${p}@${l}`).join(', ')}` : ''}` : '\nInstalled: none')
      break
    }
    default:
      console.log('claude-rules — usage:\n'
        + '  add <profile...> [--agent claude,codex,cursor] [--root <dir>] [--level rules|gates|ratchet] [--ref <ref>|<source>=<ref>]\n'
        + '                                   install/pin profiles (default: claude,codex, --level rules)\n'
        + '                                   --root (alias --module) anchors those profiles\' globs to a directory\n'
        + '                                   aliases unpack (rust-api, go-api, python-api, ts-web-app, ts-tauri-app, ts-node-api)\n'
        + '                                   bare `add` in a terminal (no args, no flags) prompts instead of erroring\n'
        + '  add --source <name>=<url>#<ref>  append a source (an overlay) to the lock and re-install with it\n'
        + '  remove <profile...>              uninstall profiles (delete emitted files, update lock); "remove all" fully uninstalls\n'
        + '  remove --source <name>           drop a source from the lock and re-install without it\n'
        + '  update [--ref <ref>|<source>=<ref>] [--force] [--strict]  re-install locked profiles+agents; --ref pins core, <source>=<ref> another source\n'
        + '                                   a path the installer did not write as it is stops add/update; --force overwrites the listed paths\n'
        + '                                   --strict fails when a file a later layer overrides changed upstream\n'
        + '  init                             assemble justfile + lefthook.yml (if absent) + lefthook install\n'
        + '  doctor [--strict]                audit the install against this repo (offline); --strict fails on warnings\n'
        + '  budget [<path>] [--agent <a>]    what loads when that file is opened, and what it costs (no path: the session floor)\n'
        + '                                   --agent picks the measured target (default: claude, then codex, then cursor)\n'
        + '  list                             show available & installed profiles')
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
