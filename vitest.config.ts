import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Executions spawn real subprocesses and touch SQLite; keep the suite serial
    // and single-forked so temp dirs and DB files don't collide.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
