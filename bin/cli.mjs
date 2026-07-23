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
//   npx github:dohrm/claude-rules add rust [ts go] [--agent claude,cursor,codex,opencode] [--ref v1.2.0]
//   npx github:dohrm/claude-rules update [--ref v1.3.0]     # re-install locked profiles+agents at ref
//   npx github:dohrm/claude-rules init                      # assemble justfile + lefthook.yml (if absent)
//   npx github:dohrm/claude-rules list
//   (dev/test) add … --local <path-to-this-repo>            # read assets from disk instead of GitHub
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
// giget is imported lazily (only add/update without --local need it) so init/list run with no deps.

const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
const LOCK = '.claude-rules.lock'
const KNOWN_AGENTS = ['claude', 'cursor', 'codex', 'opencode']

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const refFlag = flag('--ref')
const agentFlag = flag('--agent')
const localFlag = flag('--local')
const reserved = new Set(['--ref', refFlag, '--agent', agentFlag, '--local', localFlag].filter(Boolean))
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
const SKILL_DIR = { claude: '.claude/skills', cursor: '.agents/skills', codex: '.agents/skills', opencode: '.opencode/skills' }
const KIT_DIR   = { claude: '.claude/kit',    cursor: '.dev/kit',       codex: '.dev/kit',       opencode: '.dev/kit' }

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

