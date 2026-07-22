#!/usr/bin/env node
// claude-rules — install shared Claude Code rules / agents / kit into a repo.
// shadcn-style: copy + own + pin. The CLI is deliberately dumb; the source of
// truth is registry.json. It NEVER merges build config (lefthook/eslint) — kit
// entries are scaffolded and their wiring is printed for you to do once.
//
// Usage:
//   npx github:dohrm/claude-rules add rust [ts go] [--ref v1.2.0]
//   npx github:dohrm/claude-rules update [--ref v1.3.0]
//   npx github:dohrm/claude-rules list
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { downloadTemplate } from 'giget'

const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
const LOCK = '.claude-rules.lock'

const argv = process.argv.slice(2)
const cmd = argv[0]
const refFlag = (() => { const i = argv.indexOf('--ref'); return i >= 0 ? argv[i + 1] : null })()
const positional = argv.slice(1).filter(a => a !== '--ref' && a !== refFlag)

function readLock() {
  return existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null
}
function writeLock(ref, profiles) {
  writeFileSync(LOCK, JSON.stringify({ repo: registry.repo, ref, profiles }, null, 2) + '\n')
}

async function fetchEntry(ref, entry) {
  const src = `github:${registry.repo}/${entry.from}#${ref}`
  await downloadTemplate(src, { dir: entry.to, force: true })
  console.log(`  ✓ ${entry.from}  →  ${entry.to}`)
  return entry.wire ? `  • ${entry.to}: ${entry.wire}` : null
}

async function install(profiles, ref) {
  const unknown = profiles.filter(p => !registry.profiles[p])
  if (unknown.length) {
    console.error(`Unknown profile(s): ${unknown.join(', ')}. Available: ${Object.keys(registry.profiles).join(', ')}`)
    process.exit(1)
  }
  const entries = [...registry.shared, ...profiles.flatMap(p => registry.profiles[p])]
  console.log(`Installing [${profiles.join(', ')}] from ${registry.repo}#${ref}\n`)
  const notes = []
  for (const e of entries) {
    const note = await fetchEntry(ref, e)
    if (note) notes.push(note)
  }
  writeLock(ref, profiles)
  console.log(`\nPinned in ${LOCK} (ref ${ref}).`)
  if (notes.length) {
    console.log(`\nOne-time wiring (the installer never touches your build config):`)
    console.log(notes.join('\n'))
  }
  console.log(`\nWire rules into a CLAUDE.md with @-imports, e.g.  @.claude/rules/rust/quality-gates.md`)
}

async function main() {
  switch (cmd) {
    case 'add': {
      if (!positional.length) { console.error('Usage: add <profile...> [--ref <ref>]'); process.exit(1) }
      await install(positional, refFlag || registry.defaultRef)
      break
    }
    case 'update': {
      const lock = readLock()
      if (!lock) { console.error(`No ${LOCK} found — run "add <profile...>" first.`); process.exit(1) }
      await install(lock.profiles, refFlag || registry.defaultRef)
      break
    }
    case 'list': {
      const lock = readLock()
      console.log('Available profiles:')
      for (const [name, entries] of Object.entries(registry.profiles)) {
        console.log(`  ${name}  (${entries.map(e => e.from).join(', ')})`)
      }
      console.log(lock ? `\nInstalled: [${lock.profiles.join(', ')}] @ ${lock.ref}` : '\nInstalled: none')
      break
    }
    default:
      console.log('claude-rules — usage:\n  add <profile...> [--ref <ref>]   install/pin profiles\n  update [--ref <ref>]             re-install locked profiles at ref\n  list                             show available & installed profiles')
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
