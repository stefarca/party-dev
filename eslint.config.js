import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
      "*.tsbuildinfo",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // The service worker's own source (public/push-sw.js) is served verbatim, never bundled, so it
  // is plain browser JavaScript running in a worker global scope rather than a window.
  {
    files: ["public/*.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  // eslint-plugin-react-hooks@7's flat recommended config pulls in React-Compiler-era rules
  // (set-state-in-effect, refs, static-components) that flag deliberate patterns in
  // web/useMatch.ts and friends. Refactoring those is a separate, non-tooling change, so only
  // the two stable rules are enabled here.
  {
    files: ["web/**/*.{ts,tsx}", "games/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  prettier, // must stay last
);
