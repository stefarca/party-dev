---
plan: 02-eslint-flat-config
goal: Add Prettier + ESLint and a GitHub Actions PR workflow that runs lint, format check, and build
status: pending
depends_on: [01-prettier-baseline]
---

# ESLint flat config for TypeScript + React hooks, Prettier-compatible

## Objective

Add ESLint 10 with a flat config (`eslint.config.js`) covering the TypeScript Worker code, the
shared/game modules and the React 19 SPA, wired so it never fights Prettier
(`eslint-config-prettier` last in the chain). Add `lint` / `lint:fix` scripts and bring the
existing tree to **zero ESLint errors**. OUT of scope: any refactor of application logic to
satisfy a lint rule, type-aware linting (`recommendedTypeChecked`), the React Compiler rule set,
and the CI workflow (plan 03).

## Context

All of the following was verified by running the candidate config against the current tree.

- Single root package, `"type": "module"`, so `eslint.config.js` is ESM. Sources: `worker/`,
  `web/` (React 19, `.tsx`), `shared/`, `games/` (`games/**/ui.tsx` are React), plus
  `vite.config.ts` and `vitest.config.ts` at the root.
- Package versions to add as devDependencies (all confirmed mutually peer-compatible):
  `eslint@^10.10.0`, `@eslint/js@^10.10.0`, `typescript-eslint@^8.70.0`,
  `eslint-plugin-react-hooks@^7.1.1`, `eslint-config-prettier@^10.1.8`, `globals@^17.12.0`.
- **`@eslint/js` must be an explicit devDependency.** Verified: importing it without installing
  it fails with `ERR_MODULE_NOT_FOUND` even though ESLint depends on it internally.
- **Do not add `eslint-plugin-react`.** Its peer range caps at `eslint@^9.7`, which breaks
  install/`npm ci` against ESLint 10. `eslint-plugin-react-hooks@7` does support ESLint 10.
- `eslint-plugin-react-hooks@7` exposes flat configs at `reactHooks.configs.flat.recommended`
  (the top-level `configs.recommended` / `configs["recommended-latest"]` are legacy eslintrc
  objects and crash flat config with "plugins key defined as an array of strings"). That flat
  recommended set now includes React-Compiler-era rules which flag **7 pre-existing, deliberate**
  patterns in this SPA (`react-hooks/set-state-in-effect` in `web/routes/Dashboard.tsx`,
  `web/routes/MatchPage.tsx`, `web/session.tsx`, `web/useMatch.ts`; `react-hooks/refs` twice in
  `web/useMatch.ts` where refs are intentionally written during render;
  `react-hooks/static-components` in `web/routes/MatchPage.tsx`). Adopting those rules would
  require refactoring live transport/UI logic, which is explicitly out of scope — so register
  the plugin and enable only `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`
  (both verified clean today).
- `typescript-eslint`'s `recommended` (non-type-checked) preset is the target: it already turns
  off `no-undef` for TS files, needs no `tsconfig` wiring, and keeps CI fast. Types are already
  covered by the existing `npm run typecheck` (`tsc -b --noEmit`).
