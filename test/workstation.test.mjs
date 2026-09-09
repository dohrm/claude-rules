// The workstation jalon. Unit-level on purpose: `bench start` spawns zellij and
// needs a pty, so the black-box tests in cli.test.mjs never exercised the one code
// path that launches anything — and that is exactly where the bug was.
//
// It shipped building `zellij --session <name> --layout <l>` to create a session.
// Per zellij's own help, `--layout` "if inside a session (or using the --session
// flag) will be added to the session as a new tab", so with a name that does not
// exist yet it fails with "There is no active session!" and NO session is ever
// created. `bench start` was therefore broken for its primary case — a fresh bench
// — while every existing test stayed green.
//
// The fix moved that decision into a pure function. These assertions are the
// witness: no pty, no zellij, no toolchain, so they run in the plain `test` job.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { launchArgv, sessionState } from '../workstation/lib.mjs'

const zj = (live = [], known = live) => ({ live: new Set(live), known: new Set(known) })

describe('launchArgv', () => {
  test('creates with --new-session-with-layout, never with --layout', () => {
    const argv = launchArgv('billing', 'bench', zj())
    assert.deepEqual(argv, ['--session', 'billing', '--new-session-with-layout', 'bench'])
    // THE regression. `--layout` alongside `--session` means "add a tab to that
    // session", so it cannot create one: it exits with "There is no active session!".
    assert.ok(!argv.includes('--layout'), '--layout cannot create a session')
  })

  test('attaches when the name is live', () => {
    assert.deepEqual(launchArgv('billing', 'bench', zj(['billing'])), ['attach', 'billing'])
  })

  test('attaches when the name is EXITED — that resurrects it', () => {
    // known but not live: zellij still owns the name, and `--session` would refuse it.
    assert.deepEqual(launchArgv('billing', 'bench', zj([], ['billing'])), ['attach', 'billing'])
  })

  test('creates when zellij could not be read at all', () => {
    // sessions() === null. Trying and failing loudly beats refusing to try.
    assert.deepEqual(launchArgv('billing', 'bench', null), ['--session', 'billing', '--new-session-with-layout', 'bench'])
  })

  test('honours a custom layout', () => {
    assert.deepEqual(launchArgv('b', 'default', zj()), ['--session', 'b', '--new-session-with-layout', 'default'])
  })
})

describe('sessionState', () => {
  // `dormant` and `exited` are not the same thing, and conflating them is what made
  // `fleet` print `zellij attach <name>` for a bench that never had a session —
  // sending the reader to "No session with the name ... found!".
  test('live, exited and dormant are three distinct answers', () => {
    assert.equal(sessionState('b', zj(['b'])), 'live')
    assert.equal(sessionState('b', zj([], ['b'])), 'exited')
    assert.equal(sessionState('b', zj()), 'dormant')
  })

  test('an unreadable zellij is not "dormant"', () => {
    // Reporting `dormant` here would claim the session does not exist, which is a
    // fact we do not have.
    assert.equal(sessionState('b', null), 'no zellij')
  })

  test('an empty session list is dormant, not unreadable', () => {
    // `zellij list-sessions` EXITS 1 when there are no sessions. sessions() must
    // turn that into empty sets, not into null, or every bench reads "no zellij".
    assert.equal(sessionState('b', zj([], [])), 'dormant')
  })
})
