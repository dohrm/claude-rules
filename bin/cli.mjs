#!/usr/bin/env node
// claude-rules — install shared agent assets (rules / agents / skills / kit) into a repo.
// shadcn-style: copy + own + pin. The CLI is deliberately dumb; the source of
// truth is registry.json. It NEVER merges build config (lefthook/eslint) — kit
// entries are scaffolded and their wiring is printed for you to do once.
//
// Two targets: Claude is the canonical source format; the installer emits/
// transforms each asset for Cursor too. Skills (SKILL.md) and kit are
// portable as-is; rules and agents are transformed per target.
//
// Usage:
//   npx github:dohrm/claude-rules add rust [ts go] [--agent claude,cursor] [--root apps/api] [--level gates] [--ref v1.2.0]
//   npx github:dohrm/claude-rules remove rust [ts go]       # uninstall profiles ("remove all" = full uninstall)
//   npx github:dohrm/claude-rules update [--ref v1.3.0]     # re-install locked profiles+agents at ref
//   npx github:dohrm/claude-rules init                      # assemble justfile + lefthook.yml + CLAUDE.md (if absent)
//   npx github:dohrm/claude-rules doctor [--strict]         # audit the install against the repo (offline)
//   npx github:dohrm/claude-rules budget [<path>]           # what loads for that file, and what it costs
//   npx github:dohrm/claude-rules list
//   (dev/test) add … --local <path-to-this-repo>            # read assets from disk instead of GitHub
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
// giget is imported lazily (only add/update without --local need it) so init/list run with no deps.

const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
const LOCK = '.claude-rules.lock'
const KNOWN_AGENTS = ['claude', 'cursor']
const RETIRED_AGENTS = ['antigravity', 'codex', 'opencode']
const RETIRED_DIRS = ['.dev/rules', '.opencode', '.agents/rules']

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const refFlag = flag('--ref')
const agentFlag = flag('--agent')
const localFlag = flag('--local')
const moduleFlag = flag('--module')
const rootFlag = flag('--root')
const levelFlag = flag('--level')
const strictFlag = argv.includes('--strict')
if (rootFlag && moduleFlag) {
  console.error('--root and --module are the same flag; pass one.')
  process.exit(1)
}
const scopeFlag = rootFlag || moduleFlag
const reserved = new Set(['--ref', refFlag, '--agent', agentFlag, '--local', localFlag, '--module', moduleFlag, '--root', rootFlag, '--level', levelFlag, '--strict'].filter(Boolean))
const positional = argv.slice(1).filter(a => !reserved.has(a))

const LEVELS = ['rules', 'gates', 'ratchet']
const levelRank = l => { const i = LEVELS.indexOf(l); return i < 0 ? 0 : i }
const maxLevel = (a, b) => LEVELS[Math.max(levelRank(a), levelRank(b))]
const entryLevel = e => e.level || (e.kind === 'kit' ? 'gates' : 'rules')
const entriesAt = (profile, level) => (registry.profiles[profile] || []).filter(e => levelRank(entryLevel(e)) <= levelRank(level))
// Language-globbing profiles: without --root they load on every matching file in
// the repo. That is how ops/slo lands on a domain entity. Hint, never block.
const ROOT_HINT = new Set(['rust', 'ts', 'ts-web', 'ts-node', 'ts-tauri', 'go', 'python', 'godot', 'hexagonal', 'cqrs', 'api', 'backend', 'ops', 'testing', 'react', 'portal-flat', 'portal-http', 'tauri'])

function unpackNames(names) {
  const aliases = registry.aliases || {}
  const out = []
  const seen = new Set()
  const walk = n => {
    if (aliases[n]) {
      if (!seen.has(n)) {
        seen.add(n)
        console.log(`  unpack ${n} → ${aliases[n].join(' ')}`)
        aliases[n].forEach(walk)
      }
      return
    }
    if (!seen.has(n)) { seen.add(n); out.push(n) }
  }
  names.forEach(walk)
  return out
}

function parseLevel() {
  if (!levelFlag) return null
  if (!LEVELS.includes(levelFlag)) {
    console.error(`Unknown --level ${levelFlag}. Known: ${LEVELS.join(', ')}`)
    process.exit(1)
  }
  return levelFlag
}

