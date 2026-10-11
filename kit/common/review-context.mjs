#!/usr/bin/env node

// The `=== RFC ===` section of a review prompt: the frame the change was cut against,
// handed to the reviewer instead of left for it to find.
//
// The reviewer is read-only on purpose — no shell, no network — so it can read a local
// RFC but never follow a ticket RFC's pointer: there, `.work/<slug>/rfc.md` holds only
// `**Ticket**: <URL>`, and the review ran without its frame while saying nothing about
// it. In ticket mode the implementing agent caches the ticket, raw, in
// `.work/<slug>/review-context.md` before each phase's review (skills/rfc/ticket.md);
// this script only reads what is on disk.
//
// | on disk                                  | section                                     |
// |------------------------------------------|---------------------------------------------|
// | no `.work/<slug>/rfc.md`                 | "No RFC for this branch." — not a defect:   |
// |                                          | loops and ad hoc work have none             |
// | local `rfc.md`                           | its body, minus `## Revisions` and `## Log` |
// |                                          | (history), keeping Log's `changed:` entries |
// | ticket pointer + `review-context.md`     | the pointer header, then the cache, with    |
// |                                          | the time it was written                     |
// | ticket pointer, no cache; several RFCs   | "RFC context not available: …" — declared,  |
// | claiming the branch; a read error        | for the reviewer to report as a 🟡          |
//
//   node review-context.mjs [--slug <s>]    prints the section on stdout.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureWorkIgnored, headerOf, resolveSlug } from './work-slug.mjs'

const HISTORY = new Set(['revisions', 'log'])
const TICKET_HEADER = /^[ \t]*-[ \t]*\*\*Ticket\*\*:[ \t]*(\S+)/m

/** The document without its history sections: a `## ` heading named in HISTORY runs to
 *  the next `## ` heading or the end. A `changed:` entry of `## Log` is history that
 *  still binds — it is how a local decision moved — so those bullets are kept, under a
 *  heading of their own: without them the reviewer flags a recorded change as a
 *  departure. */
function withoutHistory(text) {
  const out = []
  const changed = []
  let section = null
  let bullet = null
  const flush = () => {
    if (bullet && /\bchanged:/.test(bullet.join('\n'))) changed.push(...bullet)
    bullet = null
  }
  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) {
      flush()
      section = h2[1].toLowerCase()
    }
    if (!HISTORY.has(section)) {
      out.push(line)
      continue
    }
    if (section !== 'log' || h2) continue
    if (/^\s*-\s/.test(line) && !/^\s{2,}-\s/.test(line)) {
      flush()
      bullet = [line]
    } else if (bullet && line.trim() !== '') bullet.push(line)
    else flush()
  }
  flush()
  const body = out.join('\n').replace(/\n+$/, '\n')
  return changed.length ? `${body}\n## Changed decisions (from ## Log)\n\n${changed.join('\n')}\n` : body
}

function reviewContext({ slug = '', cwd = '.' } = {}) {
  const resolved = resolveSlug({ slug, cwd })
  const dir = join('.work', resolved.slug)
  const rfcPath = join(dir, 'rfc.md')
  const head = `=== RFC ===\n\n`

  if (resolved.ambiguous) {
    return `${head}RFC context not available: ${resolved.ambiguous.map((d) => `.work/${d}/rfc.md`).join(', ')} `
      + 'all claim this branch in their **Branch** header — the tree contradicts its state files.\n'
  }
  if (!existsSync(join(cwd, rfcPath))) {
    return `${head}No RFC for this branch (slug \`${resolved.slug}\`, from the ${resolved.from}).\n`
  }

  const rfc = readFileSync(join(cwd, rfcPath), 'utf8')
  const ticket = headerOf(rfc).match(TICKET_HEADER)?.[1]
  if (!ticket) return `${head}Source: ${rfcPath} (local RFC)\n\n${withoutHistory(rfc)}`

  const cachePath = join(dir, 'review-context.md')
  if (!existsSync(join(cwd, cachePath))) {
    return `${head}RFC context not available: ${rfcPath} points to ${ticket} and no ${cachePath} `
      + 'was cached — the implementing agent writes it before each phase\'s review '
      + '(skills/rfc/ticket.md § Implementation). Report the review as run without its frame.\n\n'
      + `Pointer:\n\n${withoutHistory(rfc)}`
  }
  // A cache can sit on disk because a run wrote it; it is private either way.
  ensureWorkIgnored(cwd)
  const written = statSync(join(cwd, cachePath)).mtime.toISOString()
  return `${head}Source: ${ticket}, cached in ${cachePath} at ${written}\n\n`
    + `Pointer:\n\n${withoutHistory(rfc)}\nTicket:\n\n${readFileSync(join(cwd, cachePath), 'utf8')}`
}

// Context is the reviewer's input, never a gate: whatever goes wrong here is declared in
// the section and the review still runs.
const argv = process.argv.slice(2)
const i = argv.indexOf('--slug')
try {
  process.stdout.write(reviewContext({ slug: i === -1 ? '' : (argv[i + 1] ?? '') }))
} catch (err) {
  process.stdout.write(`=== RFC ===\n\nRFC context not available: ${err.message}\n`)
}
