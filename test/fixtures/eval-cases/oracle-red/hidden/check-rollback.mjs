// Hidden from the agent: asks for a step the fake agent never writes.
import { readFileSync } from 'node:fs'
if (!readFileSync('docs/runbook/checkout.md', 'utf8').includes('checkout-rollback')) {
  console.error('no rollback step in the runbook')
  process.exit(1)
}