// Default is both targets — narrowing is a deliberate --agent choice.
// `update` falls back to the locked set (or, for legacy locks with none, both).
function parseAgents(fallback) {
  const raw = agentFlag || fallback || KNOWN_AGENTS.join(',')
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  const retired = list.filter(a => RETIRED_AGENTS.includes(a))
  const bad = list.filter(a => !KNOWN_AGENTS.includes(a) && !RETIRED_AGENTS.includes(a))
  if (retired.length) {
    console.error(`Retired agent(s): ${retired.join(', ')}. Targets are ${KNOWN_AGENTS.join(', ')} (Codex, OpenCode and Antigravity were dropped).`)
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
const SKILL_DIR = { claude: '.claude/skills', cursor: '.agents/skills' }
const KIT_DIR = '.dev/kit'
const LEGACY_KIT_DIR = '.claude/kit'      // where `--agent claude` used to put it

// ------------------------------------------------------------------ fs utils
const ensureDir = d => mkdirSync(d, { recursive: true })
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs).map(f => ({ abs: f.abs, rel: join(name, f.rel) })))
    else out.push({ abs, rel: name })
  }
  return out
}
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
  Object.entries(modules || {}).filter(([, ps]) => ps.includes(profile)).map(([dir]) => dir.replace(/\/+$/, ''))
const scopeGlobs = (globs, prefixes) =>
  prefixes.length ? prefixes.flatMap(p => globs.map(g => `${p}/${g}`)) : globs

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

// Rules are library-owned and never hand-edited (that is the whole point of the
// per-agent emitters), so a rule directory is cleared before it is rewritten:
// otherwise a rule dropped upstream — or skipped by the language filter — survives
// on disk as an orphan that `update` can never reach. Kit is deliberately NOT
// cleared: it is the "copy and own" surface, and the repo may have added to it.
function resetDir(dir) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) }

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
// Returns { dir, isFile, name, temp } — a readable source for the entry.
async function makeStaged(ref, entry) {
  const isFile = /\.[a-z0-9]+$/i.test(entry.from)
  const name = basename(entry.from)
  if (localFlag) {
    const abs = join(localFlag, entry.from)
    return { dir: isFile ? dirname(abs) : abs, isFile, name, temp: false }
  }
  const { downloadTemplate } = await import('giget')   // cached after first call
  const dir = mkdtempSync(join(tmpdir(), 'claude-rules-'))
  await downloadTemplate(`github:${registry.repo}/${entry.from}#${ref}`, { dir, force: true })
  return { dir, isFile, name, temp: true }
}
const stagedFiles = s => s.isFile ? [{ abs: join(s.dir, s.name), rel: s.name }] : walk(s.dir)
const mdFiles = s => stagedFiles(s).filter(f => f.rel.endsWith('.md'))

// -------------------------------------------------------------------- emitters
// Signature: (staged, entry, agent, ctx) => note | null
function emitSkill(s, entry, agent) {
  const dest = join(SKILL_DIR[agent], basename(entry.from))
  for (const f of stagedFiles(s)) { const t = join(dest, f.rel); ensureDir(dirname(t)); copyFileSync(f.abs, t) }
  logCopy(entry.from, dest); return null
}
function emitKit(s, entry, agent, ctx) {
  // One destination for every agent, so the second agent would re-copy the same
  // bytes and print the same line twice.
  if (ctx.kit.has(entry.from)) return null
  ctx.kit.add(entry.from)
  const dest = join(KIT_DIR, basename(entry.from))
  for (const f of stagedFiles(s)) { const t = join(dest, f.rel); ensureDir(dirname(t)); copyFileSync(f.abs, t) }
  logCopy(entry.from, dest); return entry.wire ? `  • ${dest}: ${entry.wire}` : null
}
// Rules & agents for Claude. Verbatim, unless the profile is anchored to modules —
// then only the `paths:` list is rewritten. Agents carry no `paths:` and are untouched.
function emitClaudeRaw(s, entry, agent, ctx) {
  const { prefixes, langProfiles } = ctx.scope
  if (entry.kind === 'rule' && !s.isFile) resetDir(entry.to)
  let n = 0
  for (const f of stagedFiles(s)) {
    const text = f.rel.endsWith('.md') ? readFileSync(f.abs, 'utf8') : null
    if (entry.kind === 'rule' && text && isLanguageDead(splitFm(text).fm.paths, langProfiles)) continue
    const t = s.isFile ? entry.to : join(entry.to, f.rel); ensureDir(dirname(t))
    const scoped = entry.kind === 'rule' && text ? toScopedRuleText(text, prefixes) : null
    if (scoped) writeFileSync(t, scoped); else copyFileSync(f.abs, t)
    n++
  }
  logCopy(entry.from, `${entry.to}${n ? '' : '  (nothing to emit)'}`); return null
}
// Cursor rule: one file per rule, `description` + `globs` + `alwaysApply`.
function emitCursorRule(s, entry, agent, ctx) {
  const { prefixes, langProfiles } = ctx.scope
  const root = '.cursor/rules'
  if (!s.isFile) resetDir(join(root, basename(entry.from)))
  for (const f of mdFiles(s)) {
    const text = readFileSync(f.abs, 'utf8')
    if (isLanguageDead(splitFm(text).fm.paths, langProfiles)) continue
    const rel = (s.isFile ? f.rel : join(basename(entry.from), f.rel)).replace(/\.md$/, '.mdc')
    const t = join(root, rel); ensureDir(dirname(t)); writeFileSync(t, toMdcText(text, prefixes))
  }
  logCopy(entry.from, join(root, s.isFile ? '' : basename(entry.from)) + '/*.mdc'); return null
}
const emitSkip = (s, entry, agent) =>
  `  • ${agent}: no file-based subagents — skipped "${entry.from}" (use ${agent}'s runtime agent feature instead).`

