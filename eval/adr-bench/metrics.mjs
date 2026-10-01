// Best-effort CLI event interpretation. Keep raw traces for audits.
export function observedReads(events, paths) {
  const calls = (node) => {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(calls)
    const kind = String(node.tool || node.name || node.type || '')
    const match = /read|grep|glob|search|command_execution|bash|shell|tool_use/i.test(kind)
    const input = match ? [{ kind, value: node.input ?? node.arguments ?? node.command ?? node.state?.input ?? '' }] : []
    return [...input, ...Object.values(node).flatMap(calls)]
  }
  return [...new Set(events.filter(e => e.type !== 'item.started').flatMap(e => calls(e).flatMap(({ kind, value }) => {
    const source = typeof value === 'string' ? value : JSON.stringify(value)
    if (/^glob$/i.test(kind) || /\brg\s+--files\b/.test(source)) return []
    const exact = paths.filter(p => source.includes(p))
    // A listing tool returns names; it has not read those file contents.
    if (!/bash|shell|command_execution/i.test(kind) || !/\b(cat|sed|rg|grep|head)\b/.test(source)) return exact
    const all = /(?:\bcat\b|for\s+\w+\s+in)[^;]*docs\/adr\/(?:00)?\*\.md/.test(source)
      ? paths.filter(p => /^docs\/adr\/\d{4}-/.test(p)) : []
    const numbered = [...source.matchAll(/docs\/adr\/(\d{3})(?:\{([\d,]+)\}|(\d))-?\*\.md/g)]
      .flatMap(([, prefix, group, digit]) => (group || digit).split(',').map(n => `${prefix}${n}`))
    const expanded = paths.filter(p => numbered.some(n => p.startsWith(`docs/adr/${n}-`)))
    return [...exact, ...all, ...expanded]
  })))].sort()
}

export function eventUsage(events) {
  return events.filter(e => ['result', 'turn.completed', 'step_finish'].includes(e.type))
    .map(e => ({ usage: e.usage || e.part?.tokens || e.info?.tokens || null,
      costUsd: e.total_cost_usd ?? e.part?.cost ?? null }))
}

export function claudeInitMetadata(events) {
  const init = events.find(e => e.type === 'system' && e.subtype === 'init')
  return {
    modelObserved: typeof init?.model === 'string' ? init.model : null,
    claudeCodeVersion: typeof init?.claude_code_version === 'string' ? init.claude_code_version : null,
  }
}
