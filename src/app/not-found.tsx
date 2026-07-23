import Link from "next/link";

/** Root 404 (M10) — anything outside the staff app and portal. */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-5xl font-semibold text-slate-300 tabular-nums">404</p>
        <h1 className="text-xl font-semibold tracking-tight">That page doesn&apos;t exist</h1>
        <p className="text-sm text-slate-500">
          The link may be old or mistyped. If a client sent you here, ask them to check the link in
          their message.
        </p>
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link
            href="/"
            className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700"
          >
            Home
          </Link>
          <Link
            href="/app"
            className="px-4 py-2 rounded-md ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Staff sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
