import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

describe("CI workflow references only real npm scripts", () => {
  it("every `npm run <script>` in ci.yml exists in package.json", () => {
    const ciYml = readFileSync(
      path.join(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    const referenced = [...ciYml.matchAll(/npm run ([\w:-]+)/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);

    expect(referenced.length).toBeGreaterThan(0);

    const missing = referenced.filter((name) => !(name in pkg.scripts));
    expect(missing).toEqual([]);
  });
});
