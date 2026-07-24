"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { GoogleMark } from "@/components/google-mark";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idleNotice = params.get("reason") === "idle";
  // OAuth failures bounce back here (errorCallbackURL) with a machine-readable
  // ?error= code appended by better-auth's redirectOnError.
  const oauthError = params.get("error");
  // Deliberate posture (ADR-0038): we do NOT implicitly link Google to an
  // existing password account — better-auth's social sign-in skips the TOTP
  // challenge, so auto-linking would quietly bypass mandatory 2FA.
  const accountNotLinked = oauthError === "account_not_linked";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Sign-in failed");
      return;
    }
    // Users with 2FA enrolled are redirected to /verify-mfa by the
    // twoFactorClient plugin; the check below covers first login (not yet
    // enrolled), which requireStaff would also catch server-side.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    router.push("/app");
  }

  async function googleSignIn() {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/app",
      errorCallbackURL: "/login",
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>Staff access — clients use the secure link we send them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {idleNotice && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-3 py-2">
            You were signed out after 30 minutes of inactivity.
          </p>
        )}
        {accountNotLinked && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-3 py-2">
            That email already signs in with a password. Enter your email and password below
            (plus your authenticator code) — for security, Google sign-in doesn&apos;t attach
            itself to an existing account. Forgot the password? Use the reset link below.
          </p>
        )}
        {oauthError && !accountNotLinked && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-3 py-2">
            We couldn&apos;t finish signing you in with Google. If you don&apos;t have an account
            yet, ask your firm owner for an invitation — or create a new firm below. If you do,
            try again in a moment.
          </p>
        )}
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-slate-500 underline underline-offset-2"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <Button variant="outline" className="w-full" onClick={googleSignIn}>
          <GoogleMark /> Continue with Google
        </Button>
        <p className="text-sm text-slate-500 text-center">
          New firm?{" "}
          <Link href="/signup" className="underline underline-offset-2">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/brand/slipyard-mark.png" alt="SlipYard" className="h-16 w-auto" />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
