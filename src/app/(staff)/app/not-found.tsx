import Link from "next/link";

/**
 * Staff-app 404 (M10) — also what notFound() renders for out-of-scope
 * resource ids (assigned-only accountants get this, not an existence leak).
 */
export default function StaffNotFound() {
  return (
    <div className="p-6">
      <div className="max-w-md mx-auto mt-16 text-center space-y-4">
        <p className="text-5xl font-semibold text-slate-300 tabular-nums">404</p>
        <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
        <p className="text-sm text-slate-500">
          This page doesn&apos;t exist, or it belongs to a client outside your view.
        </p>
        <Link
          href="/app"
          className="inline-block px-4 py-2 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-700"
        >
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
