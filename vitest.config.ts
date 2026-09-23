import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Only the code Vitest can reach. Game UIs and web/ are covered by Playwright, whose
      // Worker runs in workerd, so counting them here would only report them as untested.
      include: ["worker/**/*.ts", "shared/**/*.ts", "games/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__fixtures__/**",
        "**/*.d.ts",
        "games/icons.ts",
      ],
      // json-summary and json are what the PR coverage comment reads.
      reporter: ["text-summary", "json-summary", "json"],
      reportOnFailure: true,
    },
  },
});
