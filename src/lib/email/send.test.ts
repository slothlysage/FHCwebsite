import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { sendEmail } from "@/lib/email/send";
import {
  getSentEmails,
  resendServer,
  resetResendFakeState,
  setResendForceFailure,
} from "../../../tests/msw/resend-server";

// Network-boundary tests (AGENT.md: "Mock at the network boundary (MSW)").

beforeAll(() => resendServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  resendServer.resetHandlers();
  resetResendFakeState();
});
afterAll(() => resendServer.close());

describe("sendEmail", () => {
  it("sends an email and reports success", async () => {
    const result = await sendEmail({
      to: "buyer@example.com",
      subject: "Your order",
      html: "<p>Thanks</p>",
      text: "Thanks",
    });

    expect(result).toEqual({ sent: true });
    const [sent] = getSentEmails();
    expect(sent?.to).toEqual(["buyer@example.com"]);
    expect(sent?.subject).toBe("Your order");
    expect(sent?.html).toBe("<p>Thanks</p>");
    expect(sent?.text).toBe("Thanks");
  });

  it("reports failure, without throwing, when the API returns an error", async () => {
    setResendForceFailure(true);

    const result = await sendEmail({
      to: "buyer@example.com",
      subject: "Your order",
      html: "<p>Thanks</p>",
      text: "Thanks",
    });

    expect(result).toEqual({ sent: false });
  });

  it("reports failure, without throwing, when the request itself fails", async () => {
    resendServer.use(
      http.post("https://api.resend.com/emails", () => HttpResponse.error()),
    );

    const result = await sendEmail({
      to: "buyer@example.com",
      subject: "Your order",
      html: "<p>Thanks</p>",
      text: "Thanks",
    });

    expect(result).toEqual({ sent: false });
  });
});
