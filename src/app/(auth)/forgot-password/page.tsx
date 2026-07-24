"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Neutral outcome either way — the response never reveals whether an
    // account exists for the address.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/brand/slipyard-mark.png" alt="SlipYard" className="h-16 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Forgot your password?</CardTitle>
          <CardDescription>
            Enter your work email and we&apos;ll send a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <p className="text-sm rounded-md bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-3 py-2">
              If that email has a SlipYard account, a reset link is on its way. The link expires
              in 1 hour.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <p className="text-sm text-slate-500 text-center">
            Lost your authenticator too? Ask a firm administrator to reset your two-factor from
            Settings → Employees.
          </p>
          <p className="text-sm text-slate-500 text-center">
            <Link href="/login" className="underline underline-offset-2">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