- Verified remaining violations under the candidate config, and the intended resolution for each
  (locate by symbol — plan 01's format pass shifts line numbers):
  | Rule | Site | Resolution |
  |---|---|---|
  | `@typescript-eslint/no-unused-vars` (7) | `worker/match.ts` `webSocketClose(_ws, _code, _reason, _wasClean)`; `web/useMatch.ts` `const { t: _t, ...rest }`; `games/__fixtures__/counter.ts` `onDeadline(state, _now)`; `games/__fixtures__/counter.test.ts` `for (const _p of ...)` | rule options with `^_` ignore patterns (no source edits) |
  | `@typescript-eslint/no-explicit-any` (4, on 2 lines) | `games/registry.ts`: `serverGames: Record<string, GameModule<any, any>>` and `getGame(...): GameModule<any, any> \| undefined` | one `// eslint-disable-next-line` above each of the 2 lines |
  | `no-control-regex` (2) | `shared/protocol.ts` `NO_CONTROL_CHARS` and `web/routes/NicknameGate.tsx` `NO_CONTROL_CHARS` | one `// eslint-disable-next-line` above each |
  | `no-useless-assignment` (1) | `worker/match.ts`, the defensive `derived = this.deriveWaitingAndDeadline(module, current);` re-read after await #2 | one `// eslint-disable-next-line` above it |
  | `prefer-const` (1) | `games/trivia/game.test.ts` `let bobCorrect = 0;` | `eslint --fix` (bob answers wrong every round on purpose, so it is genuinely never reassigned) |

## Steps

1. `npm install --save-dev eslint@^10.10.0 @eslint/js@^10.10.0 typescript-eslint@^8.70.0
   eslint-plugin-react-hooks@^7.1.1 eslint-config-prettier@^10.1.8 globals@^17.12.0`.
2. Create `eslint.config.js` at the repo root. This exact shape is verified to load and to
   discover `.ts`/`.tsx` files via a bare `eslint .`:

   ```js
   import js from "@eslint/js";
   import prettier from "eslint-config-prettier/flat";
   import reactHooks from "eslint-plugin-react-hooks";
   import globals from "globals";
   import tseslint from "typescript-eslint";

   export default tseslint.config(
     { ignores: ["dist/**", ".wrangler/**", "worker-configuration.d.ts", "*.tsbuildinfo"] },
     js.configs.recommended,
     tseslint.configs.recommended,
     { rules: { "@typescript-eslint/no-unused-vars": ["error", { /* ^_ patterns */ }] } },
     {
       files: ["web/**/*.{ts,tsx}", "games/**/*.tsx"],
       plugins: { "react-hooks": reactHooks },
       languageOptions: { globals: globals.browser },
       rules: {
         "react-hooks/rules-of-hooks": "error",
         "react-hooks/exhaustive-deps": "error",
       },
     },
     prettier, // must stay last
   );
   ```

   The `no-unused-vars` options must be `argsIgnorePattern: "^_"`, `varsIgnorePattern: "^_"`,
   `caughtErrorsIgnorePattern: "^_"`, `destructuredArrayIgnorePattern: "^_"`. Add a short
   comment above the `react-hooks` block recording *why* only two rules are enabled (the
   Compiler-era rules in `configs.flat.recommended` flag deliberate patterns in
   `web/useMatch.ts` et al.; adopting them is a separate, non-tooling change).
3. Add npm scripts next to `format` / `format:check`:
   - `"lint": "eslint ."`
   - `"lint:fix": "eslint . --fix"`
4. Run `npx eslint . --fix`. This should change exactly one source line
   (`let bobCorrect` → `const bobCorrect` in `games/trivia/game.test.ts`).
5. Add the five `// eslint-disable-next-line <rule> -- <reason>` comments listed in the Context
   table (2 in `games/registry.ts`, 1 in `shared/protocol.ts`, 1 in
   `web/routes/NicknameGate.tsx`, 1 in `worker/match.ts`). Each must name the specific rule and
   carry a one-clause justification after ` -- `. Match the surrounding indentation. Do not add
   file-wide `/* eslint-disable */` headers and do not turn any of these rules off globally.
6. Run `npm run format` so `eslint.config.js` itself is Prettier-clean, then confirm
   `npm run format:check` passes.

## Acceptance criteria

- [ ] The six devDependencies from step 1 are in `package.json` with `package-lock.json` updated.
- [ ] `eslint.config.js` exists, uses flat config via `tseslint.config(...)`, has
      `eslint-config-prettier` as the **last** entry, and ignores `dist/**`, `.wrangler/**`,
      `worker-configuration.d.ts`, `*.tsbuildinfo`.
- [ ] `eslint-plugin-react` is **not** added; only `rules-of-hooks` and `exhaustive-deps` are
      enabled from `eslint-plugin-react-hooks`, with a comment explaining the scope decision.
- [ ] `lint` and `lint:fix` scripts exist; existing scripts unchanged.
- [ ] `npm run lint` reports 0 errors and 0 warnings.
- [ ] The only source edits are the 5 disable comments plus the one `let` → `const` in
      `games/trivia/game.test.ts`. No function body, type, or control flow was changed.
- [ ] No type-aware ESLint config (`recommendedTypeChecked`, `parserOptions.project`,
      `projectService`) was introduced.

## Verification

```
npm run lint           # 0 problems
npm run format:check   # clean (covers the new eslint.config.js)
npm run typecheck      # tsc -b --noEmit, no output
npm run test           # vitest run, all suites pass (catches the let->const fix)
npm run build          # vite build succeeds
```

## Risks / notes

- Plan 01's format pass moved line numbers; always find the edit sites by the symbol names given
  in the Context table.
- If ESLint reports violations beyond the 8 enumerated ones, do **not** silence them with new
  broad rule overrides and do not refactor application code. Resolve narrowly (targeted
  disable comment with a reason) and note it in the commit message.
- `eslint-config-prettier/flat` is the flat-config entry point (verified to exist in
  `eslint-config-prettier@10`); the bare `eslint-config-prettier` import is the legacy shape.
- Keep `eslint.config.js` as `.js`, not `.ts`: the `tsc -b` project references
  (`tsconfig.node.json` covers only `vite.config.ts` and `vitest.config.ts`) would otherwise
  need editing, which is outside this plan.
