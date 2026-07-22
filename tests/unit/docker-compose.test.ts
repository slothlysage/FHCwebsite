import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

function parseDatabaseUrl(url: string) {
  const match = /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/.exec(
    url,
  );
  if (!match) {
    throw new Error(`Could not parse DATABASE_URL: ${url}`);
  }
  const [, user, password, host, port, database] = match;
  return { user, password, host, port, database };
}

describe("local dev database (docker-compose)", () => {
  it("docker-compose.yml exists and defines a postgres:16 service matching .env.example's DATABASE_URL", () => {
    const composePath = path.join(repoRoot, "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);

    const compose = readFileSync(composePath, "utf8");
    const envExample = readFileSync(
      path.join(repoRoot, ".env.example"),
      "utf8",
    );
    const dbUrlLine = envExample
      .split("\n")
      .find((line) => line.startsWith("DATABASE_URL="));
    expect(dbUrlLine).toBeDefined();
    const { user, password, database } = parseDatabaseUrl(
      dbUrlLine!.slice("DATABASE_URL=".length),
    );

    expect(compose).toMatch(/image:\s*postgres:16/);
    expect(compose).toMatch(/["']?5432:5432["']?/);
    expect(compose).toMatch(new RegExp(`POSTGRES_USER:\\s*["']?${user}`));
    expect(compose).toMatch(
      new RegExp(`POSTGRES_PASSWORD:\\s*["']?${password}`),
    );
    expect(compose).toMatch(new RegExp(`POSTGRES_DB:\\s*["']?${database}`));
  });

  it("package.json has a db:reset script pointing at a script that exists", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["db:reset"]).toBeDefined();

    const match = /node\s+(\S+\.mjs)/.exec(pkg.scripts["db:reset"]!);
    expect(match).not.toBeNull();
    const scriptPath = path.join(repoRoot, match![1]!);
    expect(existsSync(scriptPath)).toBe(true);
  });
});
