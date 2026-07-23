"use client";

/**
 * Last-resort error boundary (M10) — catches failures in the root layout
 * itself, so it must render its own <html>/<body> and use no app chrome.
 */
export default function GlobalError({
  unstable_retry,
}: {
  error: Error;
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f7f8fa", color: "#0f172a" }}>
        <div style={{ maxWidth: 480, margin: "15vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#64748b", marginTop: 8 }}>
            An unexpected error stopped the page. Your data is safe.
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 16,
              padding: "10px 20px",
              borderRadius: 8,
              background: "#0f172a",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
