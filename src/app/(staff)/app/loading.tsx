/**
 * Staff-app loading state (M10): a quiet skeleton in the shape of a typical
 * page (title + stat cards + a table card) so navigation feels instant
 * without a spinner flash.
 */
export default function StaffLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse" aria-hidden>
      <div className="space-y-2">
        <div className="h-6 w-56 rounded bg-slate-200" />
        <div className="h-4 w-80 rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white p-4">
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="h-7 w-12 rounded bg-slate-200 mt-3" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="h-4 w-40 rounded bg-slate-100" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 w-full rounded bg-slate-50" />
        ))}
      </div>
    </div>
  );
}
