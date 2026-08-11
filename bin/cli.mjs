#!/usr/bin/env node
// claude-rules — install shared agent assets (rules / agents / skills / kit) into a repo.
// shadcn-style: copy + own + pin. The CLI is deliberately dumb; the source of
// truth is registry.json. It NEVER merges build config (lefthook/eslint) — kit
// entries are scaffolded and their wiring is printed for you to do once.
//
// Agent-agnostic: Claude is the canonical source format; the installer emits/
// transforms each asset to the target agent(s). Skills (SKILL.md) and kit are
// portable as-is; rules and agents are transformed per target.
//
// Usage:
//   npx github:dohrm/claude-rules add rust [ts go] [--agent claude,cursor,antigravity,codex,opencode] [--module apps/api] [--ref v1.2.0]
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
const KNOWN_AGENTS = ['claude', 'cursor', 'antigravity', 'codex', 'opencode']

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const refFlag = flag('--ref')
const agentFlag = flag('--agent')
const localFlag = flag('--local')
const moduleFlag = flag('--module')
const strictFlag = argv.includes('--strict')
const reserved = new Set(['--ref', refFlag, '--agent', agentFlag, '--local', localFlag, '--module', moduleFlag, '--strict'].filter(Boolean))
const positional = argv.slice(1).filter(a => !reserved.has(a))

// Default is ALL agents — narrowing to a subset is a deliberate --agent choice.
// `update` falls back to the locked set (or, for legacy locks with none, all).
function parseAgents(fallback) {
  const raw = agentFlag || fallback || KNOWN_AGENTS.join(',')
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  const bad = list.filter(a => !KNOWN_AGENTS.includes(a))
  if (bad.length) { console.error(`Unknown agent(s): ${bad.join(', ')}. Known: ${KNOWN_AGENTS.join(', ')}`); process.exit(1) }
  return [...new Set(list)]
}

