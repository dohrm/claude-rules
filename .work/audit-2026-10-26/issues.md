## #50 kit: vulnerability audits block *-check on advisories the diff never touched — move them to a scheduled job that opens an issue

## Summary

The kit puts every vulnerability audit inside the blocking `*-check` recipe: `govulncheck` in `go-check`, `pip-audit` in `python-check`, `cargo deny check … advisories …` in `rust-check`. These checks look at an advisory database that moves on its own schedule, not at the diff. A PR that touches only docs goes red the day a CVE is published against a dependency it never touched, and `main` turns red with no commit. That makes the gate non-hermetic: its verdict changes without a change to the code. That is the drift the ratchet doctrine exists to prevent.

## Where (`next`)

- `kit/go/go.just:26` — `go-check` runs `govulncheck ./...`
- `kit/python/python.just:33` — `python-check` runs `uv run --locked pip-audit`
- `kit/rust/rust.just:41` — `rust-check` runs `cargo deny check licenses advisories sources`

## Observed downstream

On one consuming repo, over two days and one feature (4 PRs), `just check` and CI went red **three times** on advisories unrelated to any diff. All three were already red on the base branch:

- `pip-audit`: aiohttp (3 advisories), then certifi and pillow (8 CVEs, fixed only in a major version), all transitive;
- `govulncheck`: a Go **standard library** advisory (`crypto/x509`). The fix is a toolchain bump on the CI runner. Nothing in the repository's diff can make that job green.

Each time the PR was blocked until someone did an unrelated dependency chore. In the stdlib case the PR stayed blocked until a change outside the repo.

The same repo had already overridden `rust-check` to move `advisories` out of the gate into a non-gating `rust-advisories` recipe. As a result, the three languages follow two different policies, and that override has to survive every kit update.

## Proposal

1. **Split the audit out of `*-check`** into `go-audit`, `python-audit` and `rust-audit`. `*-check` then covers lint, types, tests, licenses and sources, which are all things the diff controls.
2. **Keep the gate on what the diff introduces.** `*-check` runs the language's audit only when its lock file changes in the diff (`go.sum`, `uv.lock`, `Cargo.lock`, against the gate's base). Whoever touches dependencies settles the advisories, which matches "an upgrade retires its debt".
3. **Add a scheduled snippet**, `kit/cicd/audit.snippet.yaml`, next to `ci.snippet.yaml`:
   - it runs daily on the default branch and calls the `*-audit` recipes;
   - on failure it opens or updates one issue per tool, deduplicated by a label (e.g. `security-advisory`) and title, with the findings;
   - it closes the issue when the tool is green again;
   - forge access goes through the forge CLI or API, as `/ci-setup` already does.
4. **Doctrine, one line** in `testing/ratchet.md` or `cicd/pipeline.md`: a check whose verdict depends on time rather than on the diff does not block a PR; it runs on a schedule and opens an issue.
5. **Name the toolchain case.** A Go stdlib advisory is fixed by the toolchain version, often pinned outside the repo (runner image, setup action). The issue body should say so, so nobody hunts for a `go.mod` fix that doesn't exist.

## Trade-off

A PR that adds a vulnerable dependency still fails (point 2). Only the advisories published after the dependency was locked move off the PR path, and the scheduled job reports them within a day. A weekly cadence would be cheaper, but a week is long for a CVE, and the job takes seconds.


## #49 kit eslint.react.js: react-hooks v7 needs configs.flat, jsx-a11y blocks eslint 10

## What happens

Copying `kit/ts-tauri/eslint.react.js` (same as `kit/ts-web/eslint.react.js`) into a new app with current packages fails right away:

```
A config object has a "plugins" key defined as an array of strings.
Flat config requires "plugins" to be an object
```

## Cause

- `eslint-plugin-react-hooks` v7 changed its exports. `configs['recommended-latest']` is now the **legacy** config (its `plugins` is an array). The flat config moved to `configs.flat['recommended-latest']`.
- `eslint-plugin-jsx-a11y@6.10.2` declares the peer dependency `eslint@^3 … ^9`. With `eslint@10` (the default for `npm i eslint`), npm stops with ERESOLVE.

## Fix applied in a consuming repo

```js
reactHooks.configs.flat['recommended-latest'],
```

