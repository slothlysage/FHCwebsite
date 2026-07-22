import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

describe("pre-commit hook", () => {
  it(".husky/pre-commit runs lint-staged, not the full test suite", () => {
    const hook = readFileSync(path.join(repoRoot, ".husky/pre-commit"), "utf8");

    expect(hook).toMatch(/lint-staged/);
  });

  it(".husky/pre-commit is executable", () => {
    const mode = statSync(path.join(repoRoot, ".husky/pre-commit")).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it("package.json declares a lint-staged config scoped to lint + format", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { "lint-staged"?: Record<string, string | string[]> };

    expect(pkg["lint-staged"]).toBeDefined();

    const config = pkg["lint-staged"]!;
    const entries = Object.values(config).flat();

    expect(entries.some((cmd) => cmd.includes("eslint"))).toBe(true);
    expect(entries.some((cmd) => cmd.includes("prettier"))).toBe(true);
  });

  it("package.json prepare script installs husky hooks", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts.prepare).toBe("husky");
  });
});
