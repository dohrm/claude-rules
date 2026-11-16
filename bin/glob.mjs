// Minimal glob → RegExp. Covers the syntax the shipped `paths:` actually use:
// `**/`, `**`, `*`, `?`, `{a,b}`. Not a general globber — a rule using anything
// else is reported as unmatched rather than silently mis-evaluated.
//
// kit/common/hooks/rule-loader.mjs carries its own copy: the kit is copied into
// consuming repos and cannot import bin/. test/rule-loader.test.mjs runs both on
// one table, so a change here must be made there too.
export function globToRe(glob) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re = '', i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3 } else { re += '.*'; i += 2 }
    } else if (c === '*') { re += '[^/]*'; i += 1 }
    else if (c === '?') { re += '[^/]'; i += 1 }
    else if (c === '{' && glob.includes('}', i)) {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map(esc).join('|') + ')'
      i = end + 1
    } else { re += esc(c); i += 1 }
  }
  return new RegExp(`^${re}$`)
}
