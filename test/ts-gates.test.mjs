// The TS jalon is a just library plus the eslint/tsconfig those recipes read.
// `npm run lint` is not a gate — this is: a throwaway repo, the shipped
// recipes, the shipped configs, then `just` itself. Locally skipped when just
// is missing. The ts-gates CI job sets TS_GATES=1 so a missing tool is a red
// job, never a skip-as-pass.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const FIXTURE = join(REPO, 'test', 'fixtures', 'ts-gate')
const KIT = {
  ts: join(REPO, 'kit', 'ts'),
  web: join(REPO, 'kit', 'ts-web'),
  node: join(REPO, 'kit', 'ts-node'),
  tauri: join(REPO, 'kit', 'ts-tauri'),
}
const TIMEOUT = 180_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

const whyMissing = missing('just', ['--version']) ? 'just not installed' : false

if (process.env.TS_GATES === '1' && whyMissing) {
  throw new Error(`TS_GATES=1 but the ts toolchain is incomplete: ${whyMissing}`)
}

const skip = whyMissing

const write = (dir, rel, body) => {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

const installDeps = (pkg) => {
  const fromNm = join(FIXTURE, 'node_modules')
  if (existsSync(fromNm)) {
    cpSync(fromNm, join(pkg, 'node_modules'), { recursive: true })
    return
  }
  const r = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: pkg, encoding: 'utf8' })
  if (r.error) throw r.error
  assert.equal(r.status, 0, `npm ci must install the witness lock:\n${r.stdout}${r.stderr}`)
}

const assemble = (dir, flavor) => {
  mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
  const pkg = join(dir, 'api')
  mkdirSync(join(pkg, 'src'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), readFileSync(join(FIXTURE, 'package.json')))
  writeFileSync(join(pkg, 'package-lock.json'), readFileSync(join(FIXTURE, 'package-lock.json')))
  writeFileSync(join(pkg, 'vitest.config.ts'), readFileSync(join(FIXTURE, 'vitest.config.ts')))

  if (flavor === 'ts') {
    mkdirSync(join(dir, '.dev/kit/ts'), { recursive: true })
    writeFileSync(join(dir, '.dev/kit/ts/ts.just'), readFileSync(join(KIT.ts, 'ts.just')))
    writeFileSync(join(pkg, 'eslint.config.js'), readFileSync(join(KIT.ts, 'eslint.base.js')))
    writeFileSync(join(pkg, 'tsconfig.json'), readFileSync(join(KIT.ts, 'tsconfig.base.json')))
    writeFileSync(join(pkg, 'src/add.ts'), readFileSync(join(FIXTURE, 'floor/add.ts')))
    writeFileSync(join(pkg, 'src/add.test.ts'), readFileSync(join(FIXTURE, 'floor/add.test.ts')))
    writeFileSync(
      join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\n"
        + "import '.dev/kit/ts/ts.just'\n"
        + 'ts_dir := "api"\n',
    )
  } else if (flavor === 'web') {
    mkdirSync(join(dir, '.dev/kit/ts-web'), { recursive: true })
    writeFileSync(join(dir, '.dev/kit/ts-web/ts-web.just'), readFileSync(join(KIT.web, 'ts-web.just')))
    writeFileSync(join(pkg, 'eslint.config.js'), readFileSync(join(KIT.web, 'eslint.react.js')))
    writeFileSync(join(pkg, 'tsconfig.json'), readFileSync(join(KIT.web, 'tsconfig.web.json')))
    writeFileSync(join(pkg, 'src/add-one.tsx'), readFileSync(join(FIXTURE, 'react/add-one.tsx')))
    writeFileSync(join(pkg, 'src/add-one.test.tsx'), readFileSync(join(FIXTURE, 'react/add-one.test.tsx')))
    writeFileSync(
      join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\n"
        + "import '.dev/kit/ts-web/ts-web.just'\n"
        + 'ts_web_dir := "api"\n',
    )
  } else if (flavor === 'node') {
    mkdirSync(join(dir, '.dev/kit/ts-node'), { recursive: true })
    writeFileSync(join(dir, '.dev/kit/ts-node/ts-node.just'), readFileSync(join(KIT.node, 'ts-node.just')))
    writeFileSync(join(pkg, 'eslint.config.js'), readFileSync(join(KIT.node, 'eslint.node.js')))
    writeFileSync(join(pkg, 'tsconfig.json'), readFileSync(join(KIT.node, 'tsconfig.node.json')))
    writeFileSync(join(pkg, 'src/add.ts'), readFileSync(join(FIXTURE, 'floor/add.ts')))
    writeFileSync(join(pkg, 'src/add.test.ts'), readFileSync(join(FIXTURE, 'floor/add.test.ts')))
    writeFileSync(
      join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\n"
        + "import '.dev/kit/ts-node/ts-node.just'\n"
        + 'ts_node_dir := "api"\n',
    )
  } else if (flavor === 'tauri') {
    mkdirSync(join(dir, '.dev/kit/ts-tauri'), { recursive: true })
    writeFileSync(join(dir, '.dev/kit/ts-tauri/ts-tauri.just'), readFileSync(join(KIT.tauri, 'ts-tauri.just')))
    writeFileSync(join(pkg, 'eslint.config.js'), readFileSync(join(KIT.tauri, 'eslint.react.js')))
    writeFileSync(join(pkg, 'tsconfig.json'), readFileSync(join(KIT.tauri, 'tsconfig.webview.json')))
    writeFileSync(join(pkg, 'src/add-one.tsx'), readFileSync(join(FIXTURE, 'react/add-one.tsx')))
    writeFileSync(join(pkg, 'src/add-one.test.tsx'), readFileSync(join(FIXTURE, 'react/add-one.test.tsx')))
    writeFileSync(
      join(dir, 'justfile'),
      'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\n"
        + "import '.dev/kit/ts-tauri/ts-tauri.just'\n"
        + 'ts_tauri_dir := "api"\n',
    )
  } else {
    throw new Error(`unknown flavor ${flavor}`)
  }
  installDeps(pkg)
}

