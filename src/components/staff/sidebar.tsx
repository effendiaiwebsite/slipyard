"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Kanban,
  Clock,
  BarChart3,
  FileText,
  Inbox,
  GitCompare,
  ShieldCheck,
  MessageSquare,
  PenLine,
  Sparkles,
  Mail,
  NotebookPen,
  ShieldAlert,
  Lightbulb,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Mirrors design-reference sidebar structure, minus Bookkeeping/Payroll
// (out of scope), plus CRA authorizations, Messaging/E-signatures, Settings.
const sections: { title: string; items: Item[] }[] = [
  {
    title: "Practice",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/clients", label: "Clients", icon: Users },
      { href: "/app/workflow", label: "Workflow board", icon: Kanban },
      { href: "/app/billing", label: "Time & billing", icon: Clock },
      { href: "/app/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Tax",
    items: [
      { href: "/app/tax", label: "Returns", icon: FileText },
      { href: "/app/tax/intake", label: "Document intake", icon: Inbox },
      { href: "/app/tax/afr", label: "AFR reconciliation", icon: GitCompare },
      { href: "/app/tax/authorizations", label: "CRA authorizations", icon: ShieldCheck },
    ],
  },
  {
    title: "Clients",
    items: [
      { href: "/app/messaging", label: "Messaging", icon: MessageSquare },
      { href: "/app/esign", label: "E-signatures", icon: PenLine },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/app/ai/assistant", label: "Knowledge assistant", icon: Sparkles },
      { href: "/app/ai/emails", label: "Email drafts", icon: Mail },
      { href: "/app/ai/meeting-prep", label: "Meeting prep", icon: NotebookPen },
      { href: "/app/ai/audit-risk", label: "Audit risk", icon: ShieldAlert },
      { href: "/app/ai/optimize", label: "Optimization advisor", icon: Lightbulb },
    ],
  },
];

export function Sidebar({
  orgName,
  userName,
  roleLabel,
}: {
  orgName: string;
  userName: string;
  roleLabel: string;
}) {
  const path = usePathname();
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 border-r border-[var(--color-border)] bg-white flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm">
          {orgName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm tracking-tight truncate">{orgName}</div>
          <div className="text-xs text-slate-500">Practice CRM</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-5">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="px-2 text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              {s.title}
            </div>
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
                        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 truncate">{it.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div>
          <ul>
            <li>
              <Link
                href="/app/settings"
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition",
                  path === "/app/settings"
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100"
                )}
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span>Settings</span>
              </Link>
            </li>
          </ul>
        </div>
      </nav>
      <div className="border-t border-[var(--color-border)] px-4 py-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-xs">
          {initials || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{userName}</div>
          <div className="text-xs text-slate-500 truncate">{roleLabel}</div>
        </div>
      </div>
    </aside>
  );
}
