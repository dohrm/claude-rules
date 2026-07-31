// Which CLI runs a case, and where that CLI reads its assets from.
//
// The harness is agent-agnostic for the same reason the installer is: the assets are,
// so a regression in them should be observable wherever they are used. A runner is
// four facts — the command line, the asset layout, the output format, and what the
// tool can and cannot do — and adding one is a table entry, not a code change.
//
// VERIFIED HERE: `claude`, `opencode`, `codex`, `antigravity`, and the generic
// `--cmd` path (against a fake runner in test/). An entry marked `unverified` was
// written from documentation and never run; the harness says so at startup, and a
// wrong flag is wrong on exactly one line — which is the point of the table.
//
// Confirming one is worth the half hour. ALL THREE presets written blind were wrong,
// each in a way that fails SILENTLY rather than loudly:
//   • antigravity — Go flag syntax, `-p` takes the prompt as its VALUE, and it ignores
//     the process cwd, so without --add-dir the agent sees no assets and answers anyway;
//   • opencode — no `--auto`, so it stops at a permission prompt and writes nothing;
//   • codex — writes are gated by the SANDBOX (`-s workspace-write`), not by an
//     approval flag, so the obvious guess produces an empty workspace.
// None of that is visible from a --help page, and every one of them reads as
// "the skill does not work on this agent" when it is really "the invocation is wrong".

// Where each agent expects its assets. Mirrors bin/cli.mjs's emitters; the workspace
// is throwaway, so `agentsMd` gets a minimal generated file rather than the
// installer's idempotent managed block.
export const LAYOUTS = {
  claude:   { skills: '.claude/skills',   agents: '.claude/agents',   rules: '.claude/rules' },
  agents:   { skills: '.agents/skills',   agents: null,               rules: '.agents/rules',  agentsMd: true },
  opencode: { skills: '.opencode/skills', agents: '.opencode/agent',  rules: '.agents/rules',  agentsMd: true },
}

const withModel = (model, flag = '--model') => (model ? [flag, model] : [])

