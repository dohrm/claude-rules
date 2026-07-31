// Which CLI runs a case, and where that CLI reads its assets from.
//
// The harness is agent-agnostic for the same reason the installer is: the assets are,
// so a regression in them should be observable wherever they are used. A runner is
// four facts — the command line, the asset layout, the output format, and what the
// tool can and cannot do — and adding one is a table entry, not a code change.
//
// VERIFIED HERE: `claude`, and the generic `--cmd` path (against a fake runner in
// test/). Every entry marked `unverified` is written from the tool's documented
// non-interactive invocation and has NOT been run on this machine. The harness says
// so at startup, and a wrong flag is wrong on exactly one line — which is the point
// of the table. Confirm one, drop the flag, and it stops warning.

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
    streaming: true,          // can be driven turn by turn from `answers`
    subagents: true,          // can run a .claude/agents subagent, and we can detect it
    args: ({ prompt, model, streaming }) => [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--forward-subagent-text', '--dangerously-skip-permissions',
      ...(streaming ? ['--input-format', 'stream-json'] : []),
      ...withModel(model),
      ...(streaming ? [] : [prompt]),
    ],
  },

  opencode: {
    bin: 'opencode',
    layout: 'opencode',
    format: 'text',
    streaming: false,
    subagents: true,
    unverified: true,
    args: ({ prompt, model }) => ['run', ...withModel(model), prompt],
  },

  codex: {
    bin: 'codex',
    layout: 'agents',
    format: 'text',
    streaming: false,
    subagents: false,         // no file-based subagents (same gap the installer reports)
    unverified: true,
    args: ({ prompt, model }) => ['exec', ...withModel(model), prompt],
  },

  // Antigravity. Reads AGENTS.md like Codex, so it gets the same layout; the
  // non-interactive invocation below is a placeholder until someone runs it.
  antigravity: {
    bin: 'agy',
    layout: 'agents',
    format: 'text',
    streaming: false,
    subagents: false,
    unverified: true,
    args: ({ prompt, model }) => ['run', ...withModel(model), prompt],
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
      streaming: false,
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
  if (expect.answers?.length && !runner.streaming)
    return `${runner.name} cannot be driven turn by turn (use --answers-inline to fold the answers into the prompt)`
  if (expect.agent && runner.format !== 'stream-json')
    return `${runner.name} does not report whether a subagent ran`
  return null
}
