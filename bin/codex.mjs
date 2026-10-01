// Codex output and ownership. Rule selection is requested reading, not native loading.
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname, join, isAbsolute, sep, posix } from 'node:path'
import { createHash } from 'node:crypto'

export const START = '<!-- claude-rules:start (managed — do not edit inside this block) -->'
export const END = '<!-- claude-rules:end -->'
export const hash = content => createHash('sha256').update(content).digest('hex')
const slash = path => path.split(sep).join('/')

export function modulePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || /^[A-Za-z]:/.test(path) || /[\x00-\x1f`|<>]/.test(path) || path.split('/').includes('..'))
    throw new Error(`Unsafe module path: ${path}`)
  return posix.normalize(path).replace(/\/$/, '') || '.'
}

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

function parts(text, path) {
  const starts = text.split(START).length - 1, ends = text.split(END).length - 1
  if (!starts && !ends) return null
  const a = text.indexOf(START), b = text.indexOf(END)
  if (starts !== 1 || ends !== 1 || b < a) throw new Error(`Malformed managed markers in ${path}; no files changed`)
  return { before: text.slice(0, a), block: text.slice(a, b + END.length), after: text.slice(b + END.length) }
}
const link = (from, to) => slash(relative(dirname(from), to)).split('/').map(encodeURIComponent).join('/')

export function instructionBlocks(rules, modules) {
  const blocks = {}
  for (const [dir, profiles] of Object.entries(modules)) {
    const file = join(dir, 'AGENTS.md')
    const rows = new Map()
    for (const rule of rules) {
      const own = rule.profiles.some(p => profiles.includes(p))
      let globs = rule.globs
      if (dir === '.') {
        if (!own && rule.profiles.length && globs.length) globs = globs.filter(g => /(?:^|\/)docs\//.test(g))
        if (!own && rule.profiles.length && rule.globs.length && !globs.length) continue
      } else {
        if (!own || !globs.length) continue
        globs = globs.filter(g => g.startsWith(`${dir}/`))
        if (!globs.length) continue
      }
      rows.set(rule.path, `- [${rule.title.replace(/[\[\]\r\n]/g, '')}](<${link(file, rule.path)}>) — ${globs.length ? `read when working on: ${globs.map(g => `\`${g}\``).join(', ')}` : 'read for every task'}.`)
    }
    const lines = [START, '## Installed guidance', '', 'Rule globs below are relative to the repository root; links are relative to this file.',
      'Read the applicable linked rules before edits or review. These are reading instructions, not automatic file-glob loading.', '']
    if (dir === '.') {
      lines.push('Before editing or reviewing files, discover applicable AGENTS.md files from the repository root through the target directory, including intermediate directories.',
        'At each directory use AGENTS.override.md instead when present. Read guidance not already in context, apply it only to its subtree, and repeat discovery when the task enters another directory.',
        'Before creating a directory or document, read its applicable ancestor and document rules. Carry this discovery obligation into delegated tasks; delegation is optional.', '', '### Modules', '')
      for (const mod of Object.keys(modules).filter(d => d !== '.')) lines.push(`- [${mod.replace(/[\[\]]/g, '')}](<${link(file, join(mod, 'AGENTS.md'))}>)`)
      lines.push('', '### Common and root rules', '')
    }
    lines.push(...rows.values(), '', END)
    blocks[slash(file)] = lines.join('\n')
  }
  return blocks
}

function checkInventory(previous = {}) {
  if (previous.version !== undefined && previous.version !== 1) throw new Error('Unsupported Codex ownership version')
  for (const path of Object.keys(previous.files || {})) {
    if (!/^\.agents\/(rules|skills)\/.+/.test(path)) throw new Error(`Invalid Codex-owned path: ${path}`)
    if (safePath(path) !== path) throw new Error(`Noncanonical owned path: ${path}`)
  }
  for (const rule of previous.rules || []) {
    if (previous.files?.[rule.path]?.kind !== 'rule') throw new Error(`Unowned rule reference: ${rule.path}`)
  }
  for (const path of previous.blocks || []) {
    if (path !== 'AGENTS.md' && !path.endsWith('/AGENTS.md')) throw new Error(`Invalid instruction path: ${path}`)
    if (safePath(path) !== path) throw new Error(`Noncanonical owned path: ${path}`)
  }
}

