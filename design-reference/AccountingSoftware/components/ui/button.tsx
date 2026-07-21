import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "ai";

const variants: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  ai: "bg-violet-600 text-white hover:bg-violet-500",
};

export function Button({ className, variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