const runJust = (dir, recipe) => {
  const r = spawnSync('just', [recipe], { cwd: dir, encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

test('the shipped eslint configs name any / ! (and the React overlay names hooks)', () => {
  const floor = readFileSync(join(KIT.ts, 'eslint.base.js'), 'utf8')
  assert.match(floor, /no-explicit-any/)
  assert.match(floor, /no-non-null-assertion/)
  const web = readFileSync(join(KIT.web, 'eslint.react.js'), 'utf8')
  assert.match(web, /react-hooks/)
  assert.match(web, /jsx-a11y/)
  const node = readFileSync(join(KIT.node, 'eslint.node.js'), 'utf8')
  assert.match(node, /globals\.node/)
  const tauri = readFileSync(join(KIT.tauri, 'eslint.react.js'), 'utf8')
  assert.equal(tauri.includes('react-hooks'), true)
})

// The witness is only a proof for what the README installs (#49: it locked react-hooks 5
// and eslint 9 while the README installed 7 and 10 unpinned, so both breakages passed here).
test('the ts-web README pins the majors the witness lock tests', () => {
  const readme = readFileSync(join(KIT.web, 'README.md'), 'utf8')
  const lock = JSON.parse(readFileSync(join(FIXTURE, 'package-lock.json'), 'utf8')).packages
  // Every `name@spec` on an `npm i` line, so a new pin is guarded too — and only a bare
  // major is comparable with the lock, so any other spec fails rather than being skipped.
  const pins = [...readme.matchAll(/^npm i(?: -D)? (.+)$/gm)]
    .flatMap(m => m[1].split(/\s+/)).map(t => t.match(/^(@?[^@\s]+)@(.+)$/)).filter(Boolean)
  const pinned = pins.map(([, name]) => name)
  for (const name of ['eslint', '@eslint/js', 'eslint-plugin-react-hooks', 'eslint-plugin-jsx-a11y'])
    assert.ok(pinned.includes(name), `${name} pinned: an unpinned major drifts from the witness`)
  for (const [tok, name, major] of pins) {
    assert.match(major, /^\d+$/, `${tok}: pin a bare major, the one the guard compares`)
    assert.equal(lock[`node_modules/${name}`]?.version.split('.')[0], major, `${tok}: the witness locks that major`)
  }
})

describe('ts language floor', { concurrency: 1 }, () => {
  test('just ts-lint / ts-check pass on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      const lint = runJust(dir, 'ts-lint')
      assert.equal(lint.status, 0, `ts-lint must be green:\n${lint.out}`)
      const r = runJust(dir, 'ts-check')
      assert.equal(r.status, 0, `ts-check must be green:\n${r.out}`)
    })
  })

  test('just ts-lint fails on any', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      write(dir, 'api/src/add.ts', 'export function addOne(n: any): number {\n  return n + 1\n}\n')
      const r = runJust(dir, 'ts-lint')
      assert.notEqual(r.status, 0, `any must fail ts-lint:\n${r.out}`)
      assert.match(r.out, /no-explicit-any|Unexpected any/)
    })
  })

  test('just ts-lint fails on a non-null assertion', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      write(
        dir,
        'api/src/add.ts',
        'export function addOne(n: number | null): number {\n  return n! + 1\n}\n',
      )
      const r = runJust(dir, 'ts-lint')
      assert.notEqual(r.status, 0, `! must fail ts-lint:\n${r.out}`)
      assert.match(r.out, /no-non-null-assertion|non-null/)
    })
  })

  test('just ts-check fails on a type error that lint does not see', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      write(dir, 'api/src/add.ts', 'export function addOne(n: number): string {\n  return n + 1\n}\n')
      const lint = runJust(dir, 'ts-lint')
      assert.equal(lint.status, 0, `a return-type miss is not an eslint finding:\n${lint.out}`)
      const r = runJust(dir, 'ts-check')
      assert.notEqual(r.status, 0, `tsc must fail ts-check:\n${r.out}`)
      assert.match(r.out, /Type 'number' is not assignable to type 'string'|TS2322/)
    })
  })

  test('just ts-check fails when a unit test fails', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      write(
        dir,
        'api/src/add.test.ts',
        "import { expect, test } from 'vitest'\nimport { addOne } from './add'\n\n"
          + "test('increments', () => {\n  expect(addOne(1)).toBe(99)\n})\n",
      )
      const lint = runJust(dir, 'ts-lint')
      assert.equal(lint.status, 0, `a red test is not a lint failure:\n${lint.out}`)
      const r = runJust(dir, 'ts-check')
      assert.notEqual(r.status, 0, `a red test must fail ts-check:\n${r.out}`)
      assert.match(r.out, /99|AssertionError|failed/)
    })
  })
})

