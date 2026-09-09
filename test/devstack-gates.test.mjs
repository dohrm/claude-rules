// The devstack jalon. Not a gate — `kit/devstack` deliberately gates nothing —
// but the kit makes two claims that are expensive to get wrong and that reading
// process-compose's documentation actively misleads you about. Both were found by
// hand, live, and nothing would have replayed them. This does.
//
// 1. A quiet service's `.logs/<svc>.log` does NOT contain what it just printed.
//    The file is written in blocks and flushed at shutdown, so tailing it after an
//    action shows nothing while the action DID happen — the exact false signal
//    `rules/devstack/running.md` exists to prevent. `just logs` asks the supervisor
//    and is immediate.
// 2. Two work trees do not share a control plane. process-compose serves its API on
//    TCP :8080 by default, and a second `up` reports SUCCESS with no port error, so
//    the failure is silent: `just restart` in one tree drives the other tree's
//    stack. The kit's per-tree unix socket is what prevents it.
//
// Locally, skipped when just / process-compose are missing. The devstack-gates CI
// job sets DEVSTACK_GATES=1 so a missing tool is a red job, never a skip-as-pass.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, withTmpRepo } from './helpers.mjs'

const KIT = join(REPO, 'kit', 'devstack')
const TIMEOUT = 120_000

const missing = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return Boolean(r.error) || r.status !== 0
}

// `process-compose version` is a SUBCOMMAND, not a flag: `--version` exits 1 even
// when the binary is there. Probing with the flag made every test below skip while
// process-compose was installed — a skip-as-pass, which is the one outcome this
// file exists to make impossible.
const why = missing('just', ['--version']) ? 'just not installed'
  : missing('process-compose', ['version']) ? 'process-compose not installed'
  : false

if (process.env.DEVSTACK_GATES === '1' && why) {
  throw new Error(`DEVSTACK_GATES=1 but the devstack toolchain is incomplete: ${why}`)
}

const skip = why

/** A repo carrying the shipped library, imported the way `claude-rules init` writes it. */
const assemble = (dir, stack) => {
  mkdirSync(join(dir, '.dev/kit/devstack'), { recursive: true })
  writeFileSync(join(dir, '.dev/kit/devstack/devstack.just'), readFileSync(join(KIT, 'devstack.just')))
  writeFileSync(
    join(dir, 'justfile'),
    'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
      + "import '.dev/kit/devstack/devstack.just'\n",
  )
  if (stack) writeFileSync(join(dir, 'process-compose.yaml'), stack)
}

const runJust = (dir, ...args) => {
  const r = spawnSync('just', args, { cwd: dir, encoding: 'utf8' })
  if (r.error) throw r.error
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

/** What `just` resolves a variable to, through the import. */
const evaluate = (dir, name) => {
  const r = runJust(dir, '--evaluate')
  const line = r.out.split('\n').find((l) => l.trim().startsWith(`${name} `))
  return line ? line.split(':=')[1].trim().replace(/^"|"$/g, '') : null
}

// One service, one line, then idle. The whole point is that it is QUIET: a chatty
// service crosses the block boundary and its file looks fine, which is why this trap
// survives casual testing. No probe, no dependency, no docker — this must run
// anywhere `just` and process-compose do.
const MARKER = 'devstack-witness-line'
const QUIET_STACK = `version: "0.5"
processes:
  quiet:
    command: "sh -c 'echo ${MARKER}; sleep 120'"
    log_location: .logs/quiet.log
`

/** Brings a stack up, runs the body, and ALWAYS tears the supervisor down: a leaked
 *  `up` outlives the test run, holds its socket, and poisons the next one. */
const withStack = (dir, stack, body) => {
  assemble(dir, stack)
  const socket = evaluate(dir, 'pc_socket')
  const up = runJust(dir, 'up')
  assert.equal(up.status, 0, `just up must succeed:\n${up.out}`)
  try {
    return body({ socket })
  } finally {
    runJust(dir, 'down')
    if (socket && existsSync(socket)) rmSync(socket, { force: true })
  }
}

const pidOf = (dir, svc) => {
  const r = runJust(dir, 'ps')
  const row = r.out.split('\n').find((l) => new RegExp(`\\s${svc}\\s`).test(l))
  assert.ok(row, `no ${svc} row in just ps:\n${r.out}`)
  return row.trim().split(/\s+/)[0]
}

test('the shipped snippet is a valid process-compose config', { skip, timeout: TIMEOUT }, () => {
  withTmpRepo((dir) => {
    assemble(dir, readFileSync(join(KIT, 'process-compose.snippet.yaml'), 'utf8'))
    const r = runJust(dir, 'stack-check')
    assert.equal(r.status, 0, `the snippet we ship must pass --dry-run:\n${r.out}`)
  })
})

test('the control socket is derived per work tree', { skip }, () => {
  // Not cosmetic: this derivation IS the isolation. If two trees ever resolve to one
  // socket, the interference test below is the one that stops being true.
  withTmpRepo((a) => {
    withTmpRepo((b) => {
      assemble(a, null)
      assemble(b, null)
      const sa = evaluate(a, 'pc_socket')
      const sb = evaluate(b, 'pc_socket')
      assert.ok(sa && sb, 'pc_socket must resolve through the import')
      assert.notEqual(sa, sb, 'two trees must not share a control socket')
      assert.ok(sa.includes(basename(a)), `${sa} must be derived from the tree name`)
    })
  })
})

describe('devstack lifecycle', { concurrency: 1 }, () => {
  test('a quiet service is readable via just logs while its file is not', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((dir) => {
      withStack(dir, QUIET_STACK, () => {
        const logs = runJust(dir, 'logs', 'quiet')
        assert.equal(logs.status, 0, `just logs must succeed:\n${logs.out}`)
        assert.match(logs.out, new RegExp(MARKER), 'the supervisor must return the line immediately')

        // The claim that matters. If this ever starts containing the marker, the kit
        // may go back to tailing the file — and `rules/devstack/running.md` and the
        // `logs` recipe must be revisited together.
        const file = join(dir, '.logs', 'quiet.log')
        const onDisk = existsSync(file) ? readFileSync(file, 'utf8') : ''
        assert.ok(
          !onDisk.includes(MARKER),
          'the per-process log FILE must not be the read an agent makes mid-turn. '
            + 'It held the line already, so the buffering changed and the logs recipe '
            + `can go back to tailing the file: ${onDisk.slice(0, 200)}`,
        )
      })
      // `down` is what flushes it, which is the file's actual job: history and
      // post-mortem, never "what just happened".
      const flushed = readFileSync(join(dir, '.logs', 'quiet.log'), 'utf8')
      assert.match(flushed, new RegExp(MARKER), 'just down must flush the log file')
    })
  })

  test('restarting in one tree leaves the other tree untouched', {
    skip,
    timeout: TIMEOUT,
  }, () => {
    withTmpRepo((a) => {
      withTmpRepo((b) => {
        withStack(a, QUIET_STACK, () => {
          withStack(b, QUIET_STACK, () => {
            const beforeA = pidOf(a, 'quiet')
            const beforeB = pidOf(b, 'quiet')
            assert.notEqual(beforeA, beforeB, 'the two trees must run distinct processes')

            const r = runJust(b, 'restart', 'quiet')
            assert.equal(r.status, 0, `just restart must succeed:\n${r.out}`)

            assert.notEqual(pidOf(b, 'quiet'), beforeB, 'the restarted tree must get a new pid')
            assert.equal(
              pidOf(a, 'quiet'), beforeA,
              'restarting one tree must NOT touch the other — the per-tree socket is what buys this',
            )
          })
        })
      })
    })
  })
})
