---
plan: 03-pr-checks-workflow
goal: Add Prettier + ESLint and a GitHub Actions PR workflow that runs lint, format check, and build
status: pending
depends_on: [01-prettier-baseline, 02-eslint-flat-config]
---

# GitHub Actions workflow: lint, format check and build on every PR

## Objective

Add a single GitHub Actions workflow that runs on `pull_request` and executes ESLint, the
Prettier check, typecheck, the vitest suite, and the project build as distinct, individually
identifiable steps, failing the PR check if any of them fails. Also document the commands in the
README. OUT of scope: deploy/release automation, branch-protection settings, caching beyond
`setup-node`'s built-in npm cache, and any change to source or config files other than the ones
named below.

## Context

- No `.github/` directory exists yet; this is the repo's first workflow.
- Scripts available after plans 01 and 02: `lint` (`eslint .`), `format:check`
  (`prettier --check .`), `build` (`vite build`), plus the pre-existing `typecheck`
  (`tsc -b --noEmit`) and `test` (`vitest run`). CI runs all five.
- `package-lock.json` is present and `lockfileVersion: 3`, so `npm ci` is the correct install
  command.
- Node version: dev uses Node 26, but all toolchain engine ranges are satisfied by Node 24
  (`vite@8`: `^20.19.0 || >=22.12.0`; `wrangler@4`: `>=22.0.0`; `vitest@5`:
  `^22.12.0 || ^24.0.0 || >=26.0.0`). Pin the workflow to Node 24 (LTS).
- Latest action majors (verified against the GitHub API): `actions/checkout@v7`,
  `actions/setup-node@v7`. Use those majors.
- `package.json` carries a non-standard `"allowScripts"` field allowlisting `workerd` and
  `esbuild` postinstall scripts. `npm ci` must be allowed to run them (do **not** add
  `--ignore-scripts`), because `@cloudflare/vite-plugin` / `wrangler` expect the `workerd`
  binary to be installed.
- Prettier formats YAML, and `format:check` runs over the whole repo — so the new workflow file
  is itself subject to the check it runs. It must be Prettier-formatted.
- README structure: `# party-dev`, `## Prerequisites`, `## Local development` (which already
  lists `npm run typecheck` as a bullet around line 41), `## Engine`, `## Deploying`.

## Steps

1. Create `.github/workflows/ci.yml` with:
   - `name: CI`
   - `on: pull_request` (no branch filter, so the checks run on PRs into any branch).
   - `permissions: contents: read` at the top level (least privilege).
   - a `concurrency` block keyed on the workflow + ref with `cancel-in-progress: true`, so
     force-pushes to a PR don't leave stale runs.
   - one job, `checks`, on `runs-on: ubuntu-latest`, with steps in this order:
     1. `actions/checkout@v7`
     2. `actions/setup-node@v7` with `node-version: 24` and `cache: npm`
     3. `run: npm ci`
     4. `name: Lint` / `run: npm run lint`
     5. `name: Format check` / `run: npm run format:check`
     6. `name: Typecheck` / `run: npm run typecheck`
     7. `name: Test` / `run: npm run test`
     8. `name: Build` / `run: npm run build`
   Keep steps 4-8 as separate named steps (not one combined `run`) so the failing check is
   obvious in the PR UI. Do not add `continue-on-error` anywhere — any failing step must fail
   the job and therefore the PR check.
2. Add a short subsection to `README.md` under `## Local development`, right after the existing
   `npm run typecheck` bullet: list `npm run lint`, `npm run format`, `npm run format:check`
   with one-line descriptions, and state that `.github/workflows/ci.yml` runs `lint`,
   `format:check`, `typecheck`, `test` and `build` on every pull request. Keep it to a few lines;
   do not restructure the README.
3. Run `npm run format` (the new YAML and the README edit must be Prettier-clean), then
   `npm run format:check` to confirm.

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` exists, triggers on `pull_request`, and declares
      `permissions: contents: read` plus a `concurrency` block with `cancel-in-progress: true`.
- [ ] The job installs with `npm ci` (no `--ignore-scripts`) after `actions/setup-node@v7` with
      `node-version: 24` and `cache: npm`, using `actions/checkout@v7`.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test` and
      `npm run build` each run as their own named step, in that order, with no
      `continue-on-error`.
- [ ] `README.md` documents the `lint` / `format` / `format:check` scripts and says CI enforces
      lint, format check, typecheck, test and build on PRs.
- [ ] `npm run format:check` passes, i.e. the workflow file and README edit are Prettier-clean.
- [ ] No other file is modified by this plan (no new deps, no script changes).

## Verification

```
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
npm run format:check   # clean
npm run lint           # 0 problems
npm run typecheck      # tsc -b --noEmit, no output
npm run test           # vitest run, all suites pass
npm run build          # vite build succeeds
```

Then reproduce the CI sequence exactly as the runner would, from a clean install, to prove the
workflow's commands are the right ones:

```
npm ci && npm run lint && npm run format:check && npm run typecheck && npm run test && npm run build
```

All six must succeed. (`npm ci` deletes and reinstalls `node_modules`; that is expected.)

## Risks / notes

- The workflow only makes checks *available*; making them required to merge is a
  branch-protection setting in the GitHub repo UI and is not something this plan changes.
- If `npm ci` fails in CI on a peer-dependency conflict, the cause is almost certainly an ESLint
  plugin peer range (see plan 02's note about `eslint-plugin-react`) — fix the dependency, not
  the workflow, and never paper over it with `--legacy-peer-deps` or `--force`.