// The typed rules ship in all four configs: each flavor must catch a dropped promise,
// or that flavor's config lost its `projectService`.
const FLOATING = 'async function save(n: number): Promise<number> {\n  return n\n}\n\n'
  + 'export function addOne(n: number): number {\n  save(n)\n  return n + 1\n}\n'
describe('typed lint rules', { concurrency: 1 }, () => {
  for (const [flavor, recipe, file] of [
    ['ts', 'ts-lint', 'api/src/add.ts'],
    ['node', 'ts-node-lint', 'api/src/add.ts'],
    ['web', 'ts-web-lint', 'api/src/save.ts'],
    ['tauri', 'ts-tauri-lint', 'api/src/save.ts'],
  ]) {
    test(`just ${recipe} fails on a floating promise`, { skip, timeout: TIMEOUT }, () => {
      withTmpRepo((dir) => {
        assemble(dir, flavor)
        write(dir, file, FLOATING)
        const r = runJust(dir, recipe)
        assert.notEqual(r.status, 0, `a dropped promise must fail ${recipe}:\n${r.out}`)
        assert.match(r.out, /no-floating-promises/)
      })
    })
  }

  const LINT_CASES = [
    ['a non-exhaustive switch',
      "type Op = 'inc' | 'dec'\n\nexport function addOne(n: number, op: Op = 'inc'): number {\n"
        + "  switch (op) {\n    case 'inc':\n      return n + 1\n  }\n  return n\n}\n",
      /switch-exhaustiveness-check/],
    ['== against a non-null value',
      'export function addOne(n: number): number {\n  if (n == 0) return 1\n  return n + 1\n}\n',
      /eqeqeq/],
  ]
  for (const [what, body, signal] of LINT_CASES) {
    test(`just ts-lint fails on ${what}`, { skip, timeout: TIMEOUT }, () => {
      withTmpRepo((dir) => {
        assemble(dir, 'ts')
        write(dir, 'api/src/add.ts', body)
        const r = runJust(dir, 'ts-lint')
        assert.notEqual(r.status, 0, `${what} must fail ts-lint:\n${r.out}`)
        assert.match(r.out, signal)
      })
    })
  }

  test('just ts-check fails on an unchecked index access', { skip, timeout: TIMEOUT }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'ts')
      write(dir, 'api/src/add.ts', 'export function addOne(n: number, xs: number[] = []): number {\n  const first: number = xs[0]\n  return n + first + 1 - first\n}\n')
      const r = runJust(dir, 'ts-check')
      assert.notEqual(r.status, 0, `xs[0] is number | undefined under noUncheckedIndexedAccess:\n${r.out}`)
      assert.match(r.out, /undefined/)
    })
  })

  test('just ts-web-lint fails on dangerouslySetInnerHTML', { skip, timeout: TIMEOUT }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'web')
      write(dir, 'api/src/raw.tsx', 'export function Raw({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />\n}\n')
      const r = runJust(dir, 'ts-web-lint')
      assert.notEqual(r.status, 0, `raw HTML must fail ts-web-lint:\n${r.out}`)
      assert.match(r.out, /No raw HTML/)
    })
  })
})