// ----------------------------------------------------------------- transforms
// Claude rule (.md, `paths:`/`title:`) → Cursor rule (.mdc, `globs:`/`alwaysApply`).
function toMdcText(text) {
  const { fm, body } = splitFm(text)
  const out = {}
  const desc = fm.description || fm.title
  if (desc) out.description = desc
  if (Array.isArray(fm.paths) && fm.paths.length) { out.globs = fm.paths; out.alwaysApply = false }
  else out.alwaysApply = true
  return `---\n${dumpFm(out)}\n---\n${body}`
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
function emitClaudeRaw(s, entry) {   // rules & agents for Claude: verbatim copy to entry.to
  for (const f of stagedFiles(s)) { const t = s.isFile ? entry.to : join(entry.to, f.rel); ensureDir(dirname(t)); copyFileSync(f.abs, t) }
  logCopy(entry.from, entry.to); return null
}
function emitCursorRule(s, entry) {
  const root = '.cursor/rules'
  for (const f of mdFiles(s)) {
    const rel = (s.isFile ? f.rel : join(basename(entry.from), f.rel)).replace(/\.md$/, '.mdc')
    const t = join(root, rel); ensureDir(dirname(t)); writeFileSync(t, toMdcText(readFileSync(f.abs, 'utf8')))
  }
  logCopy(entry.from, join(root, s.isFile ? '' : basename(entry.from)) + '/*.mdc'); return null
}
// Codex & opencode have no per-file path-scoping: cross-cutting rules are inlined
// into AGENTS.md, path-scoped rules are copied to .agents/rules/ and referenced.
// AGENTS.md content is identical for both, so accumulate once (guarded by ctx.seen).
function emitAgentsRule(s, entry, agent, ctx) {
  if (ctx.seen.has(entry.from)) return null
  ctx.seen.add(entry.from)
  for (const f of mdFiles(s)) {
    const text = readFileSync(f.abs, 'utf8'); const { fm, body } = splitFm(text)
    if (Array.isArray(fm.paths) && fm.paths.length) {
      const rel = s.isFile ? f.rel : join(basename(entry.from), f.rel)
      const target = join('.agents/rules', rel)
      ensureDir(dirname(target)); copyFileSync(f.abs, target)
      ctx.refs.push({ globs: fm.paths, path: target, title: fm.title || fm.description || rel })
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
  claude:   { skill: emitSkill, kit: emitKit, rule: emitClaudeRaw,   agent: emitClaudeRaw },
  cursor:   { skill: emitSkill, kit: emitKit, rule: emitCursorRule,  agent: emitSkip },
  codex:    { skill: emitSkill, kit: emitKit, rule: emitAgentsRule,  agent: emitSkip },
  opencode: { skill: emitSkill, kit: emitKit, rule: emitAgentsRule,  agent: emitOpencodeAgent },
}

// AGENTS.md: rewrite a delimited, installer-owned block; never touch the user's content.
const AGENTS_START = '<!-- claude-rules:start (managed — do not edit inside this block) -->'
const AGENTS_END = '<!-- claude-rules:end -->'
function flushAgentsMd(ctx) {
  if (!ctx.inline.length && !ctx.refs.length) return
  const parts = [AGENTS_START, '# Project rules (managed by claude-rules)\n']
  if (ctx.inline.length) parts.push(ctx.inline.join('\n\n'))
  if (ctx.refs.length) {
    parts.push('\n## Path-scoped rules — read the referenced file when working on matching files\n')
    for (const r of ctx.refs) parts.push(`- **${r.title}** — for \`${r.globs.join('`, `')}\`: read \`${r.path}\``)
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

// -------------------------------------------------------------------- install
function readLock() { return existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null }
function writeLock(ref, profiles, agents) {
  writeFileSync(LOCK, JSON.stringify({ repo: registry.repo, ref, profiles, agents }, null, 2) + '\n')
}

const FINAL_MSG = {
  claude: 'Claude: .claude/rules/ auto-load (language rules path-scoped via `paths:`); .claude/agents/ + .claude/skills/ auto-discovered.',
  cursor: 'Cursor: .cursor/rules/*.mdc activate via globs/alwaysApply; skills in .agents/skills/. No file-based subagents.',
  codex: 'Codex: rules live in the AGENTS.md managed block (+ .agents/rules/ for path-scoped); skills in .agents/skills/. No file-based subagents.',
  opencode: 'opencode: rules in AGENTS.md (+ .agents/rules/); agents in .opencode/agent/; skills in .opencode/skills/.',
}

async function install(profiles, ref, agents) {
  const unknown = profiles.filter(p => !registry.profiles[p])
  if (unknown.length) {
    console.error(`Unknown profile(s): ${unknown.join(', ')}. Available: ${Object.keys(registry.profiles).join(', ')}`)
    process.exit(1)
  }
  const entries = [...registry.shared, ...profiles.flatMap(p => registry.profiles[p])]
  console.log(`Installing [${profiles.join(', ')}] for [${agents.join(', ')}] from ${localFlag || registry.repo}#${ref}\n`)
  const ctx = { inline: [], refs: [], seen: new Set() }
  const notes = []
  for (const entry of entries) {
    const s = await makeStaged(ref, entry)
    for (const agent of agents) {
      const emit = EMITTERS[agent][entry.kind]
      if (!emit) { console.error(`  ! no emitter for kind "${entry.kind}" (${entry.from})`); continue }
      const note = emit(s, entry, agent, ctx)
      if (note) notes.push(note)
    }
    if (s.temp) rmSync(s.dir, { recursive: true, force: true })
  }
  flushAgentsMd(ctx)
  writeLock(ref, profiles, agents)
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
function initRepo() {
  const lock = readLock()
  if (!lock) { console.error(`No ${LOCK} — run "add <profile...>" first.`); process.exit(1) }
  const techs = lock.profiles.filter(p => GLOB[p])
  const kitBase = KIT_DIR[(lock.agents && lock.agents[0]) || 'claude']
  const snippet = join(kitBase, 'common', 'justfile.snippet')
  if (existsSync('justfile') || existsSync('Justfile'))
    console.log(`• justfile exists — merge ${snippet} into it, then set the *_dir variables.`)
  else if (existsSync(snippet)) { copyFileSync(snippet, 'justfile'); console.log(`✓ created justfile (from ${snippet}) — set the *_dir variables to your layout.`) }
  else console.log(`• ${snippet} missing — run "add" first.`)

  if (existsSync('lefthook.yml') || existsSync('lefthook.yaml'))
    console.log(`• lefthook.yml exists — merge ${kitBase}/<tech>/lefthook.snippet.yml (thin triggers) into it.`)
  else if (techs.length) { writeFileSync('lefthook.yml', genLefthook(techs)); console.log(`✓ created lefthook.yml (triggers for: ${techs.join(', ')}).`) }

  if (!existsSync('.git')) console.log('• not a git repo — run `lefthook install` after `git init`.')
  else { const r = spawnSync('lefthook', ['install'], { stdio: 'inherit' }); if (r.error) console.log('• lefthook not found — install it, then run: lefthook install') }

  console.log(`\nStill manual (repo-specific): move deny.toml→<rust_dir>, mutants.toml→<rust_dir>/.cargo/, golangci.base.yml→.golangci.yml, mutation-ci.yaml→.gitea/workflows/; adapt eslint globalIgnores; enable your techs in the justfile \`check\` recipe.`)
}

// ----------------------------------------------------------------------- main
async function main() {
  switch (cmd) {
    case 'add': {
      if (!positional.length) { console.error('Usage: add <profile...> [--agent claude,cursor,codex,opencode] [--ref <ref>]'); process.exit(1) }
      await install(positional, refFlag || registry.defaultRef, parseAgents())   // no --agent → all agents
      break
    }
    case 'update': {
      const lock = readLock()
      if (!lock) { console.error(`No ${LOCK} found — run "add <profile...>" first.`); process.exit(1) }
      await install(lock.profiles, refFlag || registry.defaultRef, parseAgents((lock.agents && lock.agents.join(',')) || 'claude'))
      break
    }
    case 'init': initRepo(); break
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
        + '  add <profile...> [--agent claude,cursor,codex,opencode] [--ref <ref>]   install/pin profiles (default: all agents)\n'
        + '  update [--ref <ref>]             re-install locked profiles+agents at ref\n'
        + '  init                             assemble justfile + lefthook.yml (if absent) + lefthook install\n'
        + '  list                             show available & installed profiles')
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
