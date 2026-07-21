import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-slate-100 text-slate-700 ring-slate-200",
        accent: "bg-indigo-50 text-indigo-700 ring-indigo-200",
        success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        warn: "bg-amber-50 text-amber-700 ring-amber-200",
        danger: "bg-red-50 text-red-700 ring-red-200",
        ai: "bg-violet-50 text-violet-700 ring-violet-200",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