export function prepareCodex(files, rules, modules, previous = {}) {
  checkInventory(previous)
  const blocks = instructionBlocks(rules, modules)
  const writes = new Map(), deletes = [], inventory = { version: 1, files: {}, rules, blocks: Object.keys(blocks) }
  for (const [path, asset] of Object.entries(files)) {
    safePath(path)
    if (existsSync(path)) {
      if (!lstatSync(path).isFile()) throw new Error(`Conflicting destination: ${path}`)
      const current = hash(readFileSync(path)), old = previous.files?.[path]?.hash
      if (current !== hash(asset.content) && current !== old) throw new Error(`Conflicting local content: ${path}; reconcile before updating`)
    }
    writes.set(path, asset.content)
    inventory.files[path] = { hash: hash(asset.content), profiles: asset.profiles, kind: asset.kind }
  }
  for (const [path, old] of Object.entries(previous.files || {})) {
    if (files[path] || !existsSync(path)) continue
    if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== old.hash) throw new Error(`Modified owned file would be removed: ${path}`)
    deletes.push(path)
  }
  for (const path of new Set([...Object.keys(blocks), ...(previous.blocks || [])])) {
    safePath(path)
    if (existsSync(path) && !lstatSync(path).isFile()) throw new Error(`Conflicting instruction file: ${path}`)
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const split = parts(text, path), block = blocks[path]
    if (block) writes.set(path, split ? split.before + block + split.after : text + (text && !text.endsWith('\n') ? '\n' : '') + block + '\n')
    else if (split) {
      const rest = split.before + split.after
      if (rest.trim()) writes.set(path, rest)
      else deletes.push(path)
    }
  }
  return { writes, deletes, inventory }
}

export function applyCodex(plan) {
  for (const [path, content] of plan.writes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  for (const path of plan.deletes) {
    rmSync(path)
    // Remove empty asset directories only; never remove a module directory.
    let dir = dirname(path)
    while (dir.startsWith('.agents/') && existsSync(dir) && !readdirSync(dir).length) { rmSync(dir, { recursive: true }); dir = dirname(dir) }
  }
}

export function auditCodex(lock, bad, warn) {
  if (!lock.codex) { bad.push('Codex ownership inventory missing — explicitly update to adopt the installation'); return }
  try {
    checkInventory(lock.codex)
    for (const [path, asset] of Object.entries(lock.codex.files)) {
      if (!existsSync(path)) bad.push(`${path} — Codex asset missing`)
      else if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== asset.hash) bad.push(`${path} — Codex asset differs from its installed revision`)
    }
    const expected = instructionBlocks(lock.codex.rules, lock.modules)
    for (const path of new Set([...Object.keys(expected), ...lock.codex.blocks])) {
      safePath(path)
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      if (parts(text, path)?.block !== expected[path]) bad.push(`${path} — missing or stale Codex instruction block`)
      const override = join(dirname(path), 'AGENTS.override.md')
      if (existsSync(override)) warn.push(`${override} shadows generated guidance in ${path}`)
    }
    for (const dir of Object.keys(lock.modules)) {
      const chain = Object.keys(expected).filter(p => dirname(p) === '.' || dir === dirname(p) || dir.startsWith(`${dirname(p)}/`))
      const bytes = chain.reduce((n, p) => n + (existsSync(p) ? Buffer.byteLength(readFileSync(p)) : 0), 0)
      if (bytes >= 28 * 1024) warn.push(`Codex instruction chain for ${dir}: ${bytes} bytes; default limit 32768; global/user instructions also consume it`)
    }
    console.log('  • Codex routing requests explicit reads; doctor cannot prove model adherence. Global config and nested instructions can change discovery.')
  } catch (e) { bad.push(e.message) }
}

export function codexBudget(lock, target, globToRe) {
  if (!lock?.codex) throw new Error('No Codex ownership inventory — install with --agent codex first')
  checkInventory(lock.codex)
  const path = target ? safePath(target) : null
  const dir = path ? dirname(path) : '.'
  const chain = []
  let current = '.'
  for (const segment of ['.', ...dir.split('/').filter(p => p !== '.')]) {
    if (segment !== '.') current = join(current, segment)
    const override = join(current, 'AGENTS.override.md'), regular = join(current, 'AGENTS.md')
    const file = existsSync(override) ? override : regular
    safePath(file)
    if (existsSync(file)) chain.push(file)
  }
  console.log(`Codex requested reading${path ? ` for ${path}` : ''} — estimates, not actual runtime context`)
  const print = (label, bytes) => console.log(`  ${label}: ${bytes} bytes (~${Math.ceil(bytes / 4)} tokens)`)
  let total = 0
  for (const p of chain) { const n = readFileSync(p).length; total += n; print(`instruction entry ${p}`, n) }
  const seen = new Set()
  for (const rule of lock.codex.rules) {
    if (seen.has(rule.path) || (rule.globs.length && (!path || !rule.globs.some(g => globToRe(g).test(path))))) continue
    seen.add(rule.path); safePath(rule.path)
    const n = readFileSync(rule.path).length; total += n
    print(`${rule.globs.length ? 'conditional' : 'unconditional'} rule ${rule.path}`, n)
  }
  let skillBytes = 0
  for (const [p, asset] of Object.entries(lock.codex.files)) if (asset.kind === 'skill' && p.endsWith('/SKILL.md')) {
    const text = readFileSync(p, 'utf8')
    skillBytes += Buffer.byteLength(text.match(/^description:\s*(.*)$/m)?.[1] || '')
  }
  print('skill descriptions (estimate)', skillBytes)
  print('total requested reading', total + skillBytes)
  console.log('  Startup discovery depends on launch directory. Rule reads are progressive instructions; overrides/configuration may change them. Global guidance is not measured.')
}
