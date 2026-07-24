"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  // better-auth's link-callback redirects here with ?error=INVALID_TOKEN when
  // the link is expired or already used.
  const linkError = params.get("error") !== null || !token;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "That link is no longer valid — request a new one.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2500);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Set a new password</CardTitle>
        <CardDescription>
          Your sign-in email stays the same; if you use an authenticator app it still applies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkError ? (
          <>
            <p className="text-sm rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-3 py-2">
              This reset link is invalid or has expired.
            </p>
            <p className="text-sm text-slate-500 text-center">
              <Link href="/forgot-password" className="underline underline-offset-2">
                Request a new link
              </Link>
            </p>
          </>
        ) : done ? (
          <p className="text-sm rounded-md bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-3 py-2">
            Password updated — taking you to sign in…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-slate-500">At least 10 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/brand/slipyard-mark.png" alt="SlipYard" className="h-16 w-auto" />
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
