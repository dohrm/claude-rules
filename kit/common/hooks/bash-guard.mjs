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
// (beforeShellExecution). One script, two payload dialects — see ask().
//
// It FAILS OPEN. A crash here must not brick a session, so an unreadable payload
// is reported on stderr and the command proceeds. A guard is a cost multiplier,
// never a proof.

import { readFileSync } from 'node:fs'

/** Quoted text is data, not flags: `git commit -m "drop the -n flag"` is innocent. */
const scrub = (s) => s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')

// The trunk as a WHOLE ref — preceded by a space or a colon (`HEAD:master`), or
// spelled in full (`refs/heads/main`), and ending there. `\b(main)\b` was matching
// the word inside an ordinary branch name: `feat/fix-main-nav` is not the trunk, and
// denying a push to it teaches everyone that the guard cries wolf.
const TRUNK_REF = String.raw`((\s|:)(main|master|trunk)|refs/heads/(main|master|trunk))(\s|:|$)`

// Only the current segment matters: `[^|;&]*` keeps a match from leaking across
// a `&&` into an unrelated command.
const DENY = [
  [/\bgit\b[^|;&]*\s--no-verify(?=\s|$)/,
    'hook bypass (--no-verify) is forbidden: fix the cause, never the gate'],
  [/\bgit\s+commit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/,
    '`git commit -n` bypasses the hooks — same rule as --no-verify'],
  [new RegExp(String.raw`\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)[^|;&]*` + TRUNK_REF),
    'force-push to the trunk is a human act, never an agent one'],
  [/\bgit\s+push\b[^|;&]*\s\+(main|master|trunk)(\s|:|$)/,
    'a `+ref` refspec IS a force-push, and the trunk is a human act'],
  [/\bgit\s+push\b[^|;&]*(--delete\s+|:)\s*(main|master|trunk)(\s|:|$)/,
    'deleting the trunk is a human act, never an agent one'],
  [/core\.hooksPath\s*=|\bgit\s+config\b[^|;&]*core\.hooksPath\s+\S/,
    'moving core.hooksPath disables the hook layer — reading it back is fine, setting it is not'],
  [/\blefthook\s+uninstall\b/,
    'uninstalling lefthook removes the gate layer — escalate instead'],
  [/(^|[\s;|&])(rm|mv|truncate|dd|sed\s+-i|chmod\s+-x)\b[^|;&]*\.git\/hooks\//,
    'emptying .git/hooks/ unwires the git floor — the cheapest bypass there is, and the one git itself cannot see'],
  [/(?<![0-9&])>>?\s*[^\s|;&]*\.git\/hooks\//,
    'writing .git/hooks/ by hand replaces the floor with whatever you put there — `lefthook install` owns those files'],
  [/\b(LEFTHOOK\s*=\s*(0|false)|LEFTHOOK_EXCLUDE\s*=|SKIP\s*=|HUSKY\s*=\s*0)/,
    'skipping the hooks through the environment is a hook bypass'],
  [/(^|[\s;|&])(rm|mv|cp|tee|truncate|dd|sed\s+-i)\b[^|;&]*review-report\.md/,
    'the review report is written by a review and by nothing else — a CRITICAL is answered by a fix, not by deleting the file'],
  [/>>?\s*[^\s|;&]*review-report\.md/,
    'writing the review report by hand forges the verdict review-guard reads'],
]

// The gate layer's own files. Reading them is normal; rewriting them is a
// decision. The list is deliberately short — every entry is a file whose content
// decides whether a gate exists or what "green" means.
//
// The gate file and the write used to be matched INDEPENDENTLY over the whole
// command, which escalates anything holding both a gate file and any redirect — so
// `cat justfile 2>/dev/null` asked, and headless an "ask" blocks. Two mistakes were
// folded into one: an fd redirect (`2>`, `1>&2`) is not a write to what is being
// read, and `sed -n` does not write at all. The pair below correlates the halves:
// the redirect must TARGET a gate file, or a genuinely mutating command must carry
// one among its arguments, in the same segment.
const GATE_SRC = String.raw`(?<![\w.-])(?:lefthook\.ya?ml|[Jj]ustfile|\.coverage-baseline|mutants\.toml|deny\.toml|\.docs-budgets\.json|\.claude/settings(?:\.local)?\.json|\.cursor/hooks\.json|\.codex/config\.toml|opencode\.jsonc?|\.git(?:hub|ea)/workflows/\S*|(?:adr-check|docs-check|review-guard|bash-guard|edit-guard)\.mjs|review-prompt\.md)`

/** A redirect whose target is a gate file. `(?<![0-9&])` spares `2>`, `1>&2`, `&>`. */
const REDIRECT_TO_GATE = new RegExp(String.raw`(?<![0-9&])>>?\s*[^\s|;&]*` + GATE_SRC)
/** A mutating command with a gate file in the SAME segment. `sed` counts only with -i. */
const MUTATOR_ON_GATE = new RegExp(
  String.raw`(^|[\s;|&])(rm|mv|cp|tee|truncate|dd|chmod|chown|ln|install|touch|sed\s+-i)\b[^|;&]*` + GATE_SRC)

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

  if (REDIRECT_TO_GATE.test(command) || MUTATOR_ON_GATE.test(command)) {
    ask(input, 'This command writes to the gate layer (a hook, a workflow, a justfile, a baseline). '
      + 'Editing the gates is sometimes the task — a human confirms it.')
  }
  return 0
}

process.exit(main())
