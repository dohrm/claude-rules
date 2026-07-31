#!/usr/bin/env node
// A deterministic stand-in for an agent CLI, so the harness itself can be tested
// without spending a token. It behaves like the plain-text runners: reads the prompt
// as its last argument, writes a file into the workspace, prints a report.
//
// The prompt drives it, which is how the test proves the prompt actually arrived:
//   "BAD"        → write an artifact that must fail the case's assertions
//   "ANSWERED:n" → echo that n scripted answers reached it (--answers-inline)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

const prompt = process.argv[process.argv.length - 1]
const bad = prompt.includes('BAD')
const answers = (prompt.match(/^\d+\. /gm) || []).length

mkdirSync('docs/runbook', { recursive: true })
writeFileSync('docs/runbook/checkout.md', bad
  ? '# Runbook\n\nTODO: figure this out.\n'
  : [
      '# Runbook — checkout fast burn',
      '',
      '- **Last rehearsed**: Unrehearsed',
      '',
      '## First move — mitigate now',
      '',
      '```',
      'just checkout-killswitch-off',
      '```',
      '',
      '## Do NOT',
      '',
      '- Delete the queue.',
      '',
    ].join('\n'))

console.log(`fake-agent: wrote docs/runbook/checkout.md (bad=${bad}, answers=${answers})`)
console.log(`fake-agent: saw AGENTS.md=${existsSync('AGENTS.md')} skills=${existsSync('.claude/skills')}`)
