// Finished work leaves nothing behind (#57): `landed.mjs` recognises a squash merge,
// `tree-rm` removes a squash-merged tree with its local and remote branch, and
// `work-stale.mjs` finds what `.work/` still holds for work that is over.
// Real git repositories, because the failure is git's: a squash is never an ancestor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO, withTmpRepo } from './helpers.mjs'

const KIT = join(REPO, 'kit', 'common')
const JUST = spawnSync('just', ['--version'])

const sh = (cwd, cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const git = (cwd, ...args) => sh(cwd, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args)
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text) }
const commit = (dir, rel, text, msg = rel) => { write(dir, rel, text); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg) }
const landed = (dir, branch, base) => spawnSync(process.execPath, [join(KIT, 'landed.mjs'), branch, base], { cwd: dir }).status

/** main with a CHANGELOG, and `work` branched from it with two commits. */
function repo(dir) {
  git(dir, 'init', '-q', '-b', 'main', '.')
  commit(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\nold\n')
  git(dir, 'checkout', '-q', '-b', 'work')
  commit(dir, 'a.txt', 'a\n')
  commit(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\nwork entry\n\nold\n')
  git(dir, 'checkout', '-q', 'main')
}
/** A squash merge of `work` onto main, with main having moved on first and after. */
function squash(dir) {
  commit(dir, 'b.txt', 'b\n')
  git(dir, 'merge', '-q', '--squash', 'work'); git(dir, 'commit', '-qm', 'work (#1)')
  // A later PR adds the next entry right above it — what defeats path identity and merge-tree.
  commit(dir, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n\nnext entry\n\nwork entry\n\nold\n')
}

test('landed: an ancestor, and a multi-commit squash with base moved on, have landed', () => {
  withTmpRepo((dir) => {
    repo(dir)
    assert.equal(landed(dir, 'work', 'main'), 1, 'not merged yet')
    squash(dir)
    assert.equal(landed(dir, 'work', 'main'), 0, 'a squash is recognised by its patch-id')
    git(dir, 'checkout', '-q', '-b', 'ff', 'main')
    assert.equal(landed(dir, 'ff', 'main'), 0, 'an ancestor')
    assert.equal(landed(dir, 'nope', 'main'), 2, 'an unknown ref is unresolvable, not "not landed"')
  })
})

test('landed: a squash edited when merged is not proven, so not landed', () => {
  withTmpRepo((dir) => {
    repo(dir)
    git(dir, 'merge', '-q', '--squash', 'work')
    write(dir, 'a.txt', 'a, edited in the merge\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'work, edited')
    assert.equal(landed(dir, 'work', 'main'), 1)
  })
})

test('tree-rm: a squash-merged tree goes with its local and remote branch; a remote ahead stays',
  { skip: JUST.error ? 'just not installed' : false }, () => {
    withTmpRepo((dir) => {
      const origin = join(dir, 'origin.git'), work = join(dir, 'repo')
      sh(dir, 'git', 'init', '-q', '--bare', '-b', 'main', origin)
      mkdirSync(work); git(work, 'init', '-q', '-b', 'main', '.')
      commit(work, 'seed.txt', 'x\n')
      git(work, 'remote', 'add', 'origin', origin); git(work, 'push', '-q', '-u', 'origin', 'main')
      for (const f of ['gate.just', 'landed.mjs']) write(work, `.dev/kit/common/${f}`, readFileSync(join(KIT, f), 'utf8'))
      write(work, 'justfile', 'set allow-duplicate-recipes := true\nset allow-duplicate-variables := true\n'
        + "import '.dev/kit/common/gate.just'\nbase := \"main\"\n")
      write(work, '.gitignore', '.dev/\njustfile\n'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'ignore')
      const just = (...a) => spawnSync('just', a, { cwd: work, encoding: 'utf8', env: { ...process.env, CR_WORKTREES: join(dir, 'trees') } })

      const tree = (slug) => {
        const path = just('tree', slug, `phase/${slug}/1`).stdout.trim()
        commit(path, `${slug}-1.txt`, '1\n'); commit(path, `${slug}-2.txt`, '2\n')
        git(path, 'push', '-q', '-u', 'origin', `phase/${slug}/1`)
        git(work, 'merge', '-q', '--squash', `phase/${slug}/1`); git(work, 'commit', '-qm', `${slug} (#1)`)
        return path
      }
      const remoteHas = (b) => spawnSync('git', ['ls-remote', '--exit-code', '--heads', origin, b]).status === 0

      const a = tree('a')
      const gone = just('tree-rm', 'a')
      assert.equal(gone.status, 0, gone.stderr)
      assert.ok(!existsSync(a), 'the tree is gone')
      assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'phase/a/1'], { cwd: work }).status, 1, 'the local branch too')
      assert.ok(!remoteHas('phase/a/1'), 'and the remote branch, which held exactly the local tip')

      // Someone pushed to the remote branch after this tree's tip: the remote branch is theirs.
      const b = tree('b')
      const other = join(dir, 'other')
      sh(dir, 'git', 'clone', '-q', '-b', 'phase/b/1', origin, other)
      commit(other, 'late.txt', 'late\n'); git(other, 'push', '-q')
      const kept = just('tree-rm', 'b')
      assert.equal(kept.status, 0, kept.stderr)
      assert.ok(!existsSync(b))
      assert.match(kept.stderr, /holds commits this tree never had/)
      assert.ok(remoteHas('phase/b/1'), 'a commit pushed from elsewhere is never discarded')

      // The remote is behind the landed tip (a last commit never pushed): nothing there
      // that has not landed, so it goes.
      const c = just('tree', 'c', 'phase/c/1').stdout.trim()
      commit(c, 'c-1.txt', '1\n'); git(c, 'push', '-q', '-u', 'origin', 'phase/c/1'); commit(c, 'c-2.txt', '2\n')
      git(work, 'merge', '-q', '--squash', 'phase/c/1'); git(work, 'commit', '-qm', 'c (#3)')
      assert.equal(just('tree-rm', 'c').status, 0)
      assert.ok(!remoteHas('phase/c/1'), 'a remote behind the landed tip holds nothing of its own')

      // A branch cut from the remote trunk tracks the trunk: `main` is never this tree's to delete.
      git(work, 'push', '-q', 'origin', 'main')
      git(work, 'fetch', '-q', 'origin')
      git(work, 'branch', '--track', 'fix/d', 'origin/main')
      assert.equal(just('tree', 'd', 'fix/d').status, 0)
      const d = just('tree-rm', 'd')
      assert.equal(d.status, 0, d.stderr)
      assert.ok(remoteHas('main'), 'the remote trunk survives a tree-rm of a branch that tracks it')

      // The remote refuses the delete (a hook, a protection): said, never an error — the
      // tree and the local branch are already gone by then.
      const e = tree('e')
      write(origin, 'hooks/pre-receive', '#!/bin/sh\necho protected >&2\nexit 1\n')
      sh(dir, 'chmod', '+x', join(origin, 'hooks/pre-receive'))
      const refused = just('tree-rm', 'e')
      assert.equal(refused.status, 0, refused.stderr)
      assert.ok(!existsSync(e))
      assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'phase/e/1'], { cwd: work }).status, 1)
      assert.match(refused.stderr, /could not delete origin\/phase\/e\/1/)
      assert.ok(remoteHas('phase/e/1'))
    })
  })