and pin `eslint@9` + `@eslint/js@9` until jsx-a11y supports 10.

## Suggestion

- Update both `eslint.react.js` copies (ts-web, ts-tauri) to `configs.flat[...]`.
- Add the `eslint@9` pin to the Requirements section of the ts-web and ts-tauri READMEs until jsx-a11y ships eslint 10 support.

Versions: eslint-plugin-react-hooks 7.1.1, eslint-plugin-jsx-a11y 6.10.2, eslint 9.39.5 / 10.13.0, kit ref `next`.

## #48 remove <stack> leaves the stack's overlays in other profiles (hexagonal/go.md)

## Bug

`claude-rules remove go` leaves the Go overlay of another profile behind: `.claude/rules/hexagonal/go.md` (and `.agents/rules/hexagonal/go.md`). They stay on disk and in `.claude-rules.lock` under the `hexagonal` source entry, so the Go hexagonal layout rule keeps loading in a repo that has no Go left.

## Repro

1. A repo installed with profiles `hexagonal` + `go` (+ `rust`), lock on `next`.
2. `npx github:dohrm/claude-rules#next remove go`.
3. `rules/go/*` are removed; `.claude/rules/hexagonal/go.md` and `.agents/rules/hexagonal/go.md` remain, still listed in the lock's `hexagonal` files map.

## Expected

Removing a stack profile also removes the stack-specific overlays it contributed to other profiles (`<profile>/go.md`), and their lock entries.

## Notes

- `claude-rules update` removes them, but it also re-pins `core` and rewrites ~60 kit and skill files, so it is not a usable workaround.
- Seen in horwedge hwe-automation (Go → Rust rewrite); removed by hand there.

Related: #43.


## #43 kit: mutation-ci / coverage-ci fetch the PR base with --depth=1 → "no merge base" once the base moves

## Summary

`kit/rust/mutation-ci.yaml` and `kit/go/coverage-ci.yaml` check out with `fetch-depth: 0`, then fetch the PR base with `--depth=1`. This shallow fetch cuts the base branch's history at its tip. Once the base has moved since the PR branch was cut, `origin/<base>...HEAD` has no merge base, and the Tier 4 job fails before the tool runs.

## Where

- `kit/rust/mutation-ci.yaml:77-79` (at `f5d3b9f`, `next`)
- `kit/go/coverage-ci.yaml:61-62`

```yaml
git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"
git diff "origin/${{ github.base_ref }}...HEAD" --relative -- . > pr.diff
```

## Observed

The repository runs on Gitea Actions (Gitea 1.26.4, act runner). The PR targets an integration branch that gained two commits after the phase branch was cut:

```
git fetch --no-tags --depth=1 origin "rfc/rust-rewrite"
 * branch            rfc/rust-rewrite -> FETCH_HEAD
fatal: origin/rfc/rust-rewrite...HEAD: no merge base
##[error]Process completed with exit code 128.
```

Because the job fails before `cargo mutants` runs, `continue-on-error: true` (calibration) is the only thing that keeps the PR mergeable. The gate is silently absent.

## Repro

1. Copy `mutation-ci.yaml` into a repo.
2. Open a PR from a branch cut at base commit `A`.
3. Push one more commit to the base branch.
4. Push a commit to the PR branch. The diff step fails with `no merge base`.

## Fix used downstream

Fetch the base in full into its remote-tracking ref. Pass `base_ref` through `env:` rather than interpolating it into the script:

```yaml
      - name: Compute PR diff
        env:
          BASE: ${{ github.base_ref }}
        run: |
          git fetch --no-tags origin "+refs/heads/$BASE:refs/remotes/origin/$BASE"
          git diff "origin/$BASE...HEAD" --relative -- . > pr.diff
          echo "Changed hunks:"; git --no-pager diff --stat "origin/$BASE...HEAD" -- .
```

Checkout keeps `fetch-depth: 0`. The same change applies to `coverage-ci.yaml`.

The `env:` indirection also stops `${{ github.base_ref }}` from being pasted into the shell. A branch name is attacker-influenced in fork PRs, so passing it as a variable is the standard hardening.

## Note

The repo copy now diverges from the kit. Every repo that copied these snippets has the same latent failure, and it shows up only once the base branch moves.