const EMITTERS = {
  claude: { skill: emitSkill, kit: emitKit, rule: emitClaudeRaw,  agent: emitClaudeRaw },
  cursor: { skill: emitSkill, kit: emitKit, rule: emitCursorRule, agent: emitSkip },
}

// Leftover from Codex / OpenCode: a managed AGENTS.md block this installer used
// to write. `update` strips it and leaves whatever the repo wrote around it.
const AGENTS_START = '<!-- claude-rules:start (managed — do not edit inside this block) -->'
const AGENTS_END = '<!-- claude-rules:end -->'

// --------------------------------------------------------------------- remove
// Inverse of add: delete the destinations each emitter produced, per locked
// agent, and update the lock. Symmetric with the EMITTERS/destination logic.
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isFileFrom = from => /\.[a-z0-9]+$/i.test(from)

// Filesystem targets that add() created for (entry, agent) — mirror of the emitters.
function destsFor(entry, agent) {
  const name = basename(entry.from)
  switch (entry.kind) {
    case 'skill': return SKILL_DIR[agent] ? [join(SKILL_DIR[agent], name)] : []
    case 'kit':   return [join(KIT_DIR, name)]
    case 'rule':
      if (agent === 'claude') return [entry.to]
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

function stripAgentsBlock() {
  const file = 'AGENTS.md'
  if (!existsSync(file)) return
  const content = readFileSync(file, 'utf8')
  const re = new RegExp(`\\n*${reEsc(AGENTS_START)}[\\s\\S]*?${reEsc(AGENTS_END)}\\n*`)
  if (!re.test(content)) return
  writeFileSync(file, content.replace(re, '\n').trimStart())
  console.log('  ✓ AGENTS.md  (retired managed block removed)')
}

// Codex / OpenCode / Antigravity left trees and an AGENTS.md block behind.
// add/update purge them the way they purge the legacy kit: by name, so a file
// the repo put next to them survives. Cursor skills stay in `.agents/skills/`.
function purgeRetired() {
  for (const dir of RETIRED_DIRS) {
    if (!existsSync(dir)) continue
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ✗ ${dir}  (retired agent target — run git status before committing)`)
  }
  stripAgentsBlock()
}

function remove(profilesArg) {
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — nothing to remove.`); process.exit(1) }
  const { kept, dropped } = agentsFromLock(lock)
  if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}`)
  const agents = kept.length ? kept : ['claude']
  const full = profilesArg.length === 1 && profilesArg[0] === 'all'
  const targets = full ? lock.profiles.slice() : profilesArg
  const notInLock = targets.filter(p => !lock.profiles.includes(p))
  if (notInLock.length) console.log(`Not installed, skipping: ${notInLock.join(', ')}`)
  const toRemove = targets.filter(p => lock.profiles.includes(p))
  if (!toRemove.length) { console.error('Nothing to remove — none of those profiles are installed.'); process.exit(1) }
  const remaining = lock.profiles.filter(p => !toRemove.includes(p))
  const fullUninstall = full || remaining.length === 0
  const levels = { ...(lock.levels || {}) }
  for (const p of toRemove) delete levels[p]

  console.log(`Removing [${toRemove.join(', ')}]${fullUninstall ? ' + shared (full uninstall)' : ''} for [${agents.join(', ')}]\n`)
  const entries = [...toRemove.flatMap(p => registry.profiles[p] || []), ...(fullUninstall ? registry.shared : [])]
  let removedKit = false
  for (const entry of entries) {
    if (entry.kind === 'kit') removedKit = true
    for (const agent of agents) {
      for (const dest of destsFor(entry, agent)) {
        if (existsSync(dest)) { rmSync(dest, { recursive: true, force: true }); console.log(`  ✗ ${dest}`) }
      }
    }
  }
  if (fullUninstall) {
    purgeRetired()
    purgeLegacyKit()
    if (existsSync(LOCK)) { rmSync(LOCK); console.log(`  ✗ ${LOCK}`) }
    console.log('\nFully uninstalled.')
  } else {
    // A removed profile leaves its module bindings behind too, or the next
    // `update` would anchor globs to a profile that is no longer installed.
    const modules = Object.fromEntries(Object.entries(lock.modules || {})
      .map(([dir, ps]) => [dir, ps.filter(p => remaining.includes(p))])
      .filter(([, ps]) => ps.length))
    writeLock(lock.ref, remaining, agents, modules, levels)
    console.log(`\nUpdated ${LOCK} → [${remaining.join(', ')}] @ ${lock.ref}.`)
  }
  if (removedKit) console.log('\n• Kit removed: also delete the matching `just <tech>-lint/-check` recipes and lefthook triggers you wired — the installer never owned those.')
  console.log('• Review the deletions with `git status` / `git diff` before committing.')
}

// -------------------------------------------------------------------- install
function readLock() { return existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null }
function writeLock(ref, profiles, agents, modules, levels) {
  const lock = { repo: registry.repo, ref, profiles, agents }
  // Absent rather than empty: a lock with no modules must stay byte-identical to
  // what earlier versions wrote, so an unscoped install never grows a field.
  if (modules && Object.keys(modules).length) lock.modules = modules
  if (levels && Object.keys(levels).length) lock.levels = levels
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
  cursor: 'Cursor: .cursor/rules/*.mdc activate via globs/alwaysApply; skills in .agents/skills/. No file-based subagents.',
}

async function install(profiles, ref, agents, modules, levels) {
  const unknown = profiles.filter(p => !registry.profiles[p])
  if (unknown.length) {
    const aliasNames = Object.keys(registry.aliases || {})
    console.error(`Unknown profile(s): ${unknown.join(', ')}. Available: ${Object.keys(registry.profiles).join(', ')}${aliasNames.length ? ` (aliases: ${aliasNames.join(', ')})` : ''}`)
    process.exit(1)
  }
  // Carry the profile each entry came from: it is what maps an entry to the
  // module(s) that asked for it, and therefore to its glob prefixes.
  const owned = [
    ...registry.shared.map(e => ({ e, profile: null })),
    ...profiles.flatMap(p => entriesAt(p, levels[p] || 'rules').map(e => ({ e, profile: p }))),
  ]
  const scopes = Object.entries(modules || {}).map(([d, ps]) => `${d} → ${ps.join(', ')}`)
  const lv = profiles.map(p => `${p}@${levels[p] || 'rules'}`).join(', ')
  console.log(`Installing [${lv}] for [${agents.join(', ')}] from ${localFlag || registry.repo}#${ref}`)
  if (scopes.length) console.log(`Roots: ${scopes.join(' · ')}`)
  console.log()
  const langProfiles = profiles.filter(p => LANG_EXT[p])
  const ctx = { kit: new Set(), scope: { prefixes: [], langProfiles } }
  const notes = []
  for (const { e: entry, profile } of owned) {
    const s = await makeStaged(ref, entry)
    ctx.scope = { prefixes: profile ? prefixesFor(profile, modules) : [], langProfiles }
    for (const agent of agents) {
      const emit = EMITTERS[agent][entry.kind]
      if (!emit) { console.error(`  ! no emitter for kind "${entry.kind}" (${entry.from})`); continue }
      const note = emit(s, entry, agent, ctx)
      if (note) notes.push(note)
    }
    if (s.temp) rmSync(s.dir, { recursive: true, force: true })
  }
  purgeRetired()
  purgeLegacyKit()
  writeLock(ref, profiles, agents, modules, levels)
  console.log(`\nPinned in ${LOCK} (ref ${ref}, agents: ${agents.join(', ')}).`)
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
    '# Tier 3 is deliberately absent: it costs minutes, so it runs per coherent block'
      + (mutators.length ? ' (`mutate-diff` below),' : ','),
    '# not per iteration. Opt-in gates to add here as you enable',
    '# them: adr-check docs-check rules-check dup-check'
      + (existsSync(join(KIT_DIR, 'godot')) ? ' — and godot-check, once godot_dir/godot_bin/godot_export_preset are set' : ''),
    deps ? `check: ${deps}` : '# check: adr-check docs-check    # no language locked — list the gates this repo has',
  ]
  // Only when there is a mutation recipe to name. A hint pointing at a recipe no import
  // provides (`rust-mutate` in a repo with no Rust) is worse than no hint at all.
  if (liveMutators.length) out.push('',
    '# Tier 3 — do the tests ASSERT, or do they merely execute? Coverage cannot answer',
    '# that; mutation can. Minutes, not seconds: NEVER a git hook, never part of `check`.',
    '# This line is live because a locked tech is at --level ratchet.',
    `mutate-diff: ${liveMutators.join(' ')}`)
  else if (mutators.length) out.push('',
    '# Tier 3 — do the tests ASSERT, or do they merely execute? Coverage cannot answer',
    '# that; mutation can. Minutes, not seconds: NEVER a git hook, never part of `check`.',
    '# Run it when a coherent block is finished, BEFORE pushing. Uncomment once the tool',
    '# is installed — an absent recipe is a valid answer, and the agent reports mutation',
    '# as not-run rather than pretending. Gitignore pr.diff and coverage.out.',
    `# mutate-diff: ${mutators.join(' ')}`)
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
  const lock = readLock()
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

  console.log(`\nStill manual (repo-specific): move rustfmt.toml+deny.toml→<rust_dir>, mutants.toml→<rust_dir>/.cargo/, golangci.base.yml→.golangci.yml, merge pyproject.snippet.toml→<python_dir>/pyproject.toml, mutation-ci.yaml→.gitea/workflows/; adapt eslint globalIgnores; enable \`adr-check\`/\`docs-check\`/\`rules-check\`/\`dup-check\` in the justfile \`check\` recipe (the locked techs are already wired) and uncomment \`mutate-diff\` once the mutation tools are installed. The gate SCRIPTS need no move any more — the recipes call them in ${KIT_DIR}/common/ directly, so an update refreshes gate and implementation together; \`just code-review\` still needs \`review_cmd\` set to this repo's agent CLI, \`.work/\` gitignored, and its pre-push trigger merged from common/lefthook.snippet.yml. Harness layer (optional, one snippet per tool): merge common/hooks/settings.snippet.json into .claude/settings.json — or the cursor snippet next to it — see common/hooks/README.md for what it does and does not guarantee.`)
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

