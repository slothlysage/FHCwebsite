/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The thresholds below are a GATE, not a target.
// AGENT.md forbids lowering them or adding exclusions to inflate the numbers.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/layout.tsx",
        "src/lib/db/migrations/**",
        "**/*.config.*",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 80,
        functions: 80,
        "src/lib/services/**": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/stripe/**": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
        "src/lib/auth/**": {
          lines: 90,
          statements: 90,
          branches: 90,
          functions: 90,
        },
      },
    },
  },
});