test('work-stale: marker-only directories of no branch are pruned, everything else is kept', () => {
  withTmpRepo((dir) => {
    repo(dir)
    git(dir, 'checkout', '-q', '-b', 'phase/l4/2')
    git(dir, 'checkout', '-q', 'main')
    write(dir, '.work/gone-branch/.latest_review', 'sha\n')
    write(dir, '.work/gone-branch/review-context.md', 'ctx\n')
    write(dir, '.work/work/.latest_review', 'sha\n') //           the live branch `work`
    write(dir, '.work/l4/.latest_review', 'sha\n') //             the live phase branch `phase/l4/2`
    write(dir, '.work/notes/mine.md', 'mine\n') //                not a gate file
    write(dir, '.work/draft/rfc.md', '# RFC\n\n- **Status**: draft\n- **Branch**: — set at implementation\n')
    write(dir, '.work/old/rfc.md', '# RFC\n\n- **Status**: implementing\n- **Branch**: feat/old\n')
    write(dir, '.work/merged/defect.md', '# Bug\n\n- **Status**: done\n- **Branch**: work\n')
    write(dir, '.work/hy/rfc.md', '# RFC\n\n- **Status**: in-progress\n- **Branch**: feat/hy\n')
    write(dir, '.work/nostatus/rfc.md', '# RFC\n\n- **Branch**: feat/nostatus\n')
    squash(dir)

    const r = spawnSync(process.execPath, [join(KIT, 'work-stale.mjs'), '--prune', 'main'], { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!existsSync(join(dir, '.work/gone-branch')), 'markers of no branch are pruned')
    for (const kept of ['work', 'l4', 'notes', 'draft', 'old', 'merged'])
      assert.ok(existsSync(join(dir, '.work', kept)), `.work/${kept}/ is kept`)
    assert.match(r.stdout, /\.work\/old\/rfc\.md {2}\(feat\/old: branch gone\) — still implementing: delete it in a commit once the work is over/,
      'not `done`: a multi-phase RFC sits on base between its phases, so the reader judges')
    assert.match(r.stdout, /\.work\/merged\/defect\.md {2}\(work: landed on main\) — delete it in a commit$/m)
    assert.doesNotMatch(r.stdout, /draft/, 'an RFC not started has no branch to be stale against')
    assert.match(r.stdout, /\.work\/hy\/rfc\.md .* — still in-progress: /, 'a hyphenated status is read whole')
    assert.match(r.stdout, /\.work\/nostatus\/rfc\.md .* — status unknown: /)
  })
})

test('worktree-status: stale work is reported, and nothing is removed', () => {
  withTmpRepo((dir) => {
    repo(dir)
    write(dir, '.work/gone-branch/.latest_review', 'sha\n')
    write(dir, '.work/old/rfc.md', '# RFC\n\n- **Status**: implementing\n- **Branch**: feat/old\n')
    const r = spawnSync(process.execPath, [join(KIT, 'worktree-status.mjs'), 'main'], { cwd: dir, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /stale: \.work\/gone-branch\/ — gate markers only, `just work-prune`/)
    assert.match(r.stdout, /stale: \.work\/old\/rfc\.md — feat\/old: branch gone, still implementing: /)
    assert.ok(existsSync(join(dir, '.work/gone-branch/.latest_review')), 'status is read-only')
  })
})

test('work-stale: an RFC directory whose rfc.md its own PR deleted stays until that branch lands', () => {
  withTmpRepo((dir) => {
    repo(dir)
    git(dir, 'checkout', '-q', '-b', 'feat/57-x')
    commit(dir, 'x.txt', 'x\n')
    const reviewed = git(dir, 'rev-parse', 'HEAD')
    write(dir, '.work/57-x/.latest_review', `${reviewed}\n`) // the slug is no branch's name
    git(dir, 'checkout', '-q', 'main')
    const stale = () => spawnSync(process.execPath, [join(KIT, 'work-stale.mjs'), 'main'], { cwd: dir, encoding: 'utf8' }).stdout
    assert.doesNotMatch(stale(), /57-x/, 'its branch has not landed: the review marker is still in use')
    git(dir, 'merge', '-q', '--squash', 'feat/57-x'); git(dir, 'commit', '-qm', 'x (#57)')
    assert.match(stale(), /\.work\/57-x\//, 'landed: the markers are leftovers')
  })
})

test('work-stale: a state file whose branch exists only on the remote is judged on it', () => {
  withTmpRepo((dir) => {
    repo(dir)
    // A fresh clone: `work` is only `origin/work`.
    git(dir, 'update-ref', 'refs/remotes/origin/work', 'work'); git(dir, 'branch', '-D', 'work')
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/work')
    write(dir, '.work/w/defect.md', '# Bug\n\n- **Status**: done\n- **Branch**: work\n')
    write(dir, '.work/o/defect.md', '# Bug\n\n- **Status**: done\n- **Branch**: origin\n')
    const stale = () => spawnSync(process.execPath, [join(KIT, 'work-stale.mjs'), 'main'], { cwd: dir, encoding: 'utf8' }).stdout
    assert.doesNotMatch(stale(), /\.work\/w\//, 'origin/work has not landed')
    assert.match(stale(), /\.work\/o\/defect\.md {2}\(origin: branch gone\)/, '`origin/HEAD` is no branch named `origin`')
    git(dir, 'merge', '-q', '--squash', 'origin/work'); git(dir, 'commit', '-qm', 'work (#1)')
    assert.match(stale(), /\.work\/w\/defect\.md {2}\(work: landed on main\)/)
  })
})
