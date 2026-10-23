import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.test.js", "client/src/**/*.test.jsx"],
    testTimeout: 15_000,
    hookTimeout: 120_000,
  },
});
