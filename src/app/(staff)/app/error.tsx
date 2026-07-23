"use client";

import { useEffect } from "react";

/**
 * Staff-app error boundary (M10). Renders inside the sidebar/topbar layout,
 * so it only needs to fill the main pane. The digest is the only detail
 * surfaced — stack traces stay in the server logs.
 */
export default function StaffError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-6">
      <div className="max-w-md mx-auto mt-16 text-center space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-slate-500">
          The page hit an unexpected error. Your data is safe — try again, and if it keeps
          happening, note what you were doing and tell your administrator.
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400">
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={() => unstable_retry()}
          className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
