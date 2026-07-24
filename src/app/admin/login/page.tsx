import { loginAction } from "@/lib/actions/admin-auth";
import { readCsrfCookie } from "@/lib/auth/csrf-cookie";
import { CSRF_FIELD_NAME } from "@/lib/auth/csrf-token";

// Reads the csrf_token cookie (via readCsrfCookie) — Next opts this route
// into dynamic rendering for that reason alone, same rationale as the cart
// page's own explicit export.
export const dynamic = "force-dynamic";

// loginAction (src/lib/actions/admin-auth.ts, task 4.2a) redirects back here
// with `?error=<reason>` on any failure. `invalid_credentials` covers both
// "no such user" and "wrong password" — attemptLogin (4.1a) already
// collapses those into one reason for timing-safety, and this copy layer
// must not undo that by being more specific than the service is.
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  csrf_mismatch:
    "Your session expired or the form was tampered with. Please try logging in again.",
  invalid_credentials: "Incorrect email or password.",
  locked: "Too many failed attempts. Try again in a few minutes.",
};

function loginErrorMessage(reason: string | undefined): string | null {
  if (!reason) {
    return null;
  }
  return (
    LOGIN_ERROR_MESSAGES[reason] ?? "Something went wrong. Please try again."
  );
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorText = loginErrorMessage(error);
  const csrfToken = await readCsrfCookie();

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Admin log in
      </h1>

      {errorText && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-lavender-dark/30 bg-lavender/10 p-3 text-sm text-ink"
        >
          {errorText}
        </p>
      )}

      <form action={loginAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken ?? ""} />

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-ink"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="mt-2 rounded-md bg-lavender px-5 py-2.5 text-sm font-semibold text-white hover:bg-lavender-dark"
        >
          Log in
        </button>
      </form>
    </div>
  );
}
