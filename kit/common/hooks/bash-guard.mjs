#!/usr/bin/env node

// bash-guard — the harness tier of the gate layer, for shell commands.
//
// rules/agent/autonomy.md says in prose what an agent must never do: bypass a
// hook, disable the gate layer, forge the review report. Prose persuades; this
// file does not. It is the second of TWO tiers, and it is the weaker one:
//
//   1. git (lefthook) — portable across every agent, the universal floor. It
//      catches what git can see: a commit on the trunk, an unanswered CRITICAL.
//   2. harness (this) — catches what git CANNOT see, because it never gets that
//      far: the `--no-verify`, the `lefthook uninstall`, the `rm` on the report.
//
// Neither tier makes drift impossible. They make it expensive and LOUD. The
// impossibility lives on the server (branch protection) and in the orchestrator.
// See ./README.md — do not sell this as more than it is.
//
// Two verdicts, on purpose:
//   • DENY (exit 2) — the command has no legitimate form. stderr comes back to
//     the agent as the reason, so it can fix the cause instead of the gate.
//   • ASK (json)    — the command WRITES to the gate layer itself. Sometimes
//     that is the task (`/ci-setup` edits a workflow), so a human decides.
//     Headless, "ask" blocks — which is the intended answer for an unattended run.
//
// Hosts: Claude Code (PreToolUse, matcher "Bash") and Cursor
// (beforeShellExecution). One script, two payload dialects — see reply().
//
// It FAILS OPEN. A crash here must not brick a session, so an unreadable payload
// is reported on stderr and the command proceeds. A guard is a cost multiplier,
// never a proof.

import { readFileSync } from 'node:fs'

/** Quoted text is data, not flags: `git commit -m "drop the -n flag"` is innocent. */
const scrub = (s) => s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')

// Only the current segment matters: `[^|;&]*` keeps a match from leaking across
// a `&&` into an unrelated command.
const DENY = [
  [/\bgit\b[^|;&]*\s--no-verify\b/,
    'hook bypass (--no-verify) is forbidden: fix the cause, never the gate'],
  [/\bgit\s+commit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/,
    '`git commit -n` bypasses the hooks — same rule as --no-verify'],
  [/\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)[^|;&]*\b(main|master|trunk)\b/,
    'force-push to the trunk is a human act, never an agent one'],
  [/\bgit\s+push\b[^|;&]*\s\+(main|master|trunk)\b/,
    'a `+ref` refspec IS a force-push, and the trunk is a human act'],
  [/\bgit\s+push\b[^|;&]*(--delete\s+|:)\s*(main|master|trunk)\b/,
    'deleting the trunk is a human act, never an agent one'],
  [/core\.hooksPath/,
    'moving core.hooksPath disables the hook layer'],
  [/\blefthook\s+uninstall\b/,
    'uninstalling lefthook removes the gate layer — escalate instead'],
  [/\b(LEFTHOOK\s*=\s*(0|false)|LEFTHOOK_EXCLUDE\s*=|SKIP\s*=|HUSKY\s*=\s*0)/,
    'skipping the hooks through the environment is a hook bypass'],
  [/(^|[\s;|&])(rm|mv|cp|tee|truncate|dd|sed)\b[^|;&]*review-report\.md/,
    'the review report is written by a review and by nothing else — a CRITICAL is answered by a fix, not by deleting the file'],
  [/>>?\s*[^\s|;&]*review-report\.md/,
    'writing the review report by hand forges the verdict review-guard reads'],
]

// The gate layer's own files. Reading them is normal; rewriting them is a
// decision. The list is deliberately short — every entry is a file whose content
// decides whether a gate exists or what "green" means.
const GATE_FILE = /(^|[\s/=])(lefthook\.ya?ml|justfile|Justfile|\.coverage-baseline|mutants\.toml|deny\.toml|\.docs-budgets\.json)\b|(\.claude\/settings(\.local)?\.json|\.cursor\/hooks\.json|\.codex\/config\.toml|opencode\.jsonc?|\.git(hub|ea)\/workflows\/|(adr-check|docs-check|review-guard|bash-guard|edit-guard)\.mjs|review-prompt\.md)/
const WRITES = /(^|[\s;|&])(rm|mv|cp|sed|tee|truncate|dd|chmod|chown|ln|install|touch)\b|>>?\s*\S/

const cmd = (input) => input.tool_input?.command ?? input.command ?? ''

/** Cursor payloads always carry a conversation_id; Claude Code's never do. */
const isCursor = (input) => 'conversation_id' in input

/** Same decision, two dialects. Exit 2 means "blocked" to both, so deny is shared. */
function ask(input, reason) {
  console.log(JSON.stringify(isCursor(input)
    ? { permission: 'ask', agent_message: reason }
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }))
}

function main() {
  let input
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch (e) {
    console.error(`bash-guard: unreadable hook payload (${e.message}) — failing open.`)
    return 0
  }

  const raw = cmd(input)
  if (!raw) return 0
  const command = scrub(raw)

  for (const [re, why] of DENY) {
    if (re.test(command)) {
      console.error(`Blocked: ${why}`)
      console.error('  If the gate is genuinely wrong, say so and escalate — do not route around it.')
      return 2
    }
  }

  if (GATE_FILE.test(command) && WRITES.test(command)) {
    ask(input, 'This command writes to the gate layer (a hook, a workflow, a justfile, a baseline). '
      + 'Editing the gates is sometimes the task — a human confirms it.')
  }
  return 0
}

process.exit(main())