// Emitted rules, read back from whichever tree exists — Claude first (complete,
// including always-on), then Cursor.
function installedRules() {
  for (const [root, key, complete] of [
    ['.claude/rules', 'paths', true],
    ['.cursor/rules', 'globs', true],
  ]) {
    if (!existsSync(root)) continue
    const files = walk(root).filter(f => /\.mdc?$/.test(f.rel))
    return {
      root,
      complete,
      rules: files.map(f => {
        const { fm } = splitFm(readFileSync(f.abs, 'utf8'))
        return { rel: f.rel, path: join(root, f.rel), size: statSync(f.abs).size, title: fm.title || fm.description || f.rel, globs: Array.isArray(fm[key]) ? fm[key] : [] }
      }),
    }
  }
  return { root: null, complete: false, rules: [] }
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
function budget(target) {
  const { root, complete, rules } = installedRules()
  if (!root) { console.error('No emitted rule tree found — run "add <profile...>" first.'); process.exit(1) }
  const path = target ? target.replace(/^\.\//, '').replace(`${process.cwd()}/`, '') : null
  if (path && !existsSync(path)) console.log(`(${path} does not exist here — showing what WOULD load for that path)\n`)

  const always = rules.filter(r => !r.globs.length).sort((a, b) => b.size - a.size)
  const hit = path
    ? rules.filter(r => r.globs.some(g => globToRe(g).test(path))).sort((a, b) => b.size - a.size)
    : []
  const skills = skillDescriptions()
  const rows = []
  const push = (label, size, detail = '') => rows.push([label, size, detail])

  console.log(path ? `Context for ${path}\n` : 'Session floor — what loads before any file is read\n')
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
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — nothing to audit. Run "add <profile...>" first.`); process.exit(1) }
  const { kept, dropped } = agentsFromLock(lock)
  const agents = kept.length ? kept : ['claude']
  const bad = [], warn = []
  console.log(`claude-rules doctor — ${process.cwd()}\n`)

  // ---- 1. the lock itself
  console.log('Install')
  const unknownP = lock.profiles.filter(p => !registry.profiles[p])
  for (const p of unknownP) bad.push(`lock references unknown profile "${p}" — \`update\` cannot emit it`)
  for (const a of dropped) bad.push(`lock still lists retired agent "${a}" — run \`update\` to drop it`)
  console.log(`  ✓ lock: [${lock.profiles.join(', ')}] for [${(lock.agents || ['claude']).join(', ')}] @ ${lock.ref}`)
  // A module path that does not exist anchors every one of its globs to nothing —
  // the rules are emitted, look installed, and can never match a file.
  for (const [dir, ps] of Object.entries(lock.modules || {})) {
    if (!existsSync(dir)) bad.push(`module "${dir}" does not exist — [${ps.join(', ')}] are anchored to a path that is not there`)
    else console.log(`  ✓ module ${dir}: ${ps.join(', ')}`)
    for (const p of ps.filter(p => !lock.profiles.includes(p))) bad.push(`module "${dir}" claims "${p}", which is not in the lock's profiles`)
  }

  // ---- 2. what the lock promises vs what is on disk
  const expected = new Map()
  const lockedEntries = [['(shared)', registry.shared], ...lock.profiles.map(p => [p, entriesAt(p, (lock.levels || {})[p] || 'gates')])]
  for (const [profile, entries] of lockedEntries)
    for (const e of entries) for (const a of agents)
      for (const d of destsFor(e, a)) expected.set(d, { profile, agent: a })

  for (const [dest, meta] of expected)
    if (!existsSync(dest)) bad.push(`${dest} — promised by "${meta.profile}" for ${meta.agent}, missing on disk (run \`update\`)`)

  for (const dir of RETIRED_DIRS)
    if (existsSync(dir)) bad.push(`${dir} — leftover from a retired agent target (Codex / OpenCode / Antigravity). Run \`update\` to purge it.`)
  if (existsSync('AGENTS.md') && new RegExp(reEsc(AGENTS_START)).test(readFileSync('AGENTS.md', 'utf8')))
    bad.push('AGENTS.md still has a claude-rules managed block (Codex / OpenCode leftover). Run `update` to strip it.')

  const known = new Set()
  for (const entries of [registry.shared, ...Object.values(registry.profiles)])
    for (const e of entries) for (const a of KNOWN_AGENTS) for (const d of destsFor(e, a)) known.add(d)
  for (const d of known)
    if (existsSync(d) && !expected.has(d)) bad.push(`${d} — on disk but nothing in the lock explains it; agents load it silently. Delete it, or \`add\` the profile (or \`--agent\`) that owns it.`)

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
    if (!complete) console.log('  • claude is locked but .claude/rules/ is absent — cannot measure')
    else {
      const on = rules.filter(r => !r.globs.length).sort((a, b) => b.size - a.size)
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

// ----------------------------------------------------------------------- main
async function main() {
  switch (cmd) {
    case 'add': {
      if (!positional.length) { console.error('Usage: add <profile...> [--agent claude,cursor] [--root <dir>] [--level rules|gates|ratchet] [--ref <ref>]'); process.exit(1) }
      // `add` EXTENDS the install; it never redefines it. Writing only the new
      // profiles would leave the previous ones on disk but out of the lock —
      // invisible to `update`, and orphaned by `remove all`, which then deletes
      // the lock and leaves no way to find them.
      const requested = unpackNames(positional)
      const wantLevel = parseLevel()
      const lock = readLock()
      const migrated = migrateLegacyLock(lock)
      const profiles = [...new Set([...migrated.profiles, ...requested])]
      // Same rule for agents: no --agent on an existing install keeps its set
      // (never silently widen to both); an explicit --agent adds a target.
      // Retired names in an old lock are dropped, not re-emitted.
      const { kept: locked, dropped } = agentsFromLock(lock)
      if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}\n`)
      const agents = [...new Set([...locked, ...parseAgents(locked.join(','))])]
      const levels = { ...migrated.levels }
      for (const p of profiles) {
        if (requested.includes(p) && wantLevel) levels[p] = maxLevel(levels[p] || 'rules', wantLevel)
        else if (!levels[p]) levels[p] = 'rules'
      }
      // --root (alias --module) anchors the profiles named in THIS invocation.
      // Like the rest of `add` it extends: a profile keeps the roots it already
      // had, and re-running with a second path adds it rather than moving it.
      const modules = { ...(lock && lock.modules ? lock.modules : {}) }
      if (scopeFlag) {
        const dir = scopeFlag.replace(/\/+$/, '')
        modules[dir] = [...new Set([...(modules[dir] || []), ...requested])]
      }
      const unscoped = requested.filter(p => ROOT_HINT.has(p) && !Object.values(modules).some(ps => ps.includes(p)))
      if (unscoped.length) console.log(`  ! ${unscoped.join(', ')} glob language files repo-wide. Pass --root <dir> to scope them.\n`)
      if (lock) console.log(`Already locked: [${lock.profiles.join(', ')}] for [${locked.join(', ')}] — add extends that, and re-emits all of it.\n`)
      await install(profiles, refFlag || registry.defaultRef, agents, modules, levels)
      break
    }
    case 'update': {
      const lock = readLock()
      if (!lock) { console.error(`No ${LOCK} found — run "add <profile...>" first.`); process.exit(1) }
      const { kept, dropped } = agentsFromLock(lock)
      if (dropped.length) console.log(`Dropped retired agent(s) from the lock: ${dropped.join(', ')}\n`)
      const migrated = migrateLegacyLock(lock)
      await install(migrated.profiles, refFlag || registry.defaultRef, parseAgents(kept.join(',') || 'claude'), lock.modules, migrated.levels)
      break
    }
    case 'remove': {
      if (!positional.length) { console.error('Usage: remove <profile...>   (or "remove all" to fully uninstall)'); process.exit(1) }
      remove(positional[0] === 'all' ? positional : unpackNames(positional))
      break
    }
    case 'init': initRepo(); break
    case 'doctor': doctor(); break
    case 'budget': budget(positional[0]); break
    case 'list': {
      const lock = readLock()
      console.log('Available profiles:')
      for (const [name, entries] of Object.entries(registry.profiles)) console.log(`  ${name}  (${entries.map(e => e.from).join(', ')})`)
      if (registry.aliases) {
        console.log('\nAliases (unpack on add/remove):')
        for (const [name, ps] of Object.entries(registry.aliases)) console.log(`  ${name}  → ${ps.join(' ')}`)
      }
      console.log(`\nAgents: ${KNOWN_AGENTS.join(', ')} (default: both; narrow with --agent)`)
      console.log(`Levels: ${LEVELS.join(' | ')} (default on add: rules; never ratchet)`)
      console.log(lock ? `\nInstalled: [${lock.profiles.join(', ')}] for [${(lock.agents || ['claude']).join(', ')}] @ ${lock.ref}${lock.levels ? `\nLevels:    ${Object.entries(lock.levels).map(([p, l]) => `${p}@${l}`).join(', ')}` : ''}` : '\nInstalled: none')
      break
    }
    default:
      console.log('claude-rules — usage:\n'
        + '  add <profile...> [--agent claude,cursor] [--root <dir>] [--level rules|gates|ratchet] [--ref <ref>]\n'
        + '                                   install/pin profiles (default: both agents, --level rules)\n'
        + '                                   --root (alias --module) anchors those profiles\' globs to a directory\n'
        + '                                   aliases unpack (rust-api, go-api, ts-web-app, ts-tauri-app, ts-node-api)\n'
        + '  remove <profile...>              uninstall profiles (delete emitted files, update lock); "remove all" fully uninstalls\n'
        + '  update [--ref <ref>]             re-install locked profiles+agents at ref\n'
        + '  init                             assemble justfile + lefthook.yml (if absent) + lefthook install\n'
        + '  doctor [--strict]                audit the install against this repo (offline); --strict fails on warnings\n'
        + '  budget [<path>]                  what loads when that file is opened, and what it costs (no path: the session floor)\n'
        + '  list                             show available & installed profiles')
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
