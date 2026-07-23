"use client";

/**
 * Portal error boundary (M10) — plain language, big type, one action.
 * Nothing technical reaches the client (AAA audience, same posture as the
 * upload outcomes).
 */
export default function PortalError({
  unstable_retry,
}: {
  error: Error;
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 space-y-6">
      <h1>Sorry — something didn&apos;t work</h1>
      <p>
        That wasn&apos;t anything you did. Your documents and information are safe. Please try
        again.
      </p>
      <button
        className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a]"
        onClick={() => unstable_retry()}
      >
        Try again
      </button>
      <p>If it still doesn&apos;t work, close this page and open the link from your message again.</p>
    </div>
  );
}
