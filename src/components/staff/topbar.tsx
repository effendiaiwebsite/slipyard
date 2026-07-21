"use client";

import { useRouter } from "next/navigation";
import { Search, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function Topbar() {
  const router = useRouter();
  return (
    <header className="h-14 border-b border-[var(--color-border)] bg-white flex items-center px-6 gap-4 sticky top-0 z-10">
      <div className="relative flex-1 max-w-xl">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search clients, returns, documents…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
          disabled
          title="Search arrives with the client hub (M2)"
        />
      </div>
      <button
        onClick={async () => {
          await authClient.signOut();
          router.push("/login");
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </header>
  );
}