// ------------------------------------------------------------- destinations
// `.agents/` is Antigravity's native directory (skills, workflows AND rules), and
// the de-facto neutral home the other AGENTS.md-era tools read too. Skills there are
// a happy collision — a SKILL.md is portable. Rules are NOT: Antigravity reads
// .agents/rules/ with ITS frontmatter, so the codex/opencode copies (which carry
// `paths:`, meaningless to it) live in .dev/rules/ instead — same neighbourhood as
// .dev/kit/, and nothing picks them up by accident.
const SKILL_DIR = { claude: '.claude/skills', cursor: '.agents/skills', antigravity: '.agents/skills', codex: '.agents/skills', opencode: '.opencode/skills' }
const KIT_DIR   = { claude: '.claude/kit',    cursor: '.dev/kit',       antigravity: '.dev/kit',       codex: '.dev/kit',       opencode: '.dev/kit' }
const AGENTS_RULE_DIR = '.dev/rules'

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
//   "modules": { "apps/api": ["rust", "api"], "apps/web": ["ts", "portal-flat"] }
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
const LANG_EXT = { rust: ['rs'], ts: ['ts', 'tsx'], go: ['go'], godot: ['cs', 'tscn', 'tres', 'gd'] }
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
// Claude subagent (name/description/model/color/memory) → opencode agent (description/mode).
function toOpencodeAgentText(text) {
  const { fm, body } = splitFm(text)
  const out = {}
  if (fm.description) out.description = fm.description
  out.mode = 'subagent'
  return `---\n${dumpFm(out)}\n---\n${body}`
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
function emitKit(s, entry, agent) {
  const dest = join(KIT_DIR[agent], basename(entry.from))
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
// Cursor and Antigravity converged on the same rule format — one file per rule,
// `description` + `globs` + `alwaysApply` in the frontmatter. Only the home and the
// extension differ, so one transform serves both.
const globRuleEmitter = (root, ext) => (s, entry, agent, ctx) => {
  const { prefixes, langProfiles } = ctx.scope
  if (!s.isFile) resetDir(join(root, basename(entry.from)))
  for (const f of mdFiles(s)) {
    const text = readFileSync(f.abs, 'utf8')
    if (isLanguageDead(splitFm(text).fm.paths, langProfiles)) continue
    const rel = (s.isFile ? f.rel : join(basename(entry.from), f.rel)).replace(/\.md$/, ext)
    const t = join(root, rel); ensureDir(dirname(t)); writeFileSync(t, toMdcText(text, prefixes))
  }
  logCopy(entry.from, join(root, s.isFile ? '' : basename(entry.from)) + `/*${ext}`); return null
}
const emitCursorRule = globRuleEmitter('.cursor/rules', '.mdc')
const emitAntigravityRule = globRuleEmitter('.agents/rules', '.md')
// Codex & opencode have no per-file path-scoping: cross-cutting rules are inlined
// into AGENTS.md, path-scoped rules are copied to .dev/rules/ and referenced.
// AGENTS.md content is identical for both, so accumulate once (guarded by ctx.seen).
function emitAgentsRule(s, entry, agent, ctx) {
  if (ctx.seen.has(entry.from)) return null
  ctx.seen.add(entry.from)
  const { prefixes, langProfiles } = ctx.scope
  if (!s.isFile) resetDir(join(AGENTS_RULE_DIR, basename(entry.from)))
  for (const f of mdFiles(s)) {
    const text = readFileSync(f.abs, 'utf8'); const { fm, body } = splitFm(text)
    if (Array.isArray(fm.paths) && fm.paths.length) {
      if (isLanguageDead(fm.paths, langProfiles)) continue
      const rel = s.isFile ? f.rel : join(basename(entry.from), f.rel)
      const target = join(AGENTS_RULE_DIR, rel)
      ensureDir(dirname(target))
      writeFileSync(target, toScopedRuleText(text, prefixes) || text)
      // Carry the module so the index can be grouped by it: a Codex session run
      // from apps/api can then skip every row that is not its own.
      ctx.refs.push({ globs: scopeGlobs(fm.paths, prefixes), path: target, title: fm.title || fm.description || rel, module: prefixes.length === 1 ? prefixes[0] : null })
    } else {
      ctx.inline.push(body.trim())
    }
  }
  return null
}
function emitOpencodeAgent(s, entry) {
  for (const f of mdFiles(s)) {
    const t = join('.opencode/agent', basename(f.rel))
    ensureDir(dirname(t)); writeFileSync(t, toOpencodeAgentText(readFileSync(f.abs, 'utf8')))
  }
  logCopy(entry.from, '.opencode/agent/*.md (transformed)'); return null
}
const emitSkip = (s, entry, agent) =>
  `  • ${agent}: no file-based subagents — skipped "${entry.from}" (use ${agent}'s runtime agent feature instead).`

const EMITTERS = {
  claude:      { skill: emitSkill, kit: emitKit, rule: emitClaudeRaw,        agent: emitClaudeRaw },
  cursor:      { skill: emitSkill, kit: emitKit, rule: emitCursorRule,       agent: emitSkip },
  antigravity: { skill: emitSkill, kit: emitKit, rule: emitAntigravityRule,  agent: emitSkip },
  codex:       { skill: emitSkill, kit: emitKit, rule: emitAgentsRule,       agent: emitSkip },
  opencode:    { skill: emitSkill, kit: emitKit, rule: emitAgentsRule,       agent: emitOpencodeAgent },
}

// AGENTS.md: rewrite a delimited, installer-owned block; never touch the user's content.
const AGENTS_START = '<!-- claude-rules:start (managed — do not edit inside this block) -->'
const AGENTS_END = '<!-- claude-rules:end -->'
const AGENTS_INDEX_HEADING = '## Rules that are NOT loaded for you'
function flushAgentsMd(ctx) {
  if (!ctx.inline.length && !ctx.refs.length) return
  const parts = [AGENTS_START, '# Project rules (managed by claude-rules)\n']
  if (ctx.inline.length) parts.push(ctx.inline.join('\n\n'))
  if (ctx.refs.length) {
    // Neither Codex nor opencode loads a rule because a glob matched — the index is
    // an instruction, not a mechanism. So say it once, imperatively, and group the
    // rows by module: a session working in apps/api can skip everything else.
    parts.push(`\n${AGENTS_INDEX_HEADING}\n`)
    parts.push('Before you edit a file, open the rules below whose glob matches it, and')
    parts.push('follow them. Nothing loads them automatically.\n')
    const groups = new Map()
    for (const r of ctx.refs) {
      const key = r.module || '(repo-wide)'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => a === '(repo-wide)' ? 1 : b === '(repo-wide)' ? -1 : a.localeCompare(b))
    for (const [mod, refs] of ordered) {
      if (groups.size > 1) parts.push(`\n### ${mod}`)
      for (const r of refs) parts.push(`- \`${r.globs.join('`, `')}\` → read \`${r.path}\` — ${r.title}`)
    }
  }
  parts.push(AGENTS_END)
  const block = parts.join('\n')
  const file = 'AGENTS.md'
  let content = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${AGENTS_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${AGENTS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  content = re.test(content) ? content.replace(re, block) : (content.trim() ? content.trimEnd() + '\n\n' : '') + block + '\n'
  writeFileSync(file, content)
  console.log(`  ✓ AGENTS.md  (managed block: ${ctx.inline.length} inline, ${ctx.refs.length} path-scoped)`)
}

// --------------------------------------------------------------------- remove
// Inverse of add: delete the destinations each emitter produced, per locked
// agent, and update the lock. Symmetric with the EMITTERS/destination logic.
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isFileFrom = from => /\.[a-z0-9]+$/i.test(from)

// Filesystem targets that add() created for (entry, agent) — mirror of the emitters.
function destsFor(entry, agent) {
  const name = basename(entry.from)
  switch (entry.kind) {
    case 'skill': return [join(SKILL_DIR[agent], name)]
    case 'kit':   return [join(KIT_DIR[agent], name)]
    case 'rule':
      if (agent === 'claude') return [entry.to]                                   // file or dir
      if (agent === 'cursor') return [isFileFrom(entry.from) ? join('.cursor/rules', name.replace(/\.md$/, '.mdc')) : join('.cursor/rules', name)]
      if (agent === 'antigravity') return [join('.agents/rules', name)]           // its own frontmatter, its own home
      return [join(AGENTS_RULE_DIR, name)]                                        // codex/opencode path-scoped copies
    case 'agent':
      if (agent === 'claude')   return [entry.to]                                 // .claude/agents
      if (agent === 'opencode') return ['.opencode/agent']
      return []                                                                   // cursor/antigravity/codex: skipped on add
    default: return []
  }
}

// Drop the index rows of removed profiles from the AGENTS.md managed block.
// `remove` stages no source, so it cannot regenerate the block the way `add` does —
// this is text surgery, and it is kept STRUCTURAL (a row is a bullet naming the rule
// directory) rather than keyed on the row's prose, which has already changed once.
function pruneAgentsRefs(removedRuleDirs) {
  const file = 'AGENTS.md'
  if (!existsSync(file) || !removedRuleDirs.length) return
  const content = readFileSync(file, 'utf8')
  const re = new RegExp(`${reEsc(AGENTS_START)}[\\s\\S]*?${reEsc(AGENTS_END)}`)
  const m = content.match(re); if (!m) return
  const isRow = l => l.startsWith('- ') && l.includes(`${AGENTS_RULE_DIR}/`)
  const lines = m[0].split('\n').filter(l => !(isRow(l) && removedRuleDirs.some(d => l.includes(`${d}/`))))

  // A `### <module>` heading whose rows all went must go with them.
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (/^### /.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !/^#{2,3} /.test(lines[j]) && lines[j] !== AGENTS_END) j++
      if (!lines.slice(i + 1, j).some(isRow)) { i = j - 1; continue }
    }
    kept.push(lines[i])
  }
  // Nothing left to point at: drop the whole index. It is always last in the block.
  const head = kept.indexOf(AGENTS_INDEX_HEADING)
  const out = head >= 0 && !kept.some(isRow) ? [...kept.slice(0, head), AGENTS_END] : kept
  while (out.length > 1 && out[out.length - 2].trim() === '') out.splice(out.length - 2, 1)
  writeFileSync(file, content.replace(re, out.join('\n')))
  console.log('  ✓ AGENTS.md  (pruned index rows)')
}
function stripAgentsBlock() {
  const file = 'AGENTS.md'
  if (!existsSync(file)) return
  const content = readFileSync(file, 'utf8')
  const re = new RegExp(`\\n*${reEsc(AGENTS_START)}[\\s\\S]*?${reEsc(AGENTS_END)}\\n*`)
  if (!re.test(content)) return
  writeFileSync(file, content.replace(re, '\n').trimStart())
  console.log('  ✓ AGENTS.md  (managed block removed)')
}

function remove(profilesArg) {
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — nothing to remove.`); process.exit(1) }
  const agents = lock.agents || ['claude']
  const full = profilesArg.length === 1 && profilesArg[0] === 'all'
  const targets = full ? lock.profiles.slice() : profilesArg
  const notInLock = targets.filter(p => !lock.profiles.includes(p))
  if (notInLock.length) console.log(`Not installed, skipping: ${notInLock.join(', ')}`)
  const toRemove = targets.filter(p => lock.profiles.includes(p))
  if (!toRemove.length) { console.error('Nothing to remove — none of those profiles are installed.'); process.exit(1) }
  const remaining = lock.profiles.filter(p => !toRemove.includes(p))
  const fullUninstall = full || remaining.length === 0

  console.log(`Removing [${toRemove.join(', ')}]${fullUninstall ? ' + shared (full uninstall)' : ''} for [${agents.join(', ')}]\n`)
  const entries = [...toRemove.flatMap(p => registry.profiles[p] || []), ...(fullUninstall ? registry.shared : [])]
  const removedRuleDirs = []
  let removedKit = false
  for (const entry of entries) {
    if (entry.kind === 'kit') removedKit = true
    for (const agent of agents) {
      if (entry.kind === 'rule' && (agent === 'codex' || agent === 'opencode')) removedRuleDirs.push(join(AGENTS_RULE_DIR, basename(entry.from)))
      for (const dest of destsFor(entry, agent)) {
        if (existsSync(dest)) { rmSync(dest, { recursive: true, force: true }); console.log(`  ✗ ${dest}`) }
      }
    }
  }
  if (agents.includes('codex') || agents.includes('opencode')) {
    if (fullUninstall) stripAgentsBlock()
    else pruneAgentsRefs([...new Set(removedRuleDirs)])
  }
  if (fullUninstall) {
    if (existsSync(LOCK)) { rmSync(LOCK); console.log(`  ✗ ${LOCK}`) }
    console.log('\nFully uninstalled.')
  } else {
    // A removed profile leaves its module bindings behind too, or the next
    // `update` would anchor globs to a profile that is no longer installed.
    const modules = Object.fromEntries(Object.entries(lock.modules || {})
      .map(([dir, ps]) => [dir, ps.filter(p => remaining.includes(p))])
      .filter(([, ps]) => ps.length))
    writeLock(lock.ref, remaining, agents, modules)
    console.log(`\nUpdated ${LOCK} → [${remaining.join(', ')}] @ ${lock.ref}.`)
  }
  if (removedKit) console.log('\n• Kit removed: also delete the matching `just <tech>-lint/-check` recipes and lefthook triggers you wired — the installer never owned those.')
  console.log('• Review the deletions with `git status` / `git diff` before committing.')
}

// -------------------------------------------------------------------- install
function readLock() { return existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null }
function writeLock(ref, profiles, agents, modules) {
  const lock = { repo: registry.repo, ref, profiles, agents }
  // Absent rather than empty: a lock with no modules must stay byte-identical to
  // what earlier versions wrote, so an unscoped install never grows a field.
  if (modules && Object.keys(modules).length) lock.modules = modules
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n')
}

const FINAL_MSG = {
  claude: 'Claude: .claude/rules/ auto-load (language rules path-scoped via `paths:`); .claude/agents/ + .claude/skills/ auto-discovered.',
  cursor: 'Cursor: .cursor/rules/*.mdc activate via globs/alwaysApply; skills in .agents/skills/. No file-based subagents.',
  antigravity: 'Antigravity: .agents/rules/*.md activate via globs/alwaysApply (same format as Cursor); skills in .agents/skills/. No file-based subagents.',
  codex: `Codex: rules live in the AGENTS.md managed block (+ ${AGENTS_RULE_DIR}/ for path-scoped); skills in .agents/skills/. It merges AGENTS.md from the repo root down to your CWD (32 KiB cap), so run it from the module you are working in.`,
  opencode: `opencode: rules in AGENTS.md (+ ${AGENTS_RULE_DIR}/); agents in .opencode/agent/; skills in .opencode/skills/. It takes the FIRST AGENTS.md walking up from the CWD — do not add a nested one, it would replace the root rather than extend them.`,
}

async function install(profiles, ref, agents, modules) {
  const unknown = profiles.filter(p => !registry.profiles[p])
  if (unknown.length) {
    console.error(`Unknown profile(s): ${unknown.join(', ')}. Available: ${Object.keys(registry.profiles).join(', ')}`)
    process.exit(1)
  }
  // Carry the profile each entry came from: it is what maps an entry to the
  // module(s) that asked for it, and therefore to its glob prefixes.
  const owned = [
    ...registry.shared.map(e => ({ e, profile: null })),
    ...profiles.flatMap(p => registry.profiles[p].map(e => ({ e, profile: p }))),
  ]
  const scopes = Object.entries(modules || {}).map(([d, ps]) => `${d} → ${ps.join(', ')}`)
  console.log(`Installing [${profiles.join(', ')}] for [${agents.join(', ')}] from ${localFlag || registry.repo}#${ref}`)
  if (scopes.length) console.log(`Modules: ${scopes.join(' · ')}`)
  console.log()
  const langProfiles = profiles.filter(p => LANG_EXT[p])
  const ctx = { inline: [], refs: [], seen: new Set(), scope: { prefixes: [], langProfiles } }
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
  flushAgentsMd(ctx)
  writeLock(ref, profiles, agents, modules)
  console.log(`\nPinned in ${LOCK} (ref ${ref}, agents: ${agents.join(', ')}).`)
  if (notes.length) {
    console.log(`\nOne-time wiring (the installer never touches your build config):`)
    console.log([...new Set(notes)].join('\n'))
  }
  console.log('\nNext:')
  for (const a of agents) console.log(`  • ${FINAL_MSG[a]}`)
}

// ----------------------------------------------------------------------- init
const GLOB = { rust: '**/*.rs', ts: '**/*.{ts,tsx}', go: '**/*.go' }
function genLefthook(techs) {
  const cmds = suffix => techs.map(t => `    ${t}:\n      glob: "${GLOB[t]}"\n      run: just ${t}-${suffix}`).join('\n')
  return `# Generated by \`claude-rules init\` — thin triggers → justfile recipes.\n`
    + `# Commands and their paths live in the justfile (\`just <tech>-lint\`/\`-check\`).\n\n`
    + `pre-commit:\n  parallel: true\n  commands:\n${cmds('lint')}\n\n`
    + `pre-push:\n  parallel: true\n  commands:\n${cmds('check')}\n`
}
// The `*_dir` variables, derived from the lock's `modules`. `just` fails at parse
// time on an undefined variable, so all three are always emitted — an unclaimed
// tech simply points at the repo root, exactly as the snippet ships it.
const JUST_START = '# claude-rules:start (managed — derived from .claude-rules.lock)'
const JUST_END = '# claude-rules:end'
const DIR_VAR = { rust: 'rust_dir', ts: 'ts_dir', go: 'go_dir' }
function genDirsBlock(modules) {
  const notes = []
  const lines = Object.entries(DIR_VAR).map(([profile, name]) => {
    const claims = Object.entries(modules || {}).filter(([, ps]) => ps.includes(profile)).map(([d]) => d)
    // `modules` allows a language in several places; a `*_dir` is one directory.
    // Two claimants means the recipe has to cover both, so it runs from the root.
    if (claims.length > 1) notes.push(`${name}: ${claims.join(', ')} both hold ${profile} — set to "." so the recipe covers both`)
    return `${name.padEnd(8)} := "${claims.length === 1 ? claims[0] : '.'}"`
  })
  return { block: [JUST_START, ...lines, JUST_END].join('\n'), notes }
}
function writeManagedDirs(file, modules) {
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
  const { block, notes } = genDirsBlock(modules)
  writeFileSync(file, content.replace(re, block))
  console.log(`✓ ${file}: *_dir block derived from the lock's modules.`)
  for (const n of notes) console.log(`  • ${n}`)
}

// A CLAUDE.md the installer writes ONCE and never touches again. The conventions
// already live in .claude/rules/ and load on their own — what belongs here is the
// part only this repo knows: what each module is, and where its documents are.
// Claude reads CLAUDE.md and never AGENTS.md, so without this file a Claude-first
// repo starts every session with no map at all.
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
      '     installer too (`add <profile...> --module <dir>`) so its rules stop loading',
      '     everywhere your language happens to appear. -->')
  }
  out.push('', '## The gate', '',
    'Run `just check` and read the exit code before handing back — a green gate is',
    'the authority, never your own say-so (`.claude/rules/agent/autonomy.md`).', '')
  const docs = ['docs/PRD.md', 'docs/ARCHITECTURE.md', 'docs/PLAN.md', 'docs/adr'].filter(existsSync)
  if (docs.length) out.push('## Documents', '', ...docs.map(d => `- \`${d}\``), '')
  return out.join('\n')
}