describe('ts-web', { concurrency: 1 }, () => {
  test('just ts-web-check passes on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'web')
      const r = runJust(dir, 'ts-web-check')
      assert.equal(r.status, 0, `ts-web-check must be green:\n${r.out}`)
    })
  })

  test('just ts-web-lint fails on a Rules-of-Hooks violation', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'web')
      write(
        dir,
        'api/src/add-one.tsx',
        "import { useState } from 'react'\n\n"
          + 'export function AddOne({ n }: { n: number }) {\n'
          + '  if (n > 0) {\n    const [x] = useState(n)\n    return <span>{x}</span>\n  }\n'
          + '  return <span>{n + 1}</span>\n}\n',
      )
      const r = runJust(dir, 'ts-web-lint')
      assert.notEqual(r.status, 0, `hooks-in-condition must fail ts-web-lint:\n${r.out}`)
      assert.match(r.out, /react-hooks|Rules of Hooks|useState/)
    })
  })
})

describe('ts-node', { concurrency: 1 }, () => {
  test('just ts-node-check passes on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'node')
      const r = runJust(dir, 'ts-node-check')
      assert.equal(r.status, 0, `ts-node-check must be green:\n${r.out}`)
    })
  })

  test('just ts-node-check fails on DOM that lint does not see', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'node')
      write(
        dir,
        'api/src/add.ts',
        'export function addOne(n: number): number {\n  document.title = String(n)\n  return n + 1\n}\n',
      )
      const lint = runJust(dir, 'ts-node-lint')
      assert.equal(lint.status, 0, `document is not an eslint finding under node globals:\n${lint.out}`)
      const r = runJust(dir, 'ts-node-check')
      assert.notEqual(r.status, 0, `tsc without DOM must fail ts-node-check:\n${r.out}`)
      assert.match(r.out, /document|Cannot find name/)
    })
  })
})

describe('ts-tauri', { concurrency: 1 }, () => {
  test('just ts-tauri-check passes on the witness package', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'tauri')
      const r = runJust(dir, 'ts-tauri-check')
      assert.equal(r.status, 0, `ts-tauri-check must be green:\n${r.out}`)
    })
  })

  test('just ts-tauri-lint fails on a Rules-of-Hooks violation', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir, 'tauri')
      write(
        dir,
        'api/src/add-one.tsx',
        "import { useState } from 'react'\n\n"
          + 'export function AddOne({ n }: { n: number }) {\n'
          + '  if (n > 0) {\n    const [x] = useState(n)\n    return <span>{x}</span>\n  }\n'
          + '  return <span>{n + 1}</span>\n}\n',
      )
      const r = runJust(dir, 'ts-tauri-lint')
      assert.notEqual(r.status, 0, `hooks-in-condition must fail ts-tauri-lint:\n${r.out}`)
      assert.match(r.out, /react-hooks|Rules of Hooks|useState/)
    })
  })
})
