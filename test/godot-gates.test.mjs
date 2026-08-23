// The godot jalon is a just library plus the Roslyn analyzers those recipes
// load. A comment that lists GODOT001 is not a gate — this is: a throwaway
// repo, the shipped godot.just, the shipped analyzers, then `just` itself.
// Locally skipped when just or dotnet is missing. The godot-gates CI job
// sets GODOT_GATES=1 so a missing tool is a red job, never a skip-as-pass.
// Headless export needs the engine; the factory witness stubs godot_bin
// with `true` so `dotnet test` is reachable without installing Godot.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const FIXTURE = join(REPO, 'test', 'fixtures', 'godot-gate')
const KIT = join(REPO, 'kit', 'godot')
const NUGET_PACKAGES = join(tmpdir(), 'claude-rules-godot-nuget')
const SRC = 'game/AddOne.cs'
const TIMEOUT = 180_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

const whyMissing = missing('just', ['--version']) ? 'just not installed'
  : missing('dotnet', ['--version']) ? 'dotnet not installed'
  : false

if (process.env.GODOT_GATES === '1' && whyMissing) {
  throw new Error(`GODOT_GATES=1 but the godot toolchain is incomplete: ${whyMissing}`)
}

const skip = whyMissing

const write = (dir, rel, body) => {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

const git = (dir, args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.error) throw r.error
  return r
}

const assemble = (dir) => {
  mkdirSync(join(dir, '.dev/kit/common'), { recursive: true })
  mkdirSync(join(dir, '.dev/kit/godot'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/common/gate.just'), readFileSync(join(REPO, 'kit/common/gate.just')))
  writeFileSync(join(dir, '.dev/kit/godot/godot.just'), readFileSync(join(KIT, 'godot.just')))
  writeFileSync(join(dir, '.dev/kit/godot/check-no-new-gd.sh'), readFileSync(join(KIT, 'check-no-new-gd.sh')))
  chmodSync(join(dir, '.dev/kit/godot/check-no-new-gd.sh'), 0o755)
  const skipBuild = (src) => !/(^|[/\\])(bin|obj)([/\\]|$)/.test(src)
  cpSync(join(KIT, 'analyzers'), join(dir, '.dev/kit/godot/analyzers'), {
    recursive: true,
    filter: skipBuild,
  })
  cpSync(FIXTURE, join(dir, 'game'), { recursive: true, filter: skipBuild })
  writeFileSync(join(dir, '.godot-gd-allowlist'), '')
  writeFileSync(
    join(dir, 'justfile'),
    'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/common/gate.just'\n"
      + "import '.dev/kit/godot/godot.just'\n"
      + 'godot_dir := "game"\n'
      + 'godot_bin := "true"\n',
  )
  git(dir, ['init', '-q'])
  git(dir, ['add', '-A'])
  const committed = git(dir, [
    '-c', 'user.email=jalon@test',
    '-c', 'user.name=jalon',
    'commit', '-m', 'witness', '--no-gpg-sign', '-q',
  ])
  assert.equal(committed.status, 0, `git commit must seed ls-files:\n${committed.stdout}${committed.stderr}`)
}

const runEnv = {
  ...process.env,
  NUGET_PACKAGES,
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
}

const runJust = (dir, recipe) => {
  const r = spawnSync('just', [recipe], { cwd: dir, encoding: 'utf8', env: runEnv })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const GREEN = readFileSync(join(FIXTURE, 'AddOne.cs'), 'utf8')

test('the shipped analyzers name GODOT001–003', () => {
  const files = ['HardcodedGameplayValueAnalyzer.cs', 'SignalDeclarationAnalyzer.cs', 'StringNodePathAnalyzer.cs']
  const ids = ['GODOT001', 'GODOT002', 'GODOT003']
  for (let i = 0; i < files.length; i++) {
    const src = readFileSync(join(KIT, 'analyzers', files[i]), 'utf8')
    assert.match(src, new RegExp(ids[i]))
  }
  const editor = readFileSync(join(KIT, 'analyzers', '.editorconfig'), 'utf8')
  for (const id of ids) assert.match(editor, new RegExp(`dotnet_diagnostic.${id}.severity = error`))
})

describe('godot quality gates', { concurrency: 1 }, () => {
  test('just godot-lint passes on the witness project', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'godot-lint')
      assert.equal(r.status, 0, `godot-lint must be green:\n${r.out}`)
    })
  })

  test('just godot-check passes on the witness project', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      const r = runJust(dir, 'godot-check')
      assert.equal(r.status, 0, `godot-check must be green:\n${r.out}`)
    })
  })

  test('just godot-lint fails on a hardcoded gameplay value', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, SRC, GREEN.replace('n + 1', 'n + 5'))
      const r = runJust(dir, 'godot-lint')
      assert.notEqual(r.status, 0, `GODOT001 must fail godot-lint:\n${r.out}`)
      assert.match(r.out, /GODOT001/)
    })
  })

  test('just godot-lint fails on a [Signal] outside EventBus', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        SRC,
        'namespace GateProbe\n{\n'
          + '    public sealed class AddOne : Godot.Node\n    {\n'
          + '        [Godot.Signal] public delegate void DiedEventHandler();\n'
          + '        public int Add(int n) => n + 1;\n    }\n}\n',
      )
      const r = runJust(dir, 'godot-lint')
      assert.notEqual(r.status, 0, `GODOT002 must fail godot-lint:\n${r.out}`)
      assert.match(r.out, /GODOT002/)
    })
  })

  test('just godot-lint fails on GetNode with a string path', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        SRC,
        'namespace GateProbe\n{\n'
          + '    public sealed class AddOne : Godot.Node\n    {\n'
          + '        public int Add(int n)\n        {\n'
          + '            GetNode("Sprite");\n            return n + 1;\n        }\n    }\n}\n',
      )
      const r = runJust(dir, 'godot-lint')
      assert.notEqual(r.status, 0, `GODOT003 must fail godot-lint:\n${r.out}`)
      assert.match(r.out, /GODOT003/)
    })
  })

  test('just godot-lint fails on a new .gd file', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(dir, 'legacy.gd', 'extends Node\n')
      git(dir, ['add', 'legacy.gd'])
      const r = runJust(dir, 'godot-lint')
      assert.notEqual(r.status, 0, `a new .gd must fail godot-lint:\n${r.out}`)
      assert.match(r.out, /legacy\.gd|no new \.gd/)
    })
  })

  test('just godot-check fails when a unit test fails', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      assemble(dir)
      write(
        dir,
        'game/AddOneTests.cs',
        'using Xunit;\n\nnamespace GateProbe\n{\n'
          + '    public sealed class AddOneTests\n    {\n'
          + '        [Fact]\n        public void Increments() => Assert.Equal(99, new AddOne().Add(1));\n'
          + '    }\n}\n',
      )
      const lint = runJust(dir, 'godot-lint')
      assert.equal(lint.status, 0, `a red test is not a lint failure:\n${lint.out}`)
      const r = runJust(dir, 'godot-check')
      assert.notEqual(r.status, 0, `a red test must fail godot-check:\n${r.out}`)
      assert.match(r.out, /Failed|Assert|99/)
    })
  })
})
