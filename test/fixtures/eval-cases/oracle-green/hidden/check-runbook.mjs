// Hidden from the agent: copied into the workspace only after the run.
import { readFileSync } from 'node:fs'
if (!readFileSync('docs/runbook/checkout.md', 'utf8').includes('just checkout-killswitch-off')) process.exit(1)
