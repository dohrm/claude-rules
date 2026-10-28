#!/usr/bin/env node

// advisory-issue — the scheduled audit's reporter (kit/cicd/audit.snippet.yaml).
//
// Runs `just <tech>-audit`, then keeps ONE issue per audit in step with its verdict:
//   red   → open the issue, or update the open one with today's findings;
//   green → close the open issue; with none open, nothing is written.
// The issue is found by its title, `security-advisory: <tech>-audit`: the same string
// on GitHub and Gitea, where a label would be an id to look up first on Gitea.
//
// A red audit is REPORTED, not failed: its verdict moves with the advisory database,
// not with a commit, so the job stays green and the default branch never turns red
// with no change (rules/cicd/pipeline.md). An audit that could not run is no advisory:
// exit 2 on a usage or setup problem (bad argument, no token, `just` or the recipe
// missing, the audit tool not found, the audit killed), 1 when the issue could not be
// written.
//
// Forge access is the REST API through `fetch`, the same calls on both forges; the
// runner's env picks the endpoint. Both runners set GITHUB_REPOSITORY and
// GITHUB_API_URL (Gitea: `<instance>/api/v1`), and GITEA_ACTIONS=true on Gitea. The
// job passes its GITHUB_TOKEN through `env:`.
//
// Usage: node .dev/kit/cicd/advisory-issue.mjs <tech>-audit

import { spawn, spawnSync } from 'node:child_process'

// GitHub's issue body limit is 65 536 characters; the tail of the output is the summary.
const MAX_OUTPUT = 50_000
// Thousands of open issues; past that, a forge that ignores `page` is the likelier story.
const MAX_PAGES = 100

// Named in the issue, so nobody hunts for a go.mod fix that does not exist.
const NOTES = {
  'go-audit': 'A finding in the Go **standard library** (`stdlib`, `toolchain`) is fixed by the Go '
    + 'toolchain version — the runner image or the setup-go version — not by `go.mod`.',
}

function bail(msg) {
  console.error(`advisory-issue: ${msg}`)
  process.exit(2)
}

const recipe = process.argv[2]
if (!/^[a-z][a-z0-9-]*-audit$/.test(recipe ?? '')) bail(`usage: advisory-issue <tech>-audit (got ${recipe ?? 'nothing'})`)

const env = process.env
const gitea = env.GITEA_ACTIONS === 'true'
const token = env.GITHUB_TOKEN
const repo = env.GITHUB_REPOSITORY
const api = env.GITHUB_API_URL || (gitea ? `${env.GITHUB_SERVER_URL}/api/v1` : 'https://api.github.com')
if (!token) bail('GITHUB_TOKEN is empty — pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` through the step\'s env:')
if (!repo) bail('GITHUB_REPOSITORY is empty — run this from a workflow')
if (gitea && !env.GITHUB_API_URL && !env.GITHUB_SERVER_URL) bail('on Gitea, GITHUB_API_URL and GITHUB_SERVER_URL are both empty — run this from a workflow')
const title = `security-advisory: ${recipe}`

/** Runs the audit, echoing its output to the job log; resolves to its status and output.
 *  What says the audit never ran — no such recipe (a matrix entry left for a technology
 *  the repo lacks), the tool not found (127), a signal — stops here, as a red job. */
function audit() {
  const show = spawnSync('just', ['--show', recipe], { encoding: 'utf8' })
  if (show.error) bail(`cannot run just: ${show.error.message}`)
  if (show.status !== 0) bail(`no \`${recipe}\` recipe in this justfile — delete its matrix entry, or install its kit\n${show.stderr}`)
  return new Promise((resolve) => {
    const child = spawn('just', [recipe], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    // Decoded per stream, so a character split across two chunks survives (cargo deny draws boxes).
    const keep = (stream, sink) => stream.setEncoding('utf8').on('data', (chunk) => { out += chunk; sink.write(chunk) })
    keep(child.stdout, process.stdout)
    keep(child.stderr, process.stderr)
    child.on('error', (e) => bail(`cannot run just: ${e.message}`))
    child.on('close', (status, signal) => {
      if (status === null) bail(`just ${recipe} was killed (${signal})`)
      if (status === 127) bail(`just ${recipe}: the audit tool was not found (exit 127) — install it on the runner`)
      resolve({ status, out })
    })
  })
}

async function call(method, path, body) {
  const res = await fetch(`${api}/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-rules-advisory-issue',
    },
    body: body && JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** The open issue with our title. Pages until an empty one: a page shorter than asked
 *  is no proof of the end, since Gitea caps the page size per instance. Pull requests
 *  come back from the same endpoint on both forges and are skipped. */
async function findOpen() {
  const size = gitea ? 'limit=50' : 'per_page=100'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await call('GET', `/issues?state=open&${size}&page=${page}`)
    if (items.length === 0) return null
    const hit = items.find((i) => i.title === title && !i.pull_request)
    if (hit) return hit
  }
  throw new Error(`no empty page after ${MAX_PAGES} pages of open issues — does the API honour \`page\`?`)
}

function issueBody(status, out) {
  const tail = out.length > MAX_OUTPUT ? `…(truncated)\n${out.slice(-MAX_OUTPUT)}` : out
  const at = env.GITHUB_SHA ? ` at \`${env.GITHUB_SHA.slice(0, 12)}\`` : ''
  return [
    `\`just ${recipe}\` failed (exit ${status}) on the default branch${at}: the output below names the advisories. This issue is kept up to date by the`,
    'scheduled audit (`.dev/kit/cicd/advisory-issue.mjs`) and closed when the audit is green again.',
    '',
    ...(NOTES[recipe] ? [NOTES[recipe], ''] : []),
    `Reproduce with \`just ${recipe}\`. Fix by upgrading the dependency: the lock change then runs the`,
    'audit in that PR\'s gate. Ignoring an advisory is a decision: write its reason next to the ignore.',
    '',
    '````text',
    tail.trimEnd(),
    '````',
  ].join('\n')
}

const { status, out } = await audit()
try {
  const open = await findOpen()
  if (status !== 0 && open) {
    await call('PATCH', `/issues/${open.number}`, { body: issueBody(status, out) })
    console.log(`advisory-issue: ${recipe} is red — updated #${open.number}`)
  } else if (status !== 0) {
    const made = await call('POST', '/issues', { title, body: issueBody(status, out) })
    console.log(`advisory-issue: ${recipe} is red — opened #${made.number}`)
  } else if (open) {
    await call('PATCH', `/issues/${open.number}`, { state: 'closed' })
    console.log(`advisory-issue: ${recipe} is green — closed #${open.number}`)
  } else {
    console.log(`advisory-issue: ${recipe} is green — no open issue`)
  }
} catch (e) {
  console.error(`advisory-issue: cannot report ${recipe} (${gitea ? 'Gitea' : 'GitHub'} at ${api}): ${e.message}`)
  process.exit(1)
}
