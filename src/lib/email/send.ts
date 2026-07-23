import { env } from "@/lib/env";
import { resend } from "@/lib/email/client";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { sent: boolean };

// Best-effort by construction: every exit path returns rather than throws,
// so a caller (order-fulfillment.ts, 3.7) never needs its own try/catch to
// satisfy specs/05-payments.md's "a failed email must never roll back a
// paid order."
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      console.error(`[email] send failed: ${error.message}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error(`[email] send threw: ${String(error)}`);
    return { sent: false };
  }
}