export const RUNNERS = {
  // Claude Code. Also the entry to use for a Claude-compatible endpoint (Ollama,
  // a proxy, a local model): same CLI, so override the model and export
  // ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN before running — the harness inherits
  // the environment. See eval/README.md.
  claude: {
    bin: 'claude',
    layout: 'claude',
    format: 'stream-json',
    drive: 'stdin',           // scripted answers go over a kept-open stdin
    subagents: true,          // can run a .claude/agents subagent, and we can detect it
    args: ({ prompt, model, streaming }) => [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--forward-subagent-text', '--dangerously-skip-permissions',
      ...(streaming ? ['--input-format', 'stream-json'] : []),
      ...withModel(model),
      ...(streaming ? [] : [prompt]),
    ],
  },

  // opencode. Respects the process cwd, and discovers skills from BOTH
  // `.opencode/skills/` and `.agents/skills/`. `--auto` is required or it stops for a
  // permission prompt and writes nothing; `-c` continues the last session, so scripted
  // answers work one invocation per turn. It has file-based subagents
  // (`.opencode/agent/`), but its text output does not say whether one ran, so agent
  // cases still skip — see unsupported().
  opencode: {
    bin: 'opencode',
    layout: 'opencode',
    format: 'text',
    drive: 'resume',
    subagents: true,
    args: ({ prompt, model }) => ['run', '--auto', ...withModel(model), prompt],
    resume: ({ answer, model }) => ['run', '--continue', '--auto', ...withModel(model), answer],
  },

  // Codex. Reads AGENTS.md and discovers skills from both .agents/skills/ and
  // .codex/skills/ (probed). `-s workspace-write` is what lets it write the artifact
  // without an approval prompt — the sandbox, not an approval flag, is the gate here.
  // `exec resume --last` continues the previous session, so scripted answers work.
  codex: {
    bin: 'codex',
    layout: 'agents',
    format: 'text',
    drive: 'resume',
    subagents: false,         // no file-based subagents (same gap the installer reports)
    args: ({ prompt, model }) =>
      ['exec', '--color', 'never', '-s', 'workspace-write', ...withModel(model), prompt],
    resume: ({ answer, model }) =>
      ['exec', 'resume', '--last', '--color', 'never', '-s', 'workspace-write',
       ...withModel(model), answer],
  },

  // Cursor's agent CLI — NOT verified here (not installed). A starting point, and the
  // entry that keeps the "unverified" warning honest: written from documentation,
  // which the two presets before it proved is not the same as working.
  cursor: {
    bin: 'cursor-agent',
    layout: 'agents',
    format: 'text',
    drive: null,
    subagents: false,
    unverified: true,
    args: ({ prompt, model }) => ['-p', ...withModel(model), prompt],
  },

  // Antigravity (`agy`). Its customization root is `.agents/`: skills at
  // skills/<name>/SKILL.md, rules at rules/*.md or a standalone AGENTS.md — the same
  // layout Codex uses, and what the installer already emits. Subagents live in
  // plugins rather than as loose files, so an agent case cannot run here.
  // No streaming stdin, but `--continue` resumes the last conversation, so a scripted
  // user works by re-invoking once per answer.
  antigravity: {
    bin: 'agy',
    layout: 'agents',
    format: 'text',
    drive: 'resume',
    subagents: false,   // agents ship inside plugins here, not as loose files
    // Three things this CLI does differently, all of them silent failures otherwise:
    //  • Go-style flags — a boolean needs `=true`, or `--flag value` swallows the value;
    //  • `-p` TAKES the prompt as its value rather than preceding it;
    //  • it IGNORES the process cwd (it runs from its own install dir), so the
    //    workspace has to be handed over with --add-dir or the assets are invisible.
    args: ({ prompt, model, ws }) => [
      '--add-dir', ws, '--dangerously-skip-permissions=true', '--print-timeout', '10m',
      ...withModel(model), '-p', prompt,
    ],
    // `--continue` picks up the most recent conversation for this workspace, so cases
    // must run one at a time — which they do.
    resume: ({ answer, model, ws }) => [
      '--add-dir', ws, '--dangerously-skip-permissions=true', '--continue=true',
      '--print-timeout', '10m', ...withModel(model), '-p', answer,
    ],
  },
}

/**
 * Resolve the runner for this invocation.
 * --runner <name>            a preset above (default: claude)
 * --bin <path>               override the preset's binary (a custom build, a wrapper)
 * --cmd "<tpl> {prompt}"     anything else: whitespace-split, `{prompt}` becomes one argv
 * --layout / --format        what that command expects (defaults: claude / text)
 */
export function resolveRunner({ runner, bin, cmd, layout, format }) {
  if (cmd) {
    const parts = cmd.trim().split(/\s+/)
    if (!parts.length) throw new Error('--cmd is empty')
    return {
      name: `custom(${parts[0]})`,
      bin: parts[0],
      layout: layout || 'claude',
      format: format || 'text',
      drive: null,
      subagents: false,
      args: ({ prompt }) => parts.slice(1).map(p => (p === '{prompt}' ? prompt : p)),
    }
  }
  const preset = RUNNERS[runner || 'claude']
  if (!preset) throw new Error(`unknown runner "${runner}". Known: ${Object.keys(RUNNERS).join(', ')} — or use --cmd`)
  return {
    ...preset,
    name: runner || 'claude',
    bin: bin || preset.bin,
    layout: layout || preset.layout,
    format: format || preset.format,
  }
}

/** Why this runner cannot run this case — or null when it can. */
export function unsupported(runner, expect) {
  if (expect.agent && !runner.subagents)
    return `${runner.name} has no file-based subagents`
  if (expect.answers?.length && !runner.drive)
    return `${runner.name} cannot be driven turn by turn (use --answers-inline to fold the answers into the prompt)`
  if (expect.agent && runner.format !== 'stream-json')
    return `${runner.name} does not report whether a subagent ran`
  return null
}
