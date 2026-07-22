/**
 * Portal landing — reached without a token, or after a session ends. From M4
 * the real entry point is /portal/[token] (magic link). Plain language,
 * no actions: the only fix is a fresh link from the firm.
 */
export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const sessionEnded = reason === "session";

  return (
    <div className="space-y-6">
      <h1>{sessionEnded ? "Your session has ended" : "This page needs a personal link"}</h1>
      {sessionEnded ? (
        <>
          <p>For your security, portal sessions end after 30 minutes.</p>
          <p>
            To continue, open the link from your text message or email again. If the link says it
            has expired, call your accountant&apos;s office and they will send a fresh one.
          </p>
        </>
      ) : (
        <>
          <p>
            To use this secure portal, you need a personal link from your accountant. They will
            send it to you by text message or email.
          </p>
          <p>
            If you were expecting a link and don&apos;t have one, please call your
            accountant&apos;s office.
          </p>
        </>
      )}
    </div>
  );
}
