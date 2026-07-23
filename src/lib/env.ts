import { z } from "zod";

// Server-only. Import `clientEnv`, not `env`, from client components — these
// keys don't exist in the browser bundle and parsing them there throws.
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  ALLOW_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().min(1).optional(),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ORDER_NOTIFICATION_EMAIL: z.string().email().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SHIPPO_API_TOKEN: z.string().min(1).optional(),
});

// Safe to ship to the browser — must be prefixed NEXT_PUBLIC_ by convention.
const clientSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

function parseOrThrow<T extends z.ZodType>(
  schema: T,
  source: unknown,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

const serverEnv = parseOrThrow(serverSchema, process.env);

// Each key is read via a literal `process.env.NEXT_PUBLIC_*` expression (not
// a dynamic `process.env` spread) so Next's compiler can statically inline it
// into the browser bundle. A generic `process.env` lookup would just be
// `undefined` client-side, since Next does not ship the full env object.
export const clientEnv = parseOrThrow(clientSchema, {
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

// Server-only — importing this from a "use client" component will throw at
// runtime, because the server vars it depends on don't exist in the browser.
// Client components that need a public var should import `clientEnv` instead.
export const env = { ...serverEnv, ...clientEnv };
