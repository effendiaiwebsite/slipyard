import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type Tone = "neutral" | "success" | "warn" | "danger" | "ai" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  ai: "bg-violet-50 text-violet-700 ring-violet-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}
