// A minimal fake of the Resend API surface `src/lib/email/send.ts` calls,
// intercepted at the network boundary via msw (AGENT.md: "Mock at the
// network boundary (MSW), not by stubbing your own modules") — same
// rationale and same shape as tests/msw/stripe-server.ts. Resend's SDK
// (node_modules/resend/dist/index.mjs) calls the global `fetch` inline on
// every request rather than binding a reference at construction time, so
// unlike the Stripe singleton, no dynamic-import-after-listen workaround is
// needed here: a statically-imported Resend client still gets intercepted.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

type SentEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

let idCounter = 0;
const sentEmails: SentEmail[] = [];

// Set by a test to force the next send to fail, proving "email sending
// failure does not fail the order" without needing a real network error.
let forceFailure = false;

export const resendServer = setupServer(
  http.post("https://api.resend.com/emails", async ({ request }) => {
    if (forceFailure) {
      return HttpResponse.json(
        {
          name: "application_error",
          message: "forced failure for testing",
          statusCode: 500,
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      from: string;
      to: string | string[];
      subject: string;
      html?: string;
      text?: string;
    };
    const id = `email_test_${++idCounter}`;
    sentEmails.push({
      id,
      from: body.from,
      to: Array.isArray(body.to) ? body.to : [body.to],
      subject: body.subject,
      html: body.html ?? "",
      text: body.text ?? "",
    });
    return HttpResponse.json({ id });
  }),
);

export function getSentEmails(): SentEmail[] {
  return [...sentEmails];
}

export function setResendForceFailure(value: boolean): void {
  forceFailure = value;
}

export function resetResendFakeState(): void {
  sentEmails.length = 0;
  forceFailure = false;
}
