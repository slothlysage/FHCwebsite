import { getSupportEmail } from "@/lib/support-contact";

// Shared by the policy pages (terms, shipping, returns, FAQ) so the
// "no configured address yet" fallback only has to be written once.
export function SupportEmailLink() {
  const email = getSupportEmail();

  if (!email) {
    return <span>our support team</span>;
  }

  return (
    <a
      href={`mailto:${email}`}
      className="text-lavender underline hover:text-lavender-dark"
    >
      {email}
    </a>
  );
}
