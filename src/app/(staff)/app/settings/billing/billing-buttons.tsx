"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { openBillingPortal, startCheckout } from "./actions";

export function BillingButtons({
  hasSubscription,
  hasCustomer,
}: {
  hasSubscription: boolean;
  hasCustomer: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error: string } | never>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {!hasSubscription && (
          <Button onClick={() => run(startCheckout)} disabled={pending}>
            {pending ? "Redirecting…" : "Subscribe now"}
          </Button>
        )}
        {hasCustomer && (
          <Button variant="outline" onClick={() => run(openBillingPortal)} disabled={pending}>
            Manage billing in Stripe
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
