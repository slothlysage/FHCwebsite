import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("hashes a password into a self-describing argon2id string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    );
  });

  it("hashes the same password to a different string each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("verifies the correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(
      verifyPassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects a malformed/foreign hash string instead of throwing", async () => {
    await expect(
      verifyPassword("anything", "not-an-argon2-hash"),
    ).resolves.toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });
});