function initRepo() {
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — run "add <profile...>" first.`); process.exit(1) }
  const techs = lock.profiles.filter(p => GLOB[p])
  const kitBase = KIT_DIR[(lock.agents && lock.agents[0]) || 'claude']
  const snippet = join(kitBase, 'common', 'justfile.snippet')
  const justfile = ['justfile', 'Justfile'].find(existsSync)
  if (justfile) console.log(`• ${justfile} exists — merge ${snippet} into it (the installer only owns the block below).`)
  else if (existsSync(snippet)) { copyFileSync(snippet, 'justfile'); console.log(`✓ created justfile (from ${snippet}).`) }
  else console.log(`• ${snippet} missing — run "add" first.`)
  const target = justfile || (existsSync('justfile') ? 'justfile' : null)
  if (target) writeManagedDirs(target, lock.modules)

  // Written once, then left alone — same contract as the justfile above.
  if (lock.agents && lock.agents.includes('claude')) {
    if (existsSync('CLAUDE.md') || existsSync(join('.claude', 'CLAUDE.md')))
      console.log('• CLAUDE.md exists — left untouched (the installer never rewrites it).')
    else { writeFileSync('CLAUDE.md', genClaudeMd(lock)); console.log('✓ created CLAUDE.md — fill in what only you know; Claude reads it, never AGENTS.md.') }
  }

  if (existsSync('lefthook.yml') || existsSync('lefthook.yaml'))
    console.log(`• lefthook.yml exists — merge ${kitBase}/<tech>/lefthook.snippet.yml (thin triggers) into it.`)
  else if (techs.length) { writeFileSync('lefthook.yml', genLefthook(techs)); console.log(`✓ created lefthook.yml (triggers for: ${techs.join(', ')}).`) }

  if (!existsSync('.git')) console.log('• not a git repo — run `lefthook install` after `git init`.')
  else { const r = spawnSync('lefthook', ['install'], { stdio: 'inherit' }); if (r.error) console.log('• lefthook not found — install it, then run: lefthook install') }

  console.log(`\nStill manual (repo-specific): move deny.toml→<rust_dir>, mutants.toml→<rust_dir>/.cargo/, golangci.base.yml→.golangci.yml, mutation-ci.yaml→.gitea/workflows/, adr-check.mjs→scripts/ (if the repo keeps ADRs), docs-check.mjs→scripts/ (if it keeps a PRD/PLAN); adapt eslint globalIgnores; enable your techs — and \`adr-check\`/\`docs-check\` — in the justfile \`check\` recipe.`)
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
// `.claude/kit/portal-flat/openapi-ts.config.ts` must not make a `**/*.ts`
// rule look alive in a repo that has no TypeScript.
const SCAN_SKIP = new Set(['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', 'coverage', '.next',
  '.claude', '.agents', '.cursor', '.opencode', '.dev'])
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

