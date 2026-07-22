import { headers } from "next/headers";
import { validatePortalLink } from "@/lib/portal-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { OtpFlow } from "./otp-flow";

export const metadata = { title: "Secure portal" };

/**
 * Magic-link landing (M4). The GET only VALIDATES the link — it never stamps
 * opened_at or sends a text, because SMS apps prefetch URLs. The client
 * presses one big Continue button (server action) to start the code step.
 */
export default async function PortalTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: raw } = await params;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`portal-open:${ip}`, 30, 10 * 60 * 1000)) {
    return (
      <Dead
        title="Too many attempts"
        body="Please wait a few minutes, then open your link again."
      />
    );
  }

  const validated = await validatePortalLink(raw);
  if (!validated.ok) {
    const copy = {
      invalid: {
        title: "This link isn't valid",
        body: "Please use the newest message from your accountant. If the problem continues, call their office.",
      },
      revoked: {
        title: "This link was cancelled",
        body: "Your accountant's office cancelled this link. Please call them and they'll send a new one.",
      },
      expired: {
        title: "This link has expired",
        body: "For your security, links stop working after a while. Call your accountant's office and they'll send a fresh one.",
      },
      locked: {
        title: "This link is locked",
        body: "Too many incorrect codes were entered. For your security, please call your accountant's office.",
      },
    }[validated.problem];
    return <Dead title={copy.title} body={copy.body} />;
  }

  const t = validated.value.token;
  return (
    <OtpFlow
      raw={raw}
      recipientName={t.recipientName}
      phoneTail={t.recipientPhone.slice(-4)}
      alreadyOpened={!!t.openedAt}
    />
  );
}

function Dead({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-6">
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
