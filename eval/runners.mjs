// Which CLI runs a case, and where that CLI reads its assets from.
//
// The harness covers the two targets the installer emits for: Claude Code and
// Cursor. A runner is four facts — the command line, the asset layout, the
// output format, and what the tool can and cannot do — and adding one is a
// table entry, not a code change. Anything else goes through `--cmd`.
//
// Cursor's flags were read off the installed binary's --help before the first
// run, and that run passed first time.

// Where each agent expects its assets. Mirrors bin/cli.mjs's emitters; the
// workspace is throwaway, so `agentsMd` gets a minimal generated file rather
// than a hand-written one. Cursor loads both `.cursor/rules/*.mdc` and a plain
// AGENTS.md; the `agents` layout is enough here, and the harness does not need
// the installer's .mdc transform.
export const LAYOUTS = {
  claude: { skills: '.claude/skills', agents: '.claude/agents', rules: '.claude/rules' },
  agents: { skills: '.agents/skills', agents: null,             rules: '.agents/rules',  agentsMd: true },
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

  // Cursor's agent CLI (`cursor-agent`, program name `agent`). Needs `agent login` or
  // CURSOR_API_KEY. Probed: it loads BOTH rule surfaces — a `.cursor/rules/*.mdc` with
  // alwaysApply AND a plain AGENTS.md — and discovers skills from `.agents/skills/`
  // as well as `.cursor/skills/`. So the `agents` layout is enough here.
  cursor: {
    bin: 'cursor-agent',
    layout: 'agents',
    format: 'text',
    drive: 'resume',          // --continue resumes the previous session
    subagents: false,
    // `-p` is print mode ("access to all tools, including write and shell");
    // `--force` allows the commands.
    args: ({ prompt, model }) => ['-p', '--force', ...withModel(model), prompt],
    resume: ({ answer, model }) => ['-p', '--continue', '--force', ...withModel(model), answer],
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
