// Argon2id password hashing (specs/04-admin.md: `memoryCost >= 19456`,
// `timeCost >= 2`). Uses `hash-wasm`, a pure-WebAssembly implementation,
// rather than the native `argon2`/`@node-rs/argon2` packages — this app
// deploys to Cloudflare Workers via @opennextjs/cloudflare
// (specs/01-stack-and-hosting.md), which cannot load native N-API addons.
// WASM runs unmodified there.
import { randomBytes, timingSafeEqual } from "node:crypto";

import { argon2id } from "hash-wasm";

const MEMORY_SIZE_KIB = 19456;
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

// hash-wasm's own "encoded" (PHC-string) format:
// $argon2id$v=19$m=<mem>,t=<iter>,p=<par>$<saltB64>$<hashB64>
const ENCODED_HASH_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  return argon2id({
    password,
    salt,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    memorySize: MEMORY_SIZE_KIB,
    hashLength: HASH_LENGTH,
    outputType: "encoded",
  });
}

// Re-derives the hash from the password + the salt/params embedded in
// `encodedHash`, then compares digest bytes with `crypto.timingSafeEqual`
// (specs/04-admin.md's "timing-safe comparison") rather than trusting
// hash-wasm's own `argon2Verify`, which compares the encoded strings with
// plain `===` — not constant-time.
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (!password) {
    return false;
  }
  const match = ENCODED_HASH_PATTERN.exec(encodedHash);
  if (!match) {
    return false;
  }
  const [, memorySize, iterations, parallelism, saltB64, hashB64] = match;
  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(hashB64!, "base64");

  // hashLength is pinned to expected.length, so computed and expected are
  // always equal-length — timingSafeEqual would throw on a mismatch, but
  // one can't occur here.
  const computed = await argon2id({
    password,
    salt,
    iterations: Number(iterations),
    parallelism: Number(parallelism),
    memorySize: Number(memorySize),
    hashLength: expected.length,
    outputType: "binary",
  });

  return timingSafeEqual(computed, expected);
}
