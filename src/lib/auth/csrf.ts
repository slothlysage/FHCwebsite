// Double-submit CSRF token comparison (specs/04-admin.md's Auth section,
// task 4.1c). Token generation + the cookie/field name constants live in
// csrf-token.ts, which src/proxy.ts also imports — see that file's
// header comment for why the two are split (node:crypto here is fine for
// this module's own consumers, Server Actions running in the Node/Workers
// runtime, but not safe to pull into proxy.ts's Edge Runtime bundle).
import { timingSafeEqual } from "node:crypto";

// Constant-time comparison. A raw `timingSafeEqual` throws on mismatched
// buffer lengths, which would itself leak length information via which
// requests throw vs. return false — instead, a length mismatch still pays a
// comparable timingSafeEqual cost (against itself) before reporting false.
export function csrfTokensMatch(
  submitted: string | undefined,
  cookieValue: string | undefined,
): boolean {
  if (!submitted || !cookieValue) {
    return false;
  }
  const submittedBuffer = Buffer.from(submitted);
  const cookieBuffer = Buffer.from(cookieValue);
  if (submittedBuffer.length !== cookieBuffer.length) {
    timingSafeEqual(cookieBuffer, cookieBuffer);
    return false;
  }
  return timingSafeEqual(submittedBuffer, cookieBuffer);
}
