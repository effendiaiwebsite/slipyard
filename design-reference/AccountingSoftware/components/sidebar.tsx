"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Kanban, Clock, FileText,
  Inbox, GitCompare, Sparkles, Banknote, Scale, Receipt,
  UserCog, PlayCircle, FileSpreadsheet, MessageSquare, Mail, NotebookPen, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; hot?: boolean };

const sections: { title: string; items: Item[] }[] = [
  {
    title: "Practice",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hot: true },
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/workflow", label: "Workflow board", icon: Kanban },
      { href: "/billing", label: "Time & billing", icon: Clock },
    ],
  },
  {
    title: "Tax",
    items: [
      { href: "/tax", label: "Returns", icon: FileText },
      { href: "/tax/intake", label: "Document intake", icon: Inbox, hot: true },
      { href: "/tax/afr", label: "AFR reconciliation", icon: GitCompare },
      { href: "/tax/optimize", label: "Optimization advisor", icon: Sparkles },
    ],
  },
  {
    title: "Bookkeeping",
    items: [
      { href: "/bookkeeping", label: "Bank feed", icon: Banknote, hot: true },
      { href: "/bookkeeping/reconcile", label: "Reconciliation", icon: Scale },
      { href: "/bookkeeping/gst", label: "GST/HST", icon: Receipt },
    ],
  },
  {
    title: "Payroll",
    items: [
      { href: "/payroll", label: "Employees", icon: UserCog },
      { href: "/payroll/run", label: "Pay run", icon: PlayCircle },
      { href: "/payroll/slips", label: "Year-end slips", icon: FileSpreadsheet },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/ai/assistant", label: "Knowledge assistant", icon: MessageSquare },
      { href: "/ai/emails", label: "Email drafts", icon: Mail },
      { href: "/ai/meeting-prep", label: "Meeting prep", icon: NotebookPen },
      { href: "/ai/audit-risk", label: "Audit risk", icon: ShieldAlert },
    ],
  },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 border-r border-[var(--color-border)] bg-white flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm">L</div>
        <div>
          <div className="font-semibold text-sm tracking-tight">Lakeside CPA</div>
          <div className="text-xs text-slate-500">2025 Tax Season</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-5">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="px-2 text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">{s.title}</div>
            <ul className="space-y-0.5">
              {s.items.map((it) => {
                const active = path === it.href;
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition",
                        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hot && !active && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-[var(--color-border)] px-4 py-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-xs">SK</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">Sarah Kovac</div>
          <div className="text-xs text-slate-500 truncate">Senior Accountant</div>
        </div>
      </div>
    </aside>
  );
}
