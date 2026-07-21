import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-white rounded-xl border border-[var(--color-border)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("font-semibold text-sm tracking-tight", className)}>{children}</h3>;
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