// Emitted rules, read back from whichever tree exists — in the order that answers
// the most. `.dev/rules/` holds ONLY the path-scoped ones (codex/opencode inline
// the rest into AGENTS.md), so it can answer "does this glob match anything" but
// never "what is always on"; that is what `complete` says.
function installedRules() {
  for (const [root, key, complete] of [
    ['.claude/rules', 'paths', true],
    ['.cursor/rules', 'globs', true],
    ['.agents/rules', 'globs', true],       // Antigravity — same format as Cursor
    [AGENTS_RULE_DIR, 'paths', false],      // codex/opencode — path-scoped only
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

function doctor() {
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — nothing to audit. Run "add <profile...>" first.`); process.exit(1) }
  const agents = lock.agents || ['claude']
  const bad = [], warn = []
  console.log(`claude-rules doctor — ${process.cwd()}\n`)

  // ---- 1. the lock itself
  console.log('Install')
  const unknownP = lock.profiles.filter(p => !registry.profiles[p])
  const unknownA = agents.filter(a => !KNOWN_AGENTS.includes(a))
  for (const p of unknownP) bad.push(`lock references unknown profile "${p}" — \`update\` cannot emit it`)
  for (const a of unknownA) bad.push(`lock references unknown agent "${a}"`)
  console.log(`  ✓ lock: [${lock.profiles.join(', ')}] for [${agents.join(', ')}] @ ${lock.ref}`)
  // A module path that does not exist anchors every one of its globs to nothing —
  // the rules are emitted, look installed, and can never match a file.
  for (const [dir, ps] of Object.entries(lock.modules || {})) {
    if (!existsSync(dir)) bad.push(`module "${dir}" does not exist — [${ps.join(', ')}] are anchored to a path that is not there`)
    else console.log(`  ✓ module ${dir}: ${ps.join(', ')}`)
    for (const p of ps.filter(p => !lock.profiles.includes(p))) bad.push(`module "${dir}" claims "${p}", which is not in the lock's profiles`)
  }

  // ---- 2. what the lock promises vs what is on disk
  // Asymmetry, on purpose: for codex/opencode a rule destination is created only
  // when the profile HAS a path-scoped rule (rules/agent/ has none), and doctor
  // stages nothing, so it cannot tell a legitimate absence from a broken one.
  // It proves presence-that-should-not-be, never absence-that-should-be.
  const expected = new Map()
  const lockedEntries = [['(shared)', registry.shared], ...lock.profiles.map(p => [p, registry.profiles[p] || []])]
  for (const [profile, entries] of lockedEntries)
    for (const e of entries) for (const a of agents)
      for (const d of destsFor(e, a)) expected.set(d, { profile, agent: a, inferable: !(e.kind === 'rule' && (a === 'codex' || a === 'opencode')) })

  for (const [dest, meta] of expected)
    if (meta.inferable && !existsSync(dest)) bad.push(`${dest} — promised by "${meta.profile}" for ${meta.agent}, missing on disk (run \`update\`)`)

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
      warn.push('claude is locked but the repo has no CLAUDE.md — Claude reads CLAUDE.md, never AGENTS.md, so it starts every session with no project map (`init` writes a skeleton)')
  }
  if (agents.includes('codex') || agents.includes('opencode')) {
    const block = existsSync('AGENTS.md')
      ? (readFileSync('AGENTS.md', 'utf8').match(new RegExp(`${reEsc(AGENTS_START)}[\\s\\S]*?${reEsc(AGENTS_END)}`)) || [''])[0]
      : ''
    if (!block) bad.push('codex/opencode are locked but AGENTS.md has no managed block (run `update`)')
    else {
      const CODEX_CAP = 32 * 1024                                        // Codex `project_doc_max_bytes`
      const pct = Math.round(block.length / CODEX_CAP * 100)
      console.log(`  AGENTS.md   block      ${kb(block.length).padStart(9)}  (${tok(block.length)}, ${pct}% of Codex's 32 KiB cap)`)
      if (pct >= 40) warn.push(`the AGENTS.md managed block eats ${pct}% of Codex's 32 KiB instruction cap before any repo content`)
    }
  }

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
      if (!positional.length) { console.error('Usage: add <profile...> [--agent claude,cursor,antigravity,codex,opencode] [--module <dir>] [--ref <ref>]'); process.exit(1) }
      // `add` EXTENDS the install; it never redefines it. Writing only the new
      // profiles would leave the previous ones on disk but out of the lock —
      // invisible to `update`, and orphaned by `remove all`, which then deletes
      // the lock and leaves no way to find them.
      const lock = readLock()
      const profiles = [...new Set([...(lock ? lock.profiles : []), ...positional])]
      // Same rule for agents: no --agent on an existing install keeps its set
      // (never silently widen to all four); an explicit --agent adds a target.
      const locked = lock && lock.agents ? lock.agents : []
      const agents = [...new Set([...locked, ...parseAgents(locked.join(','))])]
      // --module anchors the profiles named in THIS invocation to a directory.
      // Like the rest of `add` it extends: a profile keeps the modules it already
      // had, and re-running with a second path adds it rather than moving it.
      const modules = { ...(lock && lock.modules ? lock.modules : {}) }
      if (moduleFlag) {
        const dir = moduleFlag.replace(/\/+$/, '')
        modules[dir] = [...new Set([...(modules[dir] || []), ...positional])]
      }
      if (lock) console.log(`Already locked: [${lock.profiles.join(', ')}] for [${locked.join(', ')}] — add extends that, and re-emits all of it.\n`)
      await install(profiles, refFlag || registry.defaultRef, agents, modules)
      break
    }
    case 'update': {
      const lock = readLock()
      if (!lock) { console.error(`No ${LOCK} found — run "add <profile...>" first.`); process.exit(1) }
      await install(lock.profiles, refFlag || registry.defaultRef, parseAgents((lock.agents && lock.agents.join(',')) || 'claude'), lock.modules)
      break
    }
    case 'remove': {
      if (!positional.length) { console.error('Usage: remove <profile...>   (or "remove all" to fully uninstall)'); process.exit(1) }
      remove(positional)
      break
    }
    case 'init': initRepo(); break
    case 'doctor': doctor(); break
    case 'budget': budget(positional[0]); break
    case 'list': {
      const lock = readLock()
      console.log('Available profiles:')
      for (const [name, entries] of Object.entries(registry.profiles)) console.log(`  ${name}  (${entries.map(e => e.from).join(', ')})`)
      console.log(`\nAgents: ${KNOWN_AGENTS.join(', ')} (default: all; narrow with --agent)`)
      console.log(lock ? `\nInstalled: [${lock.profiles.join(', ')}] for [${(lock.agents || ['claude']).join(', ')}] @ ${lock.ref}` : '\nInstalled: none')
      break
    }
    default:
      console.log('claude-rules — usage:\n'
        + '  add <profile...> [--agent claude,cursor,antigravity,codex,opencode] [--module <dir>] [--ref <ref>]\n'
        + '                                   install/pin profiles (default: all agents, repo-wide)\n'
        + '                                   --module anchors those profiles\' globs to a directory (monorepo)\n'
        + '  remove <profile...>              uninstall profiles (delete emitted files, update lock); "remove all" fully uninstalls\n'
        + '  update [--ref <ref>]             re-install locked profiles+agents at ref\n'
        + '  init                             assemble justfile + lefthook.yml (if absent) + lefthook install\n'
        + '  doctor [--strict]                audit the install against this repo (offline); --strict fails on warnings\n'
        + '  budget [<path>]                  what loads when that file is opened, and what it costs (no path: the session floor)\n'
        + '  list                             show available & installed profiles')
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
