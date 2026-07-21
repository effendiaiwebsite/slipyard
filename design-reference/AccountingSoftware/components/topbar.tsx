import { Search, Bell, Sparkles } from "lucide-react";

export function Topbar() {
  return (
    <header className="h-14 border-b border-[var(--color-border)] bg-white flex items-center px-6 gap-4 sticky top-0 z-10">
      <div className="relative flex-1 max-w-xl">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search clients, returns, slips, transactions..."
          className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
        />
      </div>
      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-50 text-violet-700 text-sm font-medium ring-1 ring-violet-200 hover:bg-violet-100">
        <Sparkles className="w-4 h-4" />
        Ask AI
      </button>
      <button className="relative w-9 h-9 grid place-items-center rounded-md hover:bg-slate-100">
        <Bell className="w-4 h-4 text-slate-600" />
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500" />
      </button>
    </header>
  );
}
